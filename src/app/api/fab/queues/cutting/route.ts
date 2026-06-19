import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Group pieces by slab — cutter works slab by slab
  const allocations = await prisma.fabSlabAllocation.findMany({
    include: {
      piece: {
        include: {
          project: { select: { projectCode: true, customerName: true } },
          drawing: { select: { drawingNumber: true } },
          requirement: { select: { pieceLabel: true, description: true, length: true, width: true } },
          pieceOperations: { where: { operationType: "CUTTING" } },
        },
      },
      slab: true,
    },
  });

  // Only pieces not yet cut (CUTTING PieceOperation not completed)
  const pending = allocations.filter(a =>
    a.piece.pieceOperations.some(op => !op.isCompleted)
  );

  // Group by slab
  const slabMap = new Map<string, { slab: any; pieces: any[] }>();
  for (const alloc of pending) {
    const key = alloc.slabId;
    if (!slabMap.has(key)) slabMap.set(key, { slab: alloc.slab, pieces: [] });
    slabMap.get(key)!.pieces.push(alloc.piece);
  }

  return Response.json(Array.from(slabMap.values()));
}
