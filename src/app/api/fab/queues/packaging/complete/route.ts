import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceIds, packageCode, remarks } = await req.json();
  if (!pieceIds?.length) return Response.json({ error: "pieceIds required" }, { status: 400 });

  // Idempotency guard: reject if any piece is already packaged (prevents double-submit)
  const alreadyPackaged = await prisma.fabPiece.count({
    where: { id: { in: pieceIds }, status: "PACKAGED" },
  });
  if (alreadyPackaged > 0)
    return Response.json(
      { error: `${alreadyPackaged} piece(s) already packaged — refresh and try again` },
      { status: 409 }
    );

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
