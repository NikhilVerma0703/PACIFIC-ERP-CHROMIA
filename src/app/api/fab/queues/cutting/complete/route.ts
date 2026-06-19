import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { slabId, pieceIds } = await req.json();
  if (!slabId || !pieceIds?.length) return Response.json({ error: "slabId and pieceIds required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    for (const pieceId of pieceIds) {
      // Mark CUTTING PieceOperation complete
      await tx.fabPieceOperation.updateMany({
        where: { pieceId, operationType: "CUTTING", isCompleted: false },
        data: { isCompleted: true, completedAt: new Date() },
      });
      // Update piece status
      await tx.fabPiece.update({
        where: { id: pieceId },
        data: { status: "CUT" },
      });
    }
  });

  return Response.json({ success: true });
}
