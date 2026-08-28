// POST /api/fab/manager/pos/rows/[id]/merge
// Body: { intoId: string, sinkQuantity?: number | null }
//
// FOLD A ROW BACK INTO THE ONE IT WAS SPLIT FROM — the undo the board promises.
//
// A whole-row move undoes itself: one number goes back to what it was. A SPLIT
// made a second row, so undoing it means merging that row away again. Without
// this, one mis-typed partial leaves a PO permanently one row longer than the
// order, repairable only by deleting a row by hand and retyping a quantity.
//
// `id` is the row that DISAPPEARS. `intoId` is the one that survives and takes
// the quantity — the board passes the row it kept, so the letter that was there
// before the split is the letter that is there after it.
//
// `sinkQuantity` restores what the surviving row held BEFORE the split, which is
// usually NULL — "nobody had decided". Undo has to be able to put that back, or
// the first undo silently converts an unanswered row into an answered one.
//
// THE RULES LIVE IN lib/fab/sinkSplit.ts (planSinkMerge), which imports nothing
// and is tested. Two rows may only merge if they are genuinely the same piece —
// same PO, same length, same width — and neither has moved on. Checking the
// DIMENSIONS rather than a "these came from each other" flag is deliberate: a
// flag is one more thing to maintain and to get wrong, and the dimensions are
// the thing that actually matters. Merging two different sizes would not undo
// anything; it would quietly reprice a customer's order.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { deriveRoutingFlags, resolveSinkQuantity } from "@/lib/fab/requirement-derive";
import { rowSqft } from "@/lib/fab/requirementRow";
import { planSinkMerge } from "@/lib/fab/sinkSplit";

const ROW_SELECT = {
  id: true, poId: true, projectId: true,
  length: true, width: true, quantity: true, sinkQuantity: true,
  allocations: { select: { allocatedQuantity: true } },
  _count: { select: { pieces: true } },
  po: { select: { pdfImportedAt: true } },
} as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { id } = await params;
  let body: { intoId?: unknown; sinkQuantity?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const intoId = String(body.intoId ?? "").trim();
  if (!intoId) return Response.json({ error: "intoId required" }, { status: 400 });

  const [from, into] = await Promise.all([
    prisma.fabRequirement.findUnique({ where: { id }, select: ROW_SELECT }),
    prisma.fabRequirement.findUnique({ where: { id: intoId }, select: ROW_SELECT }),
  ]);
  if (!from || !into) {
    return Response.json(
      { error: "One of those rows no longer exists — reload and look again." },
      { status: 404 },
    );
  }
  if (!into.po?.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then change rows." }, { status: 409 });
  }

  const shape = (r: typeof from) => ({
    id: r.id,
    quantity: r.quantity,
    lengthIn: r.length,
    widthIn: r.width,
    poId: r.poId,
    allocatedQuantity: r.allocations.reduce((s, a) => s + a.allocatedQuantity, 0),
    releasedPieces: r._count.pieces,
  });

  const plan = planSinkMerge(shape(into), shape(from));
  // 409, not 400: nothing is malformed — the rows are in a state that refuses
  // this, and the reason says which state.
  if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });

  // NULL IS A REAL VALUE HERE. `sinkQuantity: null` restores "nobody decided",
  // which is what the row held before the split; omitting the field entirely
  // leaves the survivor's current count alone. They are different requests and
  // `undefined` is the only way to say the second.
  const restoring = Object.prototype.hasOwnProperty.call(body, "sinkQuantity");
  const nextSink = !restoring
    ? resolveSinkQuantity(into.sinkQuantity, plan.quantity)
    : body.sinkQuantity == null
      ? null
      : resolveSinkQuantity(Number(body.sinkQuantity), plan.quantity);

  const sq = rowSqft(into.length ?? 0, into.width ?? 0, plan.quantity);
  const flags = deriveRoutingFlags({ sinkQuantity: nextSink, quantity: plan.quantity });

  await prisma.$transaction(async (tx) => {
    await tx.fabRequirement.update({
      where: { id: plan.intoId },
      data: {
        quantity: plan.quantity,
        sinkQuantity: nextSink,
        sqftPerPiece: sq.sqftPerPiece,
        totalSqft: sq.totalSqft,
        sinkRequired: flags.sinkRequired,
        fabricationRequired: flags.fabricationRequired,
        polishRequired: flags.polishRequired,
      },
    });
    await tx.fabRequirement.delete({ where: { id: plan.fromId } });
    // fab_project.number_of_pieces is NOT touched: 40 + 20 became 60, and the
    // project still has 60. The split did not move it either.
  });

  return Response.json({
    success: true,
    intoId: plan.intoId,
    removedId: plan.fromId,
    quantity: plan.quantity,
    sinkQuantity: nextSink,
  });
}
