import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { statusFromFlags } from "@/lib/fab/routing";

// Maps operation type → which FabPiece flag(s) to clear. `revertStatus` used to
// sit here too, set on CUTTING only and never read by anything — the status is
// recomputed below instead, because a fixed one is wrong the moment a piece has
// more than one stage done. Undoing PACKAGING on a polished piece sent it back
// to "CUT" and lost the polish.
const TYPE_REVERT: Record<string, Record<string, unknown>> = {
  CUTTING:      { status: "PENDING" },
  POLISHING:    { polishingCompleted: false },
  SINK_CUTTING: { sinkCompleted: false },
  FABRICATION:  { fabricationCompleted: false },
  PACKAGING:    {},
};


export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceId, operationType } = await req.json();
  if (!pieceId || !operationType) return Response.json({ error: "pieceId and operationType required" }, { status: 400 });

  const revert = TYPE_REVERT[operationType];
  if (!revert) return Response.json({ error: "Invalid operationType" }, { status: 400 });

  const undone = await prisma.$transaction(async (tx) => {
    // Un-complete the piece operation. If nothing was completed there is
    // nothing to undo, and the piece must NOT be touched: reverting anyway
    // regressed pieces on a stale click — the operator undid an operation the
    // queue had already shown as undone, and knocked the piece back a stage.
    const cleared = await tx.fabPieceOperation.updateMany({
      where: { pieceId, operationType, isCompleted: true },
      data:  { isCompleted: false, completedAt: null },
    });
    if (cleared.count === 0) return false;

    const piece = await tx.fabPiece.update({
      where: { id: pieceId },
      data:  revert as never,
    });

    // Recompute the status from what is still ticked, rather than assuming.
    // Undoing the cut is the exception — it invalidates everything after it.
    const status = operationType === "CUTTING" ? "PENDING" : statusFromFlags(piece);
    if (piece.status !== status) {
      await tx.fabPiece.update({ where: { id: pieceId }, data: { status: status as never } });
    }

    // ---- UNDOING A PACK ALSO UNDOES WHAT IT FROZE ------------------------
    //
    // scripts/0066 stamps charged_edge / charged_sink / charged_at when a piece
    // is packed, and the packaging route writes that stamp ONCE — `AND
    // charged_at IS NULL` — so a piece packed, undone, and packed again would
    // silently keep the FIRST pack's figure and have it counted on the SECOND
    // pack's day. Undo the pack and the freeze goes with it; the next pack
    // writes a fresh one.
    //
    // The case this is really for: a row packed while edge_faces was still TOP,
    // unpacked, corrected to BOTH — which doubles the running feet — and packed
    // again. Without this the report keeps the single-face figure permanently,
    // which is the exact "half an invoice" outcome 0066 exists to prevent.
    //
    // RAW AND WRAPPED, like every other read of a 0066 column: a deploy running
    // ahead of the migration undoes the pack exactly as it does today and simply
    // has no stamp to clear.
    if (operationType === "PACKAGING") {
      try {
        await tx.$executeRaw`
          UPDATE fab_piece
             SET charged_edge = NULL, charged_sink = NULL, charged_at = NULL
           WHERE id = ${pieceId}`;
      } catch {
        // scripts/0066 not applied yet. Nothing was frozen, nothing to clear.
      }
    }
    return true;
  });

  if (!undone) return Response.json({ error: "Nothing to undo — that operation is not marked complete" }, { status: 409 });
  return Response.json({ success: true });
}
