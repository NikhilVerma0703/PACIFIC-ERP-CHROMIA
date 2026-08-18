// POST /api/fab/queues/cutting/complete-job
// Body: { slabJobId: string }
// Marks a CLO FabSlabJob as COMPLETED and cascades: every piece of that slab has
// its CUTTING operation completed and moves to CUT.
//
// IT NO LONGER CREATES PIECES, and that is the point of the change that removed
// the branch. It used to carry an AUTO-CREATE path — "if this slab has no
// fab_piece rows, mint them from its allocations" — written because a slab
// really could reach the cut queue with nothing on it: the only thing that
// created pieces was /api/fab/supervisor/release-project, called from the
// requirement-first PlanningBoard, which was retired 2026-08 with nothing put in
// its place. The branch minted pieces under its OWN code format,
// `{projectCode}-{label}-{NNN}-{slabSuffix}`, against release's
// `{projectCode}-{NNNN}`, so the same shop floor carried two incompatible
// numbering schemes depending on which door a piece came through, and only one
// of them was numbered per project.
//
// /api/fab/approve-slab now creates a slab's pieces at the moment the supervisor
// sends it to the cutter — in the same transaction as the job, and it refuses to
// send a slab that would have none. The state this branch existed for is
// therefore unreachable, and it is deleted rather than left standing as a second
// way to make a piece. A job that still somehow has none completes and SAYS so,
// rather than silently inventing the work.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId = g.user.id as string;

  const { slabJobId } = await req.json();
  if (!slabJobId) return Response.json({ error: "slabJobId required" }, { status: 400 });

  const now = new Date();

  const slabJob = await prisma.fabSlabJob.findUnique({
    where: { id: slabJobId },
    include: {
      slab: {
        include: {
          pieces: { select: { id: true } },
          requirementAllocations: {
            select: {
              requirement: {
                select: {
                  // select slabId so we can filter to THIS slab only
                  pieces: { select: { id: true, slabId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!slabJob) return Response.json({ error: "Slab job not found" }, { status: 404 });

  const machineSession = await prisma.fabMachineSession.findFirst({
    where: { userId, isActive: true },
    select: { machineId: true },
  });

  // Discover pieces that belong specifically to THIS slab.
  // After the multi-slab fix, requirement.pieces can include pieces from OTHER slabs
  // (same requirement allocated to multiple CLO slabs). Filter to this slab only.
  const pieceIdSet = new Set<string>();
  for (const p of slabJob.slab.pieces) pieceIdSet.add(p.id);
  for (const alloc of slabJob.slab.requirementAllocations) {
    for (const p of alloc.requirement.pieces) {
      if (p.slabId === slabJob.slabId) pieceIdSet.add(p.id);
    }
  }
  const pieceIds = [...pieceIdSet];

  // ALREADY DONE? STOP. The cascade below is idempotent on its own now that the
  // auto-create branch is gone — it only completes CUTTING rows that are still
  // open — but the compare-and-set inside the transaction is what actually makes
  // a double-click safe, and this saves the round-trip.
  if (slabJob.status === "COMPLETED") {
    return Response.json({ success: true, alreadyCompleted: true, piecesUpdated: 0 });
  }

  // Set false by the transaction when another request won the race, so the
  // response cannot claim work it did not do — it reported piecesUpdated: N
  // while writing nothing.
  let applied = true;

  await prisma.$transaction(async (tx) => {
    // 1. Mark the slab job complete — conditionally, so two concurrent requests
    //    cannot both proceed into the cascade. The loser writes nothing.
    const done = await tx.fabSlabJob.updateMany({
      where: { id: slabJobId, status: { not: "COMPLETED" } },
      data: {
        status:     "COMPLETED",
        endTime:    now,
        operatorId: userId,
        machineId:  machineSession?.machineId ?? undefined,
      },
    });
    if (done.count === 0) { applied = false; return; }   // another request got there first

    if (pieceIds.length > 0) {
      // Update existing pieces
      await tx.fabPieceOperation.updateMany({
        where: { pieceId: { in: pieceIds }, operationType: "CUTTING", isCompleted: false },
        data:  { isCompleted: true, completedAt: now },
      });
      // Guard: only advance PENDING pieces — never regress a piece that already moved forward
      await tx.fabPiece.updateMany({
        where: { id: { in: pieceIds }, status: "PENDING" },
        data:  { status: "CUT" },
      });
    }
  });

  if (!applied) return Response.json({ success: true, alreadyCompleted: true, piecesUpdated: 0 });

  // A job with nothing on it is now a fact worth stating rather than a cue to
  // invent pieces. It can only be a slab that was sent to the cutter before
  // approve-slab started creating them; release it with
  // /api/fab/supervisor/release-project, or send the slab again once it has
  // been put back on the board.
  //
  // LOGGED as well as returned. The cut queue's only alert slot reads "Not
  // saved. <message>", which would be a lie here — the job IS complete — so the
  // field is carried for a screen that can word it properly and the server log
  // is what makes the case findable in the meantime.
  if (pieceIds.length === 0) {
    const warning =
      `Slab ${slabJob.slab.slabCode} is marked cut, but no pieces are recorded against it, ` +
      `so nothing moved on to polishing. It was sent to the cutter before pieces were created ` +
      `at send-to-cutting — tell the supervisor before the stone leaves the saw.`;
    console.warn("[cutting/complete-job] completed a slab job with no pieces", { slabJobId, slabId: slabJob.slabId, warning });
    return Response.json({ success: true, piecesUpdated: 0, warning });
  }

  return Response.json({ success: true, piecesUpdated: pieceIds.length });
}
