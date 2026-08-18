// RETIRED 2026-08 -- superseded fabrication intake.
//
// The writer half of the cut-plan OCR path: it took the parsed plan from
// POST /api/fab/parse-cutplan and created FabSlab / FabRequirementAllocation rows.
//
// Already dead before this pass -- zero callers, and its only producer could not run
// on Vercel. Slab assignment now happens on /fab/supervisor/slabs.
//
// HOW THIS IS RETIRED. The file stays in the tree, so the URL stays routable;
// every handler it used to export now returns 410 Gone naming the replacement,
// rather than being deleted (which would 404) or left with no handler (which
// would 405 and read like a bug). The original implementation is preserved
// underneath, commented out line by line -- comment it out, do not delete it.

const GONE =
  "This endpoint has been retired. Cut-plan OCR was never reachable in production and has been replaced by the supervisor slab screen at /fab/supervisor/slabs.";

export async function POST() {
  return Response.json({ error: GONE }, { status: 410 });
}

/* ---- original implementation, retired 2026-08 -------------------------- */
// import { NextRequest } from "next/server";
// import { prisma } from "@/lib/prisma";
// import { fabGate } from "@/lib/fab/access";
//
// interface LabelEntry { label: string; qty: number; }
// interface SlabPlan   { stockSheet: string; page: number; labels: LabelEntry[]; }
//
// export async function POST(req: NextRequest) {
//   const g = await fabGate("SUPERVISOR");
//   if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
//
//   const { projectId, plan }: { projectId: string; plan: SlabPlan[] } = await req.json();
//   if (!projectId || !plan?.length) return Response.json({ error: "projectId and plan required" }, { status: 400 });
//
//   const project = await prisma.fabProject.findUnique({
//     where: { id: projectId },
//     include: { drawings: { include: { requirements: true } } },
//   });
//   if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
//
//   // Build two lookup maps:
//   //   1. serialNumber (pieceLabel) -> requirement  [new flow: labels are plain integers]
//   //   2. "drawingNumber-pieceLabel" -> requirement  [legacy flow]
//   type ReqInfo = { id: string; label: string; quantity: number; allocated: boolean };
//   const bySerial = new Map<string, ReqInfo>();
//   const byComposite = new Map<string, ReqInfo>();
//   for (const d of project.drawings) {
//     for (const r of d.requirements) {
//       const composite = `${d.drawingNumber}-${r.pieceLabel}`;
//       const info: ReqInfo = { id: r.id, label: composite, quantity: r.quantity, allocated: false };
//       if (r.pieceLabel) bySerial.set(r.pieceLabel, info);
//       byComposite.set(composite, info);
//     }
//   }
//
//   const applied: { reqId: string; label: string; slabCode: string; page: number; qty: number }[] = [];
//   const unmatchedLabels: string[] = [];
//
//   for (const slabPlan of plan) {
//     // Find or create placeholder slab (keyed by stockSheet + page)
//     const slabCode = `${slabPlan.stockSheet}_p${slabPlan.page}`;
//     let slab = await prisma.fabSlab.findFirst({ where: { projectId, slabCode } });
//     if (!slab) {
//       slab = await prisma.fabSlab.create({
//         data: { projectId, slabCode, colour: "", totalArea: 0, availableArea: 0 },
//       });
//     }
//
//     for (const entry of slabPlan.labels) {
//       // Try serial number lookup first, then legacy composite
//       const req = bySerial.get(entry.label) ?? byComposite.get(entry.label);
//       if (!req) { unmatchedLabels.push(entry.label); continue; }
//       if (req.allocated) continue;
//       req.allocated = true;
//
//       await prisma.fabRequirementAllocation.deleteMany({ where: { requirementId: req.id } });
//       await prisma.fabRequirementAllocation.create({
//         data: { requirementId: req.id, slabId: slab.id, allocatedQuantity: entry.qty },
//       });
//       await prisma.fabRequirement.update({
//         where: { id: req.id }, data: { status: "ALLOCATED" },
//       });
//
//       applied.push({ reqId: req.id, label: req.label, slabCode, page: slabPlan.page, qty: entry.qty });
//     }
//   }
//
//   const unmatched = [...bySerial.values()].filter(r => !r.allocated).map(r => r.label);
//
//   return Response.json({
//     success: true,
//     applied: applied.length,
//     appliedList: applied,
//     unmatched,
//     unmatchedLabels,
//   });
// }
