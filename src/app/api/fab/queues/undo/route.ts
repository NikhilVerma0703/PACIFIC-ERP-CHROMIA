import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

// Maps operation type → which FabPiece field(s) to reset and what status to revert to
const TYPE_REVERT: Record<string, {
  pieceData: Record<string, unknown>;
  revertStatus?: string;
}> = {
  CUTTING:     { pieceData: { status: "PENDING" },                              revertStatus: "PENDING" },
  POLISHING:   { pieceData: { polishingCompleted: false, status: "CUT" } },
  SINK_CUTTING:{ pieceData: { sinkCompleted: false,      status: "CUT" } },
  FABRICATION: { pieceData: { fabricationCompleted: false, status: "CUT" } },
  PACKAGING:   { pieceData: { status: "CUT" } },
};

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceId, operationType } = await req.json();
  if (!pieceId || !operationType) return Response.json({ error: "pieceId and operationType required" }, { status: 400 });

  const revert = TYPE_REVERT[operationType];
  if (!revert) return Response.json({ error: "Invalid operationType" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    // Un-complete the piece operation
    await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType, isCompleted: true },
      data: { isCompleted: false, completedAt: null },
    });
    // Revert piece fields
    await tx.fabPiece.update({
      where: { id: pieceId },
      data: revert.pieceData as any,
    });
  });

  return Response.json({ success: true });
}
