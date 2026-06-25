import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { pieceId } = await req.json();
  if (!pieceId) return Response.json({ error: "pieceId required" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType: "FABRICATION", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    await tx.fabPiece.update({
      where: { id: pieceId },
      data: { fabricationCompleted: true, status: "FABRICATED" },
    });
  });

  return Response.json({ success: true });
}
