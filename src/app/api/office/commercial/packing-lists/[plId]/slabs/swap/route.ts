// GET  /api/office/commercial/packing-lists/[plId]/slabs/swap?slabId=
//        the slabs that could stand in for a refused one
// POST /api/office/commercial/packing-lists/[plId]/slabs/swap
//        { slabId, replacementSlabNumber } — do it
//
// Answer 30: "Dispatch refuses. Recovery is by hand: the refused slab is
// swappable." A FINAL list cannot have slabs added or removed — the container
// was stuffed from it — so a slab the dispatch check found cracked at loading
// is replaced IN ITS ROW: same crate, same sort position, a new number and the
// new slab's own batch and sizes, the verdict back to PENDING for the checker.
// The list keeps its status; the order does not move; the swap is logged with
// both numbers (slab_swapped). Nothing ships until the replacement has been
// checked fit (dispatchBlockers).
//
// TWO SYSTEMS, ONE SWAP. Finished goods moves first (swapPackedSlab, which
// only holds if THIS call took the refused slab out of PACKED), and everything
// the list has to say about it — the row, the hold's stamps, the verification
// note, the event — is one db.$transaction. If that transaction fails the
// inventory has moved and the document has not, so the bridge puts both slabs
// back (undoSwapPackedSlab) and a "note" event names both numbers and where
// each one ended up: a swap that half happened is never silent.
//
// Like for like, by rule: the replacement is the refused slab's design and
// thickness (replacementEligibility), AVAILABLE or held under one of this
// order's own references, and whole. The GET answers with that same rule
// applied to the stock check's answer plus the order's own held slabs, so the
// picker offers nothing the POST would refuse.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { searchAvailable, readSlabs, swapPackedSlab, undoSwapPackedSlab, type SlabRow } from "@/lib/commercial/inventory-bridge";
import {
  swapEligibility, replacementEligibility, buildPackedSlab, holdDaysLeft, swapNote, fmtSlabNo,
  swapRefusalNote, swapFailureNote,
  type OrderItemLike,
} from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, byOf, isAdminOf, ownReferences } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

/** The picker offers this many at most; a design with 900 available slabs is
 *  narrowed by batch on the stock tab, not scrolled through here. */
const PICKER_LIMIT = 150;

interface HoldRow { id: string; reference: string; customer: string | null; status: string; expiresAt: Date | string; slabs: Array<{ slabNumber: number; releasedAt: Date | string | null; packedAt: Date | string | null }> }

/** The order's holds as the loader includes them (PL_INCLUDE carries their slabs). */
const holdsOf = (list: Awaited<ReturnType<typeof loadList>>): HoldRow[] => (list.order.holds ?? []) as unknown as HoldRow[];

