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
import { sampledAreaBySlab } from "@/lib/fab/sampledArea";
import { rowLabel } from "@/lib/fab/pieceNaming";
import { projectKindOf } from "@/lib/fab/sampleOrder";

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
        // PO or SAMPLE. A sample order runs this same board with sink and
        // fabrication switched off, and the card says which it is looking at —
        // "no sinks on this one" is not something a supervisor should have to
        // infer from an empty column.
        kind: true,
        _count: { select: { requirements: true, pos: true } },
      },
    });
    return Response.json(
      projects.map(p => ({
        id: p.id,
        projectCode: p.projectCode,
        customerName: p.customerName,
        status: p.status,
        kind: projectKindOf(p.kind),
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
        // THE ROW'S LETTER. Selected here because the screen names rows by it —
        // pieces are stickered {projectCode}-{LETTER}-{n}, and a board that
        // calls a row anything else does not match what is written on stone.
        //
        // The slabs view below has always sent it. This view did not, so every
        // row on the outstanding list and in the add-a-row dropdown fell back
        // to its piece_label. On a purchase order that is "Row 7" and looks
        // fine; on a sample order it is the entire "Cappuccino Dark Polished
        // 11 x 11 in · 20 mm", printed immediately beside the size column that
        // already says the same thing.
        rowLetter: true,
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
          // Sent RAW beside the label rather than folded into it, so the screen
          // can lead with the letter and still say what the row is of — a
          // sample project's rows differ by colour and finish, and the
          // outstanding table has no column for either.
          rowLetter: r.rowLetter,
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
      orderBy: { createdAt: "desc" },
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
                rowLetter: true,
                po: { select: { poNumber: true } },
                drawing: { select: { drawingNumber: true } },
              },
            },
          },
        },
      },
    });

    // Stone already cut off these slabs for sampling. One query for the whole
    // board, and the SAME number /api/fab/approve-slab enforces with — the
    // screen must not offer a send the route will refuse.
    const sampled = await sampledAreaBySlab(slabs.map(s => s.id));

    // ── WHICH EDGES ARE POLISHED, for the picker under each slab ────────────
    //
    // The decision belongs to the ORDER ROW — "same row all have same" — so it
    // travels with the requirement, not the allocation, and the same row under
    // slab 4 shows what was chosen under slab 1.
    //
    // RAW AND WRAPPED, like the CEO route reads it: finished_edges arrived in
    // scripts/0055, and a deploy whose Prisma client predates it would take the
    // whole supervisor board down over a column that only feeds a price. A
    // missing column leaves every row "not chosen", which is exactly what it is.
    const edgeIds = [...new Set(
      slabs.flatMap(s => s.requirementAllocations.map(a => a.requirement.id))
    )];
    const edgesByRequirement = new Map<string, string | null>();
    if (edgeIds.length) {
      try {
        const edgeRows = await prisma.$queryRaw<Array<{ id: string; finished_edges: string | null }>>`
          SELECT id, finished_edges FROM fab_requirement WHERE id = ANY(${edgeIds}::text[])
        `;
        for (const r of edgeRows) edgesByRequirement.set(r.id, r.finished_edges ?? null);
      } catch {
        // scripts/0055 not applied. Every row reads as not chosen.
      }
    }

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
          /** Square feet of this slab that left as sample stock. Spent, not
           *  scrap, and not available to the purchase order — the card feeds it
           *  to computeSlabLoss so the remaining area and the Send-to-cutter
           *  button both account for it. */
          sampledAreaSqft: sampled.get(s.id) ?? 0,
          slabJobId: job?.id ?? null,
          slabJobStatus: job?.status ?? null,
          sent: !!job && (SENT_STATUSES as readonly string[]).includes(job.status),
          rows: s.requirementAllocations.map(a => ({
            allocationId: a.id,
            requirementId: a.requirement.id,
            poNumber: a.requirement.po?.poNumber ?? null,
            drawingNumber: a.requirement.drawing?.drawingNumber ?? null,
            // The row LETTER — what every piece cut from this row is named
            // after. Falls back to the imported "Row 3" before scripts/0054.
            pieceLabel: rowLabel(a.requirement.rowLetter, a.requirement.pieceLabel),
            description: a.requirement.description,
            lengthIn: a.requirement.length,
            widthIn: a.requirement.width,
            orderedQuantity: a.requirement.quantity,
            sinkQuantity: a.requirement.sinkQuantity,
            /** fab_requirement.finished_edges — canonical CSV, or NULL when
             *  nobody has marked this row's edges. NULL is not "no edges": one
             *  is an unanswered question and the other is an answer. */
            finishedEdges: edgesByRequirement.get(a.requirement.id) ?? null,
            allocatedQuantity: a.allocatedQuantity,
          })),
        };
      }),
    );
  }

  return Response.json({ error: `Unknown view "${view}".` }, { status: 400 });
}
