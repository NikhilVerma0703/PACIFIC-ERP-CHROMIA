// POST /api/office/commercial/dispatch-check/[plId]/verify — the dispatch
// team's conclusion. { note? }
//
// Refused while any line is still PENDING: a list is verified because every
// line was looked at, not because the checker reached the bottom of the screen.
// BOTH KINDS OF LINE since round four, answer 1 — a cut-to-size list is checked
// piece by piece, so a piece nobody ticked stops the conclusion exactly as an
// unticked slab does.
//
//   all FIT  → VERIFIED, and the order moves DISPATCH_CHECK → READY.
//   any UNFIT → REJECTED. The unfit slabs go back to AVAILABLE and come OFF
//               the list (the FIT ones stay PACKED — they are in the crate and
//               nobody is unpacking a good slab), the note names each one and
//               why, and the order is pulled back to PACKING so Commercial
//               sees it as work to do rather than as ready to ship.
//
// AN UNFIT PIECE IS A THIRD CASE, and the one the bridge must never be told
// about. An unfit slab is returned through the inventory bridge because a slab
// IS a row in finished goods; a cut piece was cut to a customer's size and
// there is no row and no shelf to put it back on. So the bridge is called with
// the unfit SLAB numbers only — and not called at all when there are none —
// and the unfit pieces stay on the list, still flagged with the reason the
// checker gave, named in the rejection note as staying. Handing unpackSlabs a
// piece would be a release attempted against a slab number that does not exist.
//
// A ROW IS ONLY DELETED FOR A SLAB THAT CAME BACK. The packed-slab row is the
// only thing in the module that points at the slab; deleting it for a slab the
// bridge did not actually restore leaves that slab PACKED and unfindable —
// which is exactly what happened when the restore could not read it. So the
// bridge's answer is read (restoredSlabs), the rows for the slabs it put back
// are deleted, and the rest STAY on the list with the failure written on them.
//
// WHAT COMES BACK IS THE FLOOR SCREEN'S SHAPE, NOT THE LOADER'S. This endpoint
// is reached by a verify-only login that commercialGate("view", "dispatchCheck") refuses; it
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
  const g = await commercialGate("verify", "dispatchCheck");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    // Outside the three statuses this segment covers the list does not exist,
    // for the same reason the GET says so: a status message would confirm a
    // DRAFT list to a login that may not know it is there.
    if (!checkerMaySee(list.status)) fail(404, "Packing list not found");
    // A VERIFIED or FINAL list takes a late verdict slab by slab (answer 30,
    // the PATCH beside this one) but is never concluded twice: the conclusion
    // of a list at the loading bay is the dispatch route's refusal, not a
    // second rejection that would unpack the container.
    if (!canVerify(list.status)) {
      const state = list.status === "VERIFIED" ? "already verified" : list.status === "FINAL" ? "already final" : "already rejected";
      fail(409, `${list.number} is ${state} — it is not waiting for a check`);
    }
    const body = await readBody<{ note?: unknown }>(req);
    const note = str(body.note);

    const pieceLines = list.pieces ?? [];
    const outcome = verifyOutcome(
      list.slabs.map((s) => ({ id: s.id, slabNumber: Number(s.slabNumber), fit: String(s.fit), unfitReason: (s.unfitReason as string | null) ?? null })),
      pieceLines.map((p) => ({
        id: p.id, crateNo: p.crateNo, pieceNo: (p.pieceNo as string | null) ?? null, design: p.design,
        fit: String(p.fit), unfitReason: (p.unfitReason as string | null) ?? null,
      })),
    );
    if (outcome.pending > 0) {
      // Which KIND is outstanding, because the two are checked on different
      // parts of the screen and "3 line(s) not checked" would send the man
      // looking down a list of slabs he has already done.
      const left = [
        outcome.slabs.pending ? `${outcome.slabs.pending} slab(s)` : "",
        outcome.pieces.pending ? `${outcome.pieces.pending} cut-to-size line(s)` : "",
      ].filter(Boolean).join(" and ");
      return json({ error: `${left} have not been checked yet`, pending: outcome.pending }, 409);
    }

    const now = new Date();
    const stamp = actorStamp(g.user);

    if (outcome.ok) {
      const text = verificationNote(list.slabs.length, note, pieceLines.length);
      await db.commercialPackingList.update({
        where: { id: plId },
        data: { status: "VERIFIED", verifiedAt: now, verifiedById: stamp.id, verifiedByName: stamp.name, verificationNote: text },
      });
      await bumpOrder(list.orderId, "DISPATCH_CHECK", g.user, `Packing list ${list.number} checked`);
      await bumpOrder(list.orderId, "READY", g.user, `Packing list ${list.number} verified`);
      await logOrderEvent(list.orderId, "packing_verified", {
        note: `Packing list ${list.number} verified — ${text}`,
        by: g.user,
        payload: { packingListId: plId, number: list.number, slabs: list.slabs.length, pieces: pieceLines.length },
      });
      return json(plain({ list: await view(plId), verified: true, removed: [] }));
    }

    // Rejected.
    //
    // ONLY THE SLABS GO NEAR THE BRIDGE — see the head note. outcome.unfit is
    // the slabs and outcome.unfitPieces is the pieces, two fields rather than
    // one, so there is no shape of this code in which a piece reaches
    // unpackSlabs. A list rejected on its pieces alone has no slab to return,
    // and the bridge is not called at all rather than being asked to release
    // nothing.
    const unfitNumbers = outcome.unfit.map((u) => u.slabNumber);
    const back = unfitNumbers.length
      ? await unpackSlabs({ slabNumbers: unfitNumbers, by: byOf(g), isAdmin: isAdminOf(g) })
      : { updated: 0, missing: [], skipped: [] };
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

    // THE UNFIT PIECES ARE NOT TOUCHED HERE. They keep their row, their UNFIT
    // and the reason the checker typed, which is the whole record of what is
    // wrong with them; there is no inventory call to make and no row to delete,
    // so the only thing left to do about them is to say so, and rejectionNote
    // names each one as staying on the list.
    const strandedText = strandedNote(failed);
    const text = [rejectionNote(outcome.unfit, note, outcome.unfitPieces), strandedText].filter(Boolean).join(". ");
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
      payload: { packingListId: plId, number: list.number, unfit: outcome.unfit, unfitPieces: outcome.unfitPieces, returnedToStock: back.updated, stranded: failed },
    });
    return json(plain({
      list: await view(plId),
      verified: false,
      removed: outcome.unfit.filter((u) => !stranded.has(u.slabNumber)).map((u) => ({ slab: u.slabNumber, reason: u.reason })),
      // Named apart from `removed` because they were not: nothing left the list.
      unfitPieces: outcome.unfitPieces,
      stranded: failed,
      returnedToStock: restored.length,
    }));
  });
}
