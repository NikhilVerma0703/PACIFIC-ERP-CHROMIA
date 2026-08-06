import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { statusFromFlags } from "@/lib/fab/routing";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceId } = await req.json();
  if (!pieceId) return Response.json({ error: "pieceId required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType: "POLISHING", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    // The status is recomputed from the flags rather than pinned to "POLISHED":
    // a piece whose sink was already cut must not go BACKWARDS to POLISHED just
    // because polishing finished second. statusFromFlags orders the stages.
    const piece = await tx.fabPiece.update({
      where: { id: pieceId },
      data: { polishingCompleted: true },
    });
    await tx.fabPiece.update({
      where: { id: pieceId },
      data: { status: statusFromFlags(piece) as never },
    });
    // There used to be an `if (ready)` block here that ran
    // updateMany({ where: { isCompleted: false }, data: { isCompleted: false } })
    // — a write that set the value it had already filtered on, so it could never
    // change a row. The packaging queue derives readiness itself via
    // isReadyForPackaging, so nothing needs to be written here at all.
  });

  return Response.json({ success: true });
}
