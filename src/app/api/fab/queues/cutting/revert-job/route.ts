// POST /api/fab/queues/cutting/revert-job
// Body: { slabJobId: string }
// Reverts a completed CLO slab job back to READY and undoes the piece cascade:
//   - FabPiece.status -> PENDING
//   - CUTTING FabPieceOperation.isCompleted -> false
// Uses same dual-path piece discovery as complete-job.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { slabJobId } = await req.json();
  if (!slabJobId) return Response.json({ error: "slabJobId required" }, { status: 400 });

  const slabJob = await prisma.fabSlabJob.findUnique({
    where: { id: slabJobId },
    include: {
      slab: {
        include: {
          pieces: { select: { id: true } },
          requirementAllocations: {
            include: {
              requirement: { include: { pieces: { select: { id: true, slabId: true } } } },
            },
          },
        },
      },
    },
  });
  if (!slabJob) return Response.json({ error: "Slab job not found" }, { status: 404 });

  // Mirror complete-job's discovery: only pieces belonging to THIS slab
  const pieceIdSet = new Set<string>();
  for (const p of slabJob.slab.pieces) pieceIdSet.add(p.id);
  for (const alloc of slabJob.slab.requirementAllocations) {
    for (const p of alloc.requirement.pieces) {
      if (p.slabId === slabJob.slabId) pieceIdSet.add(p.id);
    }
  }
  const pieceIds = [...pieceIdSet];

  await prisma.$transaction(async (tx) => {
    // 1. Revert the slab job back to READY
    await tx.fabSlabJob.update({
      where: { id: slabJobId },
      data:  { status: "READY", startTime: null, endTime: null },
    });

    if (pieceIds.length > 0) {
      // 2. Un-complete the CUTTING FabPieceOperation
      await tx.fabPieceOperation.updateMany({
        where: { pieceId: { in: pieceIds }, operationType: "CUTTING" },
        data:  { isCompleted: false, completedAt: null },
      });

      // 3. Reset piece status back to PENDING
      await tx.fabPiece.updateMany({
        where: { id: { in: pieceIds } },
        data:  { status: "PENDING" },
      });
    }
  });

  return Response.json({ success: true });
}
