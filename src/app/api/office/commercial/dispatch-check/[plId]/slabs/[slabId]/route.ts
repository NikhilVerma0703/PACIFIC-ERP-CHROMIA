// PATCH /api/office/commercial/dispatch-check/[plId]/slabs/[slabId]
// { fit: "FIT" | "UNFIT", unfitReason? } — one slab's verdict from the floor.
//
// UNFIT must say why: an unfit slab sends the whole list back and pulls the
// order to PACKING, and "no reason given" is not something Commercial can act
// on at eight in the evening with a container booked.
//
// The cut-to-size lines are checked the same way by ../pieces/[pieceId] (round
// four, answer 1). Two routes, because two tables and two id spaces, but one
// verdict body and one set of gates — both out of packing-rules, so they cannot
// come to mean different things.
//
// A LATE VERDICT (answer 30). On a VERIFIED or FINAL list the check is over,
// but the loading bay is where a slab passed last week turns out to be cracked.
// The checker marks it UNFIT here — the list keeps its status, nothing is
// unpacked, the order stays put — and the dispatch route refuses until
// Commercial swaps the slab (answer 31). A verdict on such a list is logged on
// the order, because nothing else re-runs the conclusion and the log is where
// Commercial learns why the truck is waiting.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { fitPatch, canVerify, canRecheck, fitCounts, checkerMaySee, checkerSlabView, fmtSlabNo } from "@/lib/commercial/packing-rules";
import { db, paramTwo } from "../../../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string; slabId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("verify", "dispatchCheck");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, slabId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "slabId");
    const list = await db.commercialPackingList.findUnique({ where: { id: plId }, select: { id: true, number: true, status: true, orderId: true } });
    // Same two gates as the GET beside this one: a list outside the dispatch
    // check's statuses does not exist here, so a DRAFT list is a 404 and not a
    // status message that confirms it.
    if (!list || !checkerMaySee(String(list.status))) fail(404, "Packing list not found");
    const late = canRecheck(String(list.status));
    if (!canVerify(list.status) && !late) {
      fail(409, `${list.number} is already rejected — reopen it before checking again`);
    }
    const slab = await db.commercialPackedSlab.findUnique({ where: { id: slabId }, select: { id: true, packingListId: true, slabNumber: true, fit: true } });
    if (!slab || slab.packingListId !== plId) fail(404, "Slab not found on this list");

    const body = await readBody<{ fit?: unknown; unfitReason?: unknown }>(req);
    const patch = fitPatch(body.fit, body.unfitReason);
    if (!patch.ok) fail(400, patch.reason);

    const stamp = actorStamp(g.user);
    const updated = await db.commercialPackedSlab.update({
      where: { id: slabId },
      data: { fit: patch.fit, unfitReason: patch.unfitReason, checkedById: stamp.id, checkedAt: new Date() },
    });
    if (late && String(slab.fit) !== patch.fit) {
      await logOrderEvent(list.orderId, "note", {
        note: patch.fit === "UNFIT"
          ? `Packing list ${list.number} (${String(list.status).toLowerCase()}): slab #${fmtSlabNo(Number(slab.slabNumber))} marked UNFIT at loading (${patch.unfitReason}) — nothing ships until it is swapped`
          : `Packing list ${list.number} (${String(list.status).toLowerCase()}): slab #${fmtSlabNo(Number(slab.slabNumber))} checked fit`,
        by: g.user,
        payload: { packingListId: plId, slabId, slabNumber: slab.slabNumber, fit: patch.fit, unfitReason: patch.unfitReason, late: true },
      });
    }
    // The count is over BOTH kinds of line (round four, answer 1): the screen's
    // progress bar and its Verify button read it, and a count of slabs alone on
    // a list that also packs pieces says the check is finished when it is not.
    const [slabs, pieces]: [Array<{ fit: string }>, Array<{ fit: string }>] = await Promise.all([
      db.commercialPackedSlab.findMany({ where: { packingListId: plId }, select: { fit: true } }),
      db.commercialPackedPiece.findMany({ where: { packingListId: plId }, select: { fit: true } }),
    ]);
    // The slab as the floor screen reads it, not the row as it is stored: this
    // segment answers a login that may check slabs and nothing else.
    return json(plain({ slab: checkerSlabView(plain<Record<string, unknown>>(updated)), fit: fitCounts(slabs, pieces) }));
  });
}
