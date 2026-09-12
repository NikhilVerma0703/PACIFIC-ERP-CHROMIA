// PATCH /api/office/commercial/dispatch-check/[plId]/pieces/[pieceId]
// { fit: "FIT" | "UNFIT", unfitReason? } — one cut-to-size line's verdict.
//
// The slab route beside this one, for the second kind of line (round four,
// answer 1: "a cut to size also gets a physical check piece by piece"). Same
// verdict body (fitPatch), same two gates, same late-verdict log, because it is
// the same job: a man standing next to a crate saying whether what is in it is
// what should ship. Two routes rather than one that switches on a kind, so that
// neither an id nor a reason can be applied to the wrong table by a typo in a
// query string — but every DECISION either of them takes comes out of
// packing-rules, so they cannot drift apart on what a verdict means.
//
// UNFIT must say why, for the same reason it must on a slab: it rejects the
// whole list and pulls the order back to PACKING, and "no reason given" is not
// something Commercial can act on at eight in the evening with a container
// booked.
//
// WHAT IS DIFFERENT IS WHAT HAPPENS AFTERWARDS, and it is not in this file: an
// unfit slab goes back to finished goods, an unfit piece has nowhere to go and
// stays on the list flagged (the verify route). Nothing here knows that, and
// nothing here should — this route records a verdict.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { fitPatch, canVerify, canRecheck, fitCounts, checkerMaySee, checkerPieceView } from "@/lib/commercial/packing-rules";
import { pieceLabel } from "@/lib/commercial/pieces-rules";
import { db, paramTwo } from "../../../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string; pieceId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("verify", "dispatchCheck");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, pieceId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "pieceId");
    const list = await db.commercialPackingList.findUnique({ where: { id: plId }, select: { id: true, number: true, status: true, orderId: true } });
    // Same two gates as the GET on this segment: a list outside the dispatch
    // check's statuses does not exist here, so a DRAFT list is a 404 and not a
    // status message that confirms it.
    if (!list || !checkerMaySee(String(list.status))) fail(404, "Packing list not found");
    const late = canRecheck(String(list.status));
    if (!canVerify(list.status) && !late) {
      fail(409, `${list.number} is already rejected — reopen it before checking again`);
    }
    const piece = await db.commercialPackedPiece.findUnique({
      where: { id: pieceId },
      select: { id: true, packingListId: true, crateNo: true, pieceNo: true, design: true, fit: true },
    });
    if (!piece || piece.packingListId !== plId) fail(404, "Cut-to-size line not found on this list");

    const body = await readBody<{ fit?: unknown; unfitReason?: unknown }>(req);
    const patch = fitPatch(body.fit, body.unfitReason);
    if (!patch.ok) fail(400, patch.reason);

    const stamp = actorStamp(g.user);
    const updated = await db.commercialPackedPiece.update({
      where: { id: pieceId },
      data: { fit: patch.fit, unfitReason: patch.unfitReason, checkedById: stamp.id, checkedAt: new Date() },
    });
    const label = pieceLabel(piece);
    if (late && String(piece.fit) !== patch.fit) {
      // A verdict on a list the check has already concluded is logged on the
      // order, because nothing else re-runs that conclusion and the log is
      // where Commercial learns why the truck is waiting. The note says recut
      // rather than swap: a cut piece has no shelf of replacements.
      await logOrderEvent(list.orderId, "note", {
        note: patch.fit === "UNFIT"
          ? `Packing list ${list.number} (${String(list.status).toLowerCase()}): ${label} marked UNFIT at loading (${patch.unfitReason}) — nothing ships until it is recut and repacked`
          : `Packing list ${list.number} (${String(list.status).toLowerCase()}): ${label} checked fit`,
        by: g.user,
        payload: { packingListId: plId, pieceId, label, fit: patch.fit, unfitReason: patch.unfitReason, late: true },
      });
    }
    const [slabs, pieces]: [Array<{ fit: string }>, Array<{ fit: string }>] = await Promise.all([
      db.commercialPackedSlab.findMany({ where: { packingListId: plId }, select: { fit: true } }),
      db.commercialPackedPiece.findMany({ where: { packingListId: plId }, select: { fit: true } }),
    ]);
    // The line as the floor screen reads it, not the row as it is stored: this
    // segment answers a login that may check what is in a crate and nothing else.
    return json(plain({ piece: checkerPieceView(plain<Record<string, unknown>>(updated)), fit: fitCounts(slabs, pieces) }));
  });
}
