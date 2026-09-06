// POST /api/office/commercial/dispatch-check/[plId]/verify — the dispatch
// team's conclusion. { note? }
//
// Refused while any slab is still PENDING: a list is verified because every
// slab was looked at, not because the checker reached the bottom of the screen.
//
//   all FIT  → VERIFIED, and the order moves DISPATCH_CHECK → READY.
//   any UNFIT → REJECTED. The unfit slabs go back to AVAILABLE and come OFF
//               the list (the FIT ones stay PACKED — they are in the crate and
//               nobody is unpacking a good slab), the note names each one and
//               why, and the order is pulled back to PACKING so Commercial
//               sees it as work to do rather than as ready to ship.
//
// A ROW IS ONLY DELETED FOR A SLAB THAT CAME BACK. The packed-slab row is the
// only thing in the module that points at the slab; deleting it for a slab the
// bridge did not actually restore leaves that slab PACKED and unfindable —
// which is exactly what happened when the restore could not read it. So the
// bridge's answer is read (restoredSlabs), the rows for the slabs it put back
// are deleted, and the rest STAY on the list with the failure written on them.
//
// WHAT COMES BACK IS THE FLOOR SCREEN'S SHAPE, NOT THE LOADER'S. This endpoint
// is reached by a verify-only login that commercialGate("view") refuses; it
// used to answer with the whole packing list, which carries the order's items
// with the customer's rates and amounts, the client's GSTIN, PAN and billing
// address and the order's payment terms. checkerListView is the same whitelist
// the GET beside this one uses.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder, moveOrder } from "@/lib/commercial/order-stage";
import { stageIndex } from "@/lib/commercial/stages";
import { unpackSlabs } from "@/lib/commercial/inventory-bridge";
import {
  verifyOutcome, rejectionNote, verificationNote, canVerify, checkerMaySee,
  checkerListView, restoredSlabs, strandedNote,
} from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, byOf, isAdminOf } from "../../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

/** The list as the dispatch check may see it — never the loader's own shape. */
const view = async (plId: string) => checkerListView(plain<Record<string, unknown>>(await loadList(plId)));

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("verify");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    // Outside the three statuses this segment covers the list does not exist,
    // for the same reason the GET says so: a status message would confirm a
    // DRAFT list to a login that may not know it is there.
    if (!checkerMaySee(list.status)) fail(404, "Packing list not found");
    if (!canVerify(list.status)) {
      fail(409, `${list.number} is ${list.status === "VERIFIED" ? "already verified" : "already rejected"} — it is not waiting for a check`);
    }
    const body = await readBody<{ note?: unknown }>(req);
    const note = str(body.note);

    const outcome = verifyOutcome(list.slabs.map((s) => ({ id: s.id, slabNumber: Number(s.slabNumber), fit: String(s.fit), unfitReason: (s.unfitReason as string | null) ?? null })));
    if (outcome.pending > 0) {
      return json({ error: `${outcome.pending} slab(s) have not been checked yet`, pending: outcome.pending }, 409);
    }

    const now = new Date();
    const stamp = actorStamp(g.user);

    if (outcome.ok) {
      const text = verificationNote(list.slabs.length, note);
      await db.commercialPackingList.update({
        where: { id: plId },
        data: { status: "VERIFIED", verifiedAt: now, verifiedById: stamp.id, verifiedByName: stamp.name, verificationNote: text },
      });
      await bumpOrder(list.orderId, "DISPATCH_CHECK", g.user, `Packing list ${list.number} checked`);
      await bumpOrder(list.orderId, "READY", g.user, `Packing list ${list.number} verified`);
      await logOrderEvent(list.orderId, "packing_verified", {
        note: `Packing list ${list.number} verified — ${text}`,
        by: g.user,
        payload: { packingListId: plId, number: list.number, slabs: list.slabs.length },
      });
      return json(plain({ list: await view(plId), verified: true, removed: [] }));
    }

    // Rejected.
    const unfitNumbers = outcome.unfit.map((u) => u.slabNumber);
    const back = await unpackSlabs({ slabNumbers: unfitNumbers, by: byOf(g), isAdmin: isAdminOf(g) });
    const { restored, failed } = restoredSlabs(unfitNumbers, back);
    const stranded = new Map(failed.map((f) => [f.slab, f.reason]));

    // Only the slabs that are actually back in stock leave the list.
    const goneIds = outcome.unfit.filter((u) => u.id && !stranded.has(u.slabNumber)).map((u) => u.id);
    if (goneIds.length) await db.commercialPackedSlab.deleteMany({ where: { id: { in: goneIds } } });
    // The rest stay, with what went wrong written where the floor and Commercial
    // both read it. They are still UNFIT and still PACKED: somebody has to look.
    for (const u of outcome.unfit) {
      const why = stranded.get(u.slabNumber);
      if (!u.id || !why) continue;
      await db.commercialPackedSlab.update({
        where: { id: u.id },
        data: { unfitReason: `${u.reason} — still packed in finished goods: ${why}` },
      });
    }

    const strandedText = strandedNote(failed);
    const text = [rejectionNote(outcome.unfit, note), strandedText].filter(Boolean).join(". ");
    await db.commercialPackingList.update({
      where: { id: plId },
      data: { status: "REJECTED", verifiedAt: now, verifiedById: stamp.id, verifiedByName: stamp.name, verificationNote: text },
    });
    // Only ever backwards: an order still at PACKING is already where it needs
    // to be, and dragging it there again would be a second, meaningless move.
    if (stageIndex(String(list.order.status)) > stageIndex("PACKING")) {
      await moveOrder(list.orderId, "PACKING", g.user, `Packing list ${list.number} rejected at the dispatch check`);
    }
    await logOrderEvent(list.orderId, "packing_rejected", {
      note: `Packing list ${list.number}: ${text}`,
      by: g.user,
      payload: { packingListId: plId, number: list.number, unfit: outcome.unfit, returnedToStock: back.updated, stranded: failed },
    });
    return json(plain({
      list: await view(plId),
      verified: false,
      removed: outcome.unfit.filter((u) => !stranded.has(u.slabNumber)).map((u) => ({ slab: u.slabNumber, reason: u.reason })),
      stranded: failed,
      returnedToStock: restored.length,
    }));
  });
}