/** The refused slab's row on this list, or the reason there is nothing to swap. */
function refusedOn(list: Awaited<ReturnType<typeof loadList>>, slabId: string) {
  const slab = list.slabs.find((s) => s.id === slabId);
  if (!slab) fail(404, "Slab not found on this list");
  const may = swapEligibility(list.status, { slabNumber: Number(slab.slabNumber), fit: String(slab.fit) });
  if (!may.ok) fail(409, may.reason);
  return {
    id: slab.id,
    slabNumber: Number(slab.slabNumber),
    design: (slab.design as string | null) ?? null,
    thickness: (slab.thickness as string | null) ?? null,
    crateId: (slab.crateId as string | null) ?? null,
    sortOrder: Number(slab.sortOrder) || 0,
    customerSlabNo: (slab.customerSlabNo as string | null) ?? null,
    unfitReason: (slab.unfitReason as string | null) ?? null,
  };
}

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    const slabId = str(new URL(req.url).searchParams.get("slabId"));
    if (!slabId) fail(400, "Say which slab is being swapped");
    const refused = refusedOn(list, slabId);
    const isAdmin = isAdminOf(g);
    const refs = ownReferences(list.order as { number: string; holds?: Array<{ reference?: string | null }>; enquiry?: { number?: string | null } | null });
    const onList = new Set(list.slabs.map((s) => Number(s.slabNumber)));

    // Two sources, one rule. The stock check answers AVAILABLE; the order's own
    // live holds answer RESERVED-under-us, which the stock check leaves out.
    const rows: SlabRow[] = [];
    if (refused.design) {
      const found = await searchAvailable({ design: refused.design, thickness: refused.thickness, isAdmin });
      for (const grp of found.groups) rows.push(...grp.slabs);
    }
    const heldNos = holdsOf(list)
      .filter((h) => h.status === "ACTIVE")
      .flatMap((h) => h.slabs.filter((s) => !s.releasedAt && !s.packedAt).map((s) => Number(s.slabNumber)))
      .filter((n) => !rows.some((r) => r.slabNumber === n));
    if (heldNos.length) rows.push(...await readSlabs(Array.from(new Set(heldNos)), isAdmin));

    const candidates = rows
      .filter((r) => !onList.has(r.slabNumber) && replacementEligibility(refused, r, refs).ok)
      .sort((a, b) => (a.status === "RESERVED" ? -1 : 0) - (b.status === "RESERVED" ? -1 : 0) || a.batchDisplay.localeCompare(b.batchDisplay) || a.slabNumber - b.slabNumber)
      .slice(0, PICKER_LIMIT)
      .map((r) => ({
        slabNumber: r.slabNumber, batch: r.batchDisplay, grade: r.grade, status: r.status,
        heldUnder: r.status === "RESERVED" ? r.reservedForPi : null,
        lengthIn: r.lengthIn, widthIn: r.widthIn, bay: r.bay, frame: r.frame,
      }));
    return json(plain({ refused, candidates, truncated: rows.length > PICKER_LIMIT }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    const body = await readBody<{ slabId?: unknown; replacementSlabNumber?: unknown }>(req);
    const slabId = str(body.slabId);
    if (!slabId) fail(400, "Say which slab is being swapped");
    const replacement = num(body.replacementSlabNumber);
    if (replacement === null || replacement <= 0) fail(400, "Name the replacement slab");
    const refused = refusedOn(list, slabId);
    if (list.slabs.some((s) => Number(s.slabNumber) === replacement)) fail(409, `Slab #${fmtSlabNo(replacement)} is already on ${list.number}`);

    const isAdmin = isAdminOf(g);
    const refs = ownReferences(list.order as { number: string; holds?: Array<{ reference?: string | null }>; enquiry?: { number?: string | null } | null });
    const [live] = await readSlabs([replacement], isAdmin);
    if (!live) fail(404, `Slab #${fmtSlabNo(replacement)} is not in finished goods (or not visible to this login)`);
    const fit = replacementEligibility(refused, live, refs);
    if (!fit.ok) fail(409, `Slab #${fmtSlabNo(replacement)} cannot replace #${fmtSlabNo(refused.slabNumber)}: ${fit.reason}`);

    // The hold the refused slab came off, if it still has days to run: the
    // slab goes back onto it rather than into open stock, so a swap does not
    // quietly end a five-day hold the customer is still inside.
    const now = new Date();
    const hold = holdsOf(list).find((h) => h.status === "ACTIVE" && h.slabs.some((s) => Number(s.slabNumber) === refused.slabNumber));
    const days = hold ? holdDaysLeft(hold.expiresAt, now) : null;
    const client = list.order.client as { name?: string } | null;
    const rehold = hold && days ? { reference: hold.reference, customer: hold.customer ?? client?.name ?? null, days } : null;

    // And the hold the REPLACEMENT is coming off, for the same reason in
    // reverse: if the list write fails and the swap is put back, a hold the
    // replacement was sitting on must not be ended by a swap that never was.
    const fromHold = live.status === "RESERVED"
      ? holdsOf(list).find((h) => h.status === "ACTIVE" && h.slabs.some((s) => Number(s.slabNumber) === replacement))
      : undefined;
    const fromDays = fromHold ? holdDaysLeft(fromHold.expiresAt, now) : null;
    const replacementRehold = fromHold && fromDays
      ? { reference: fromHold.reference, customer: fromHold.customer ?? client?.name ?? null, days: fromDays }
      : null;

    const res = await swapPackedSlab({
      refusedSlabNumber: refused.slabNumber, replacementSlabNumber: replacement,
      references: refs, rehold, by: byOf(g), isAdmin,
    });
    if (!res.packed || !res.released) {
      // swapRefusalNote, not a bare join: the bridge's precondition reasons
      // already name their own slab ("#150903 is no longer packed — it was
      // already swapped or released"), and prefixing the number again read as
      // "#150903 (#150903 is no longer packed…)".
      const why = swapRefusalNote(res.skipped);
      await logOrderEvent(list.orderId, "note", {
        note: `Packing list ${list.number}: swap of #${fmtSlabNo(refused.slabNumber)} for #${fmtSlabNo(replacement)} did NOT happen — ${why}`,
        by: g.user,
        payload: { packingListId: plId, refused: refused.slabNumber, replacement, skipped: res.skipped },
      });
      fail(409, `Nothing was swapped — ${why}`);
    }

    // FINISHED GOODS HAS MOVED; THE LIST MUST FOLLOW IT ALL AT ONCE. The row
    // is replaced in place (same crate, same position, the new slab's own
    // batch, grade and nominal sizes, verdict back to PENDING — the dispatch
    // team has not seen this slab), the hold's own record follows the
    // inventory, the verification note is appended and the slab_swapped event
    // is written — as FOUR writes. Done one after another they can stop half
    // way: the row named the replacement while the hold still showed the
    // refused slab packed, or the swap happened with nothing in the log at
    // all. One transaction, and the event row is written on `tx` rather than
    // through logOrderEvent, whose whole point is to swallow its own failures
    // against the global client — a best-effort log cannot be part of an
    // all-or-nothing write.
    const built = buildPackedSlab(live, list.order.items as OrderItemLike[], refused.sortOrder);
    const note = swapNote(list.number, refused.slabNumber, replacement, refused.unfitReason, res.reheld && rehold ? rehold.reference : null);
    const stranded = res.skipped.length ? ` ${res.skipped.map((s) => `#${fmtSlabNo(s.slab)}: ${s.reason}`).join("; ")}` : "";
    const holdIds = holdsOf(list).map((h) => h.id);

    let updated: unknown;
    try {
      updated = await db.$transaction(async (tx: typeof db) => {
        const row = await tx.commercialPackedSlab.update({
          where: { id: refused.id },
          data: {
            slabNumber: built.slabNumber, design: built.design, customerSku: built.customerSku, thickness: built.thickness,
            batchKey: built.batchKey, batchNumber: built.batchNumber, grade: built.grade,
            lengthCm: built.lengthCm, widthCm: built.widthCm, sqm: built.sqm, sqft: built.sqft,
            fit: "PENDING", unfitReason: null, checkedById: null, checkedAt: null,
            customerSlabNo: null, customerBatchNo: null,
          },
        });
        // The refused slab is held again (or released) on its hold's record,
        // and the replacement, if it was held, is now packed against it.
        if (hold) {
          await tx.commercialStockHoldSlab.updateMany({
            where: { holdId: hold.id, slabNumber: refused.slabNumber },
            data: res.reheld ? { packedAt: null, releasedAt: null } : { packedAt: null, releasedAt: now },
          });
        }
        if (live.status === "RESERVED" && holdIds.length) {
          await tx.commercialStockHoldSlab.updateMany({ where: { holdId: { in: holdIds }, slabNumber: replacement, packedAt: null }, data: { packedAt: now } });
        }
        await tx.commercialPackingList.update({
          where: { id: plId },
          data: { verificationNote: `${(list.verificationNote as string | null) ?? ""}${list.verificationNote ? ". " : ""}${note}` },
        });
        await tx.commercialOrderEvent.create({
          data: {
            orderId: list.orderId, kind: "slab_swapped", note: `${note}.${stranded}`,
            payload: { packingListId: plId, number: list.number, refused: refused.slabNumber, replacement, reason: refused.unfitReason, reheld: res.reheld, holdReference: rehold?.reference ?? null, skipped: res.skipped },
            byId: g.user?.id || null, byName: g.user?.name || g.user?.email || null,
          },
        });
        return row;
      });
    } catch (e) {
      // The inventory moved and the list did not. Walk the slabs back through
      // the bridge — the replacement out of PACKED (and onto the hold it came
      // off), the refused slab back into PACKED, which is what the untouched
      // row still says — and log a "note" naming BOTH numbers and where each
      // one actually ended up. Compensation can itself fail; the note says so
      // rather than leaving a divergence nobody can see.
      const undo = await undoSwapPackedSlab({
        refusedSlabNumber: refused.slabNumber, replacementSlabNumber: replacement,
        references: refs, replacementRehold, by: byOf(g), isAdmin,
      });
      const failed = swapFailureNote(list.number, refused.slabNumber, replacement, (e as Error).message, undo);
      await logOrderEvent(list.orderId, "note", {
        note: failed,
        by: g.user,
        payload: { packingListId: plId, number: list.number, refused: refused.slabNumber, replacement, error: (e as Error).message, undo },
      });
      fail(409, failed);
    }
    return json(plain({ list: await loadList(plId), slab: updated, refused: refused.slabNumber, replacement, reheld: res.reheld, skipped: res.skipped }));
  });
}
