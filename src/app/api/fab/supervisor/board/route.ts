// GET /api/fab/supervisor/board?view=projects
// GET /api/fab/supervisor/board?view=requirements&projectId=...
// GET /api/fab/supervisor/board?view=slabs&projectId=...
//
// The read side of the two supervisor boards — slab assignment and sinks. Both
// work on ONE project and pool every purchase order under it, because a slab is
// filled from whatever is outstanding and the shop does not care which document
// a piece came off. The PO is carried on each row so he can still see.
//
// WHY A NEW ENDPOINT. /api/fab/supervisor/projects nests requirements under
// DRAWINGS. Requirements from a PO PDF have drawing_id NULL — they hang off the
// project and the purchase order — so on that endpoint a PO project comes back
// with `drawings: []` and its rows are simply not there. A board built on it
// would show a project with nothing in it and no way to tell that apart from a
// project with nothing in it.
//
// EVERY VIEW RETURNS AN ARRAY. getJson() in lib/fab/postJson.ts hands back
// `Array.isArray(j) ? j : []`, so an object body would arrive at the screen as
// a successful empty list — the exact failure mode that helper exists to stop.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { allocatedTotal, remainingQuantity } from "@/lib/fab/slabAssignment";

/** Projects that are still being planned. A released project's slabs are the
 *  Cut Queue's business, not this board's. */
const PLANNING_STATUSES = ["PLANNING", "ALLOCATED"] as const;

/** Job states that mean the slab has left the board for the cutting floor. */
const SENT_STATUSES = ["READY", "IN_PROGRESS", "COMPLETED"] as const;

export async function GET(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const params = req.nextUrl.searchParams;
  const projectId = params.get("projectId");
  const view = params.get("view") ?? (projectId ? "requirements" : "projects");

  if (view === "projects") {
    const projects = await prisma.fabProject.findMany({
      where: { status: { in: [...PLANNING_STATUSES] }, projectCode: { not: "UNASSIGNED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectCode: true,
        customerName: true,
        status: true,
        _count: { select: { requirements: true, pos: true } },
      },
    });
    return Response.json(
      projects.map(p => ({
        id: p.id,
        projectCode: p.projectCode,
        customerName: p.customerName,
        status: p.status,
        requirementCount: p._count.requirements,
        poCount: p._count.pos,
      })),
    );
  }

  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  if (view === "requirements") {
    const requirements = await prisma.fabRequirement.findMany({
      where: { projectId },
      // Deterministic, so the board does not reshuffle under the supervisor's
      // finger between two saves.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        pieceLabel: true,
        description: true,
        length: true,
        width: true,
        quantity: true,
        sinkQuantity: true,
        status: true,
        po: { select: { id: true, poNumber: true } },
        drawing: { select: { drawingNumber: true } },
        allocations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            allocatedQuantity: true,
            slab: { select: { id: true, slabCode: true, colour: true } },
          },
        },
      },
    });

    return Response.json(
      requirements.map(r => {
        const allocations = r.allocations.map(a => ({
          id: a.id,
          allocatedQuantity: a.allocatedQuantity,
          slabId: a.slab?.id ?? null,
          slabCode: a.slab?.slabCode ?? null,
          slabColour: a.slab?.colour ?? null,
        }));
        return {
          id: r.id,
          poId: r.po?.id ?? null,
          poNumber: r.po?.poNumber ?? null,
          drawingNumber: r.drawing?.drawingNumber ?? null,
          pieceLabel: r.pieceLabel,
          description: r.description,
          // INCHES, as fab_requirement stores them. Named so, because the slab
          // beside them is in millimetres — see slabLoss.ts.
          lengthIn: r.length,
          widthIn: r.width,
          quantity: r.quantity,
          sinkQuantity: r.sinkQuantity,
          status: r.status,
          allocations,
          allocatedQuantity: allocatedTotal(allocations),
          remainingQuantity: remainingQuantity(r.quantity, allocations),
        };
      }),
    );
  }

  if (view === "slabs") {
    const slabs = await prisma.fabSlab.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        slabCode: true,
        colour: true,
        thickness: true,
        length: true,
        width: true,
        pacificQcId: true,
        slabJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, createdAt: true } },
        requirementAllocations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            allocatedQuantity: true,
            requirement: {
              select: {
                id: true,
                pieceLabel: true,
                description: true,
                length: true,
                width: true,
                quantity: true,
                // The sink decision belongs to the ORDER ROW, not to the slab,
                // but it is made while prepping one — so the slab view carries
                // it and the sink board sits under that slab's pieces. NULL
                // means the supervisor has not looked at this row yet.
                sinkQuantity: true,
                po: { select: { poNumber: true } },
                drawing: { select: { drawingNumber: true } },
              },
            },
          },
        },
      },
    });

    return Response.json(
      slabs.map(s => {
        const job = s.slabJobs[0] ?? null;
        return {
          id: s.id,
          slabCode: s.slabCode,
          colour: s.colour,
          thicknessMm: s.thickness,
          // MILLIMETRES, as fab_slab stores them. computeSlabLoss takes these
          // two and the rows' INCH dimensions and is the only thing allowed to
          // put them in the same sum.
          lengthMm: s.length,
          widthMm: s.width,
          pacificQcId: s.pacificQcId,
          slabJobId: job?.id ?? null,
          slabJobStatus: job?.status ?? null,
          sent: !!job && (SENT_STATUSES as readonly string[]).includes(job.status),
          rows: s.requirementAllocations.map(a => ({
            allocationId: a.id,
            requirementId: a.requirement.id,
            poNumber: a.requirement.po?.poNumber ?? null,
            drawingNumber: a.requirement.drawing?.drawingNumber ?? null,
            pieceLabel: a.requirement.pieceLabel,
            description: a.requirement.description,
            lengthIn: a.requirement.length,
            widthIn: a.requirement.width,
            orderedQuantity: a.requirement.quantity,
            sinkQuantity: a.requirement.sinkQuantity,
            allocatedQuantity: a.allocatedQuantity,
          })),
        };
      }),
    );
  }

  return Response.json({ error: `Unknown view "${view}".` }, { status: 400 });
}
