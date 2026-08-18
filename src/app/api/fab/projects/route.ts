import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function GET() {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const projects = await prisma.fabProject.findMany({
    include: {
      drawings: { include: { requirements: true } },
      requirements: true,
      _count: { select: { pieces: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return Response.json(projects);
}

// RETIRED 2026-08 -- superseded fabrication intake.
//
// The legacy create: one POST carrying a project, its FabDrawings and every
// FabRequirement, built from a parsed Drawing Summary workbook. Its only caller was
// /fab/projects/new, retired in the same pass.
//
// Replaced mid-2026 by the manager surface: POST /api/fab/manager/projects creates a
// bare project, POST /api/fab/manager/pos creates a PO under it, and
// POST /api/fab/manager/pos/import writes the FabRequirement rows from that PO's own
// piece table (with po_id set, and no FabDrawing in between).
//
// ONLY THE POST IS RETIRED. The GET above still lists projects and is left alone.
// That is also why this file returns 410 rather than being commented out end to end:
// a live handler has to stay in it, so blanking the file was never an option, and a
// POST that simply lost its handler would answer 405 -- indistinguishable from a bug.

export async function POST() {
  return Response.json(
    {
      error:
        "This endpoint has been retired. The Drawing Summary intake that created a project, its drawings and all of its requirements in one POST was replaced by the manager purchase-order intake: create the project and its PO under /fab/manager, then upload the PO document there.",
    },
    { status: 410 },
  );
}

/* ---- original implementation, retired 2026-08 -------------------------- */
// export async function POST(req: Request) {
//   const g = await fabGate("SUPERVISOR");
//   if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
//
//   try {
//     const body = await req.json();
//     const { projectCode, customerName, requirements, remarks } = body;
//     if (!projectCode || !customerName || !requirements?.length) {
//       return Response.json({ error: "projectCode, customerName and requirements required" }, { status: 400 });
//     }
//
//     const totalPieces = requirements.reduce((s: number, r: any) => s + (r.quantity || 0), 0);
//     const project = await prisma.$transaction(async (tx) => {
//       const proj = await tx.fabProject.create({
//         data: { projectCode, customerName, numberOfPieces: totalPieces, remarks },
//       });
//       const drawingsMap = new Map<string, string>();
//       const uniqueDrawings = [...new Set(requirements.map((r: any) => r.drawingNumber))];
//       for (const dn of uniqueDrawings) {
//         const sample = requirements.find((r: any) => r.drawingNumber === dn);
//         const drawing = await tx.fabDrawing.create({
//           data: { projectId: proj.id, drawingNumber: dn as string, unitType: sample.unitType, units: sample.units, areaName: sample.areaName },
//         });
//         drawingsMap.set(dn as string, drawing.id);
//       }
//       for (const r of requirements) {
//         const sinkRequired = (r.sinkCuts ?? 0) > 0 || !!(r.sinkModel?.trim());
//         const polishRequired = (r.depLength ?? 0) > 0;
//         await tx.fabRequirement.create({
//           data: {
//             projectId:   proj.id,
//             drawingId:   drawingsMap.get(r.drawingNumber),
//             pieceLabel:  r.pieceLabel,
//             description: r.description,
//             slabCode:    r.description ?? r.pieceLabel ?? "UNKNOWN",
//             length:      r.length    ?? null,
//             width:       r.width     ?? null,
//             thickness:   r.thickness ?? null,
//             quantity:    r.quantity  || 1,
//             sinkRequired,
//             fabricationRequired: sinkRequired,
//             polishRequired,
//             sinkModel:    r.sinkModel,
//             sinkCuts:     r.sinkCuts,
//             faucetCount:  r.faucets,
//             depLength:    r.depLength    ?? null,
//             jointCount:   r.joints,
//             sqftPerPiece: r.sqftPerPiece,
//             totalSqft:    r.totalSqft,
//             notes:        r.notes,
//           },
//         });
//       }
//       return proj;
//     });
//     return Response.json({ success: true, projectId: project.id });
//   } catch (e) {
//     return Response.json({ error: String(e) }, { status: 500 });
//   }
// }
