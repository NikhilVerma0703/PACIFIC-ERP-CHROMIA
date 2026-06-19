import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { pieceIds, packageCode, remarks } = await req.json();
  if (!pieceIds?.length) return Response.json({ error: "pieceIds required" }, { status: 400 });

  const code = packageCode || `PKG-${Date.now()}`;

  const pkg = await prisma.$transaction(async (tx) => {
    const p = await tx.fabPackage.create({
      data: {
        packageCode: code,
        remarks: remarks ?? null,
        pieces: { create: pieceIds.map((pid: string) => ({ pieceId: pid })) },
      },
    });
    await tx.fabPiece.updateMany({
      where: { id: { in: pieceIds } },
      data: { status: "PACKAGED" },
    });
    await tx.fabPieceOperation.updateMany({
      where: { pieceId: { in: pieceIds }, operationType: "PACKAGING", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    return p;
  });

  return Response.json({ success: true, packageCode: pkg.packageCode });
}
