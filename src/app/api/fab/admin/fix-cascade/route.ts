// RETIRED 2026-08 -- superseded fabrication intake.
//
// A repair tool, not a feature. It existed because two different code paths created
// FabPiece rows (release-project, and the CLO allocation Excel which skipped it), so
// completed slab jobs could be left with pieces stuck in PENDING or with no pieces at
// all. This route retro-fixed both.
//
// The second piece-creation path went with the CLO round-trip in mid-2026: pieces are
// now created in one place only, so there is no divergence left to repair. The two
// buttons that called it (the supervisor cut queue and the CEO dashboard) are retired
// with it.
//
// HOW THIS IS RETIRED. The file stays in the tree, so the URL stays routable;
// every handler it used to export now returns 410 Gone naming the replacement,
// rather than being deleted (which would 404) or left with no handler (which
// would 405 and read like a bug). The original implementation is preserved
// underneath, commented out line by line -- comment it out, do not delete it.

const GONE =
  "This endpoint has been retired. It repaired damage caused by two competing piece-creation paths; only one path creates pieces now, so there is nothing to repair.";

export async function POST() {
  return Response.json({ error: GONE }, { status: 410 });
}

/* ---- original implementation, retired 2026-08 -------------------------- */
// // POST /api/fab/admin/fix-cascade
// // Retroactively fixes all COMPLETED FabSlabJob records.
// // Mode A: pieces exist but stuck in PENDING -> advance to CUT
// // Mode B: no FabPiece records at all (CLO project skipped release-project)
// //         -> CREATE pieces from FabRequirementAllocation, mark CUTTING complete
// // Safe to call multiple times. Requires FAB_ADMIN or ADMIN.
//
// import { prisma } from "@/lib/prisma";
// import { fabGate } from "@/lib/fab/access";
// import { planPieceOperations } from "@/lib/fab/pieceOperations";
//
// export async function POST() {
//   const g = await fabGate("MANAGER");
//   if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
//
//   const now = new Date();
//
//   const completedJobs = await prisma.fabSlabJob.findMany({
//     where: { status: "COMPLETED" },
//     include: {
//       slab: {
//         include: {
//           pieces: { select: { id: true, status: true } },
//           requirementAllocations: {
//             include: {
//               requirement: {
//                 include: {
//                   pieces: { select: { id: true, status: true } },
//                   project: { select: { projectCode: true } },
//                 },
//               },
//             },
//           },
//         },
//       },
//     },
//   });
//
//   let jobsFixed     = 0;
//   let piecesFixed   = 0;
//   let piecesCreated = 0;
//
//   for (const job of completedJobs) {
//     const completedAt = job.endTime ?? now;
//
//     // Union both discovery paths (deduped)
//     const pieceMap = new Map<string, { id: string; status: string }>();
//     for (const p of job.slab.pieces) pieceMap.set(p.id, p);
//     for (const alloc of job.slab.requirementAllocations) {
//       for (const p of alloc.requirement.pieces) {
//         if (!pieceMap.has(p.id)) pieceMap.set(p.id, p);
//       }
//     }
//
//     if (pieceMap.size === 0 && job.slab.requirementAllocations.length > 0) {
//       // Mode B: create pieces from CLO allocations
//       const slabSuffix = job.slabId.slice(-4);
//       let reqIdx = 0;
//       let createdThisJob = 0;
//
//       await prisma.$transaction(async (tx) => {
//         for (const alloc of job.slab.requirementAllocations) {
//           const req         = alloc.requirement;
//           const projectCode = req.project?.projectCode ?? "CLO";
//           const labelBase   = req.pieceLabel ?? String(reqIdx + 1).padStart(3, "0");
//           reqIdx++;
//
//           for (let i = 0; i < alloc.allocatedQuantity; i++) {
//             const pieceCode = `${projectCode}-${labelBase}-${String(i + 1).padStart(3, "0")}-${slabSuffix}`;
//
//             // Idempotent: skip if already exists
//             const existing = await tx.fabPiece.findUnique({ where: { pieceCode } });
//             if (existing) continue;
//
//             const piece = await tx.fabPiece.create({
//               data: {
//                 pieceCode,
//                 projectId:           req.projectId,
//                 requirementId:       req.id,
//                 slabId:              job.slabId,
//                 drawingId:           req.drawingId ?? undefined,
//                 length:              req.length,
//                 width:               req.width,
//                 shapeType:           req.shapeType ?? "RECTANGLE",
//                 hasSink:             req.sinkRequired,
//                 polishRequired:      req.polishRequired,
//                 fabricationRequired: req.fabricationRequired,
//                 status:              "CUT",
//               },
//             });
//
//             // `sequence` used to be advanced only inside the sink branch, so a
//             // polish-only piece got POLISHING = 2 and PACKAGING = 2. There is no
//             // @@unique([pieceId, sequence]), so it never threw — it just wrote a
//             // route sheet with no usable order. planPieceOperations numbers it.
//             await tx.fabPieceOperation.createMany({
//               data: planPieceOperations(req).map(op => ({
//                 pieceId:       piece.id,
//                 operationType: op.operationType,
//                 sequence:      op.sequence,
//                 isRequired:    true,
//                 ...(op.operationType === "CUTTING" ? { isCompleted: true, completedAt } : {}),
//               })),
//             });
//             createdThisJob++;
//           }
//         }
//       });
//
//       if (createdThisJob > 0) { jobsFixed++; piecesCreated += createdThisJob; }
//     } else {
//       // Mode A: pieces exist but may be stuck in PENDING
//       const stuckIds = [...pieceMap.values()]
//         .filter(p => p.status === "PENDING")
//         .map(p => p.id);
//
//       if (stuckIds.length === 0) continue;
//
//       await prisma.$transaction(async (tx) => {
//         await tx.fabPieceOperation.updateMany({
//           where: { pieceId: { in: stuckIds }, operationType: "CUTTING", isCompleted: false },
//           data:  { isCompleted: true, completedAt },
//         });
//         await tx.fabPiece.updateMany({
//           where: { id: { in: stuckIds } },
//           data:  { status: "CUT" },
//         });
//       });
//
//       jobsFixed++;
//       piecesFixed += stuckIds.length;
//     }
//   }
//
//   const totalAffected = piecesFixed + piecesCreated;
//   return Response.json({
//     success: true,
//     jobsScanned:   completedJobs.length,
//     jobsFixed,
//     piecesFixed,
//     piecesCreated,
//     message: totalAffected > 0
//       ? `Fixed ${jobsFixed} job(s): created ${piecesCreated} piece(s), unstuck ${piecesFixed} piece(s). Queues will now reflect them.`
//       : "All pieces already up to date.",
//   });
// }
