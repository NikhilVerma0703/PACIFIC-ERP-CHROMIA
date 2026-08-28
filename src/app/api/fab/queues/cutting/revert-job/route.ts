// POST /api/fab/queues/cutting/revert-job
// Body: { slabJobId: string }
// Reverts a completed CLO slab job back to READY and undoes the piece cascade:
//   - FabPiece.status -> PENDING
//   - CUTTING FabPieceOperation.isCompleted -> false
// Uses same dual-path piece discovery as complete-job.
//
// ───────────────────────────── IT UNDOES A MISCLICK, NOT A DAY'S WORK ───────
// This route existed to fix the case it is used for ninety-nine times in a
// hundred: the cutter pressed Complete on the wrong slab and says so ten seconds
// later. Nothing has moved; putting the pieces back to PENDING is exactly right.
//
// It used to do the same thing when the pieces HAD moved, and that was a hole.
// `updateMany({ where: { id: { in: pieceIds } } })` does not care what state a
// piece is in, so reverting a week-old job walked backwards over the entire
// floor: a PACKAGED piece returned to PENDING while keeping polishing_completed,
// sink_completed and fabrication_completed set and its fab_package_piece row
// intact — so routing sent it straight back to packaging and it was packed into
// a SECOND package, counted twice, and shipped once. A REJECTED piece quietly
// lost its rejection and rejoined the queue as good stone.
//
// complete-job already had the mirror of this guard — "only advance PENDING
// pieces, never regress a piece that already moved forward". This is that rule
// pointing the other way: a cut can be undone only while cutting is all that has
// happened. Past that the answer is no, said out loud with a count, because the
// supervisor's real problem then is not the slab job — it is the piece that
// should not have been polished, and it has its own screen.

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
          // status comes along now: it is what decides whether this piece may
          // be walked backwards at all.
          pieces: { select: { id: true, status: true } },
          requirementAllocations: {
            include: {
              requirement: {
                include: { pieces: { select: { id: true, slabId: true, status: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!slabJob) return Response.json({ error: "Slab job not found" }, { status: 404 });

  // Mirror complete-job's discovery: only pieces belonging to THIS slab
  const pieceById = new Map<string, { id: string; status: string }>();
  for (const p of slabJob.slab.pieces) pieceById.set(p.id, { id: p.id, status: String(p.status) });
  for (const alloc of slabJob.slab.requirementAllocations) {
    for (const p of alloc.requirement.pieces) {
      if (p.slabId === slabJob.slabId) pieceById.set(p.id, { id: p.id, status: String(p.status) });
    }
  }
  const pieceIds = [...pieceById.keys()];

  // WHAT MAY BE WALKED BACK. Only the three states in which cutting is the last
  // thing that happened. Everything else has downstream work, a package or a
  // rejection hanging off it that this route does not undo and must not orphan.
  const REVERTABLE = new Set(["PENDING", "CUTTING", "CUT"]);
  const movedOn = [...pieceById.values()].filter((p) => !REVERTABLE.has(p.status));

  if (movedOn.length > 0) {
    // Counted by stage, because "3 pieces have moved on" and "3 pieces are
    // already packed" are different problems to the person reading it.
    const byStage = new Map<string, number>();
    for (const p of movedOn) byStage.set(p.status, (byStage.get(p.status) ?? 0) + 1);
    const where = [...byStage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${n} ${s.toLowerCase().replace(/_/g, " ")}`)
      .join(", ");
    return Response.json({
      error:
        `This cut cannot be undone — ${movedOn.length} of its ${pieceIds.length} pieces have ` +
        `already moved past cutting (${where}). Undoing it would send packed and rejected ` +
        `pieces back to the saw. Fix the individual piece instead.`,
      movedOn: movedOn.length,
      pieces: pieceIds.length,
    }, { status: 409 });
  }

  let reverted = 0;

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

      // 3. Reset piece status back to PENDING — and ONLY for pieces still at
      //    cutting. The check above already refused the job if any piece had
      //    moved on, but that read and this write are not the same instant: a
      //    polisher can start a piece in between. Repeating the rule in the
      //    WHERE clause is what makes it true at the moment of writing rather
      //    than at the moment of asking.
      reverted = (await tx.fabPiece.updateMany({
        where: { id: { in: pieceIds }, status: { in: ["PENDING", "CUTTING", "CUT"] } },
        data:  { status: "PENDING" },
      })).count;
    }
  });

  return Response.json({ success: true, reverted, pieces: pieceIds.length });
}
