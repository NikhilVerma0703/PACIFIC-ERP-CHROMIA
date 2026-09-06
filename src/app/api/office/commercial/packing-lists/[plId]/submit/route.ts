// POST /api/office/commercial/packing-lists/[plId]/submit — hand the list to
// the dispatch team.
//
// Submitting is when the slabs stop being available to anybody else: every one
// of them goes PACKED in finished goods. A slab the inventory will not pack —
// cut since, dispatched under another order, gone — comes OFF the list and is
// named in the answer and in the order log, because a packing list that claims
// a slab which is not in the crate is worse than a short one. If nothing can
// be packed the list stays DRAFT and nothing moves.
//
// A slab that is ALREADY PACKED is only left alone when this list is what
// packed it (a re-submit after a rejection). One that another list packed comes
// off with the other list's number in the reason — see partitionForPack.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { readSlabs, packSlabs } from "@/lib/commercial/inventory-bridge";
import { canSubmit, partitionForPack, submitOutcome, removalNote } from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, byOf, isAdminOf, ownReferences } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    const ok = canSubmit(list.status, list.slabs);
    if (!ok.ok) fail(409, ok.reason);
    await readBody(req);   // body is optional; drain it

    const isAdmin = isAdminOf(g);
    const by = byOf(g);
    const numbers = list.slabs.map((s) => Number(s.slabNumber));
    const live = await readSlabs(numbers, isAdmin);
    const gone = numbers.filter((n) => !live.some((r) => r.slabNumber === n));

    // WHOSE PACKED SLAB IS IT. Two draft lists may both hold a slab while it is
    // AVAILABLE; the first to submit packs it. Treating a PACKED slab as "done"
    // at the second submit is how two packing lists come to claim one slab, so
    // a PACKED slab is left alone only when THIS list is what packed it: this
    // list has been submitted before, and no other list that has been submitted
    // holds the same number.
    const packedNow = live.filter((r) => String(r.status) === "PACKED").map((r) => r.slabNumber);
    const rivals: Array<{ slabNumber: number; packingList: { number: string } }> = packedNow.length
      ? await db.commercialPackedSlab.findMany({
          where: { slabNumber: { in: packedNow }, packingListId: { not: plId }, packingList: { submittedAt: { not: null } } },
          select: { slabNumber: true, packingList: { select: { number: true } } },
        })
      : [];
    const claimedBy = new Map<number, string>();
    for (const r of rivals) claimedBy.set(Number(r.slabNumber), r.packingList?.number ?? "another packing list");
    const ownPacked = list.submittedAt ? packedNow.filter((n) => !claimedBy.has(n)) : [];

    const { toPack, refused } = partitionForPack(live.map((r) => ({ slabNumber: r.slabNumber, status: r.status })), ownPacked);
    const notOurs = refused.map((r) => ({
      slab: r.slab,
      reason: claimedBy.has(r.slab) ? `already PACKED on ${claimedBy.get(r.slab)}` : r.reason,
    }));
    const res = toPack.length
      ? await packSlabs({ slabNumbers: toPack, references: ownReferences(list.order as { number: string; holds?: Array<{ reference?: string | null }>; enquiry?: { number?: string | null } | null }), by, isAdmin })
      : { updated: 0, missing: [] as number[], skipped: [] as Array<{ slab: number; reason: string }>, before: [] };

    const outcome = submitOutcome(
      list.slabs.map((s) => ({ id: s.id, slabNumber: Number(s.slabNumber) })),
      { skipped: [...notOurs, ...res.skipped], missing: [...gone, ...res.missing] },
    );
    const removed = outcome.removed.map((r) => ({ slab: r.slab, reason: r.reason }));
    if (!outcome.kept.length) {
      return json({ error: `No slab on ${list.number} could be packed`, removed }, 409);
    }

    const now = new Date();
    const stamp = actorStamp(g.user);
    if (outcome.removed.length) {
      await db.commercialPackedSlab.deleteMany({ where: { id: { in: outcome.removed.map((r) => r.id) } } });
    }
    await db.commercialPackingList.update({
      where: { id: plId },
      data: { status: "SUBMITTED", submittedAt: now, submittedById: stamp.id },
    });
    await bumpOrder(list.orderId, "PACKING", g.user, `Packing list ${list.number} submitted for the dispatch check`);

    const note = `Packing list ${list.number} submitted — ${outcome.kept.length} slab(s) packed${removed.length ? `. ${removalNote(removed)}` : ""}`;
    await logOrderEvent(list.orderId, "packing_submitted", {
      note, by: g.user,
      payload: { packingListId: plId, number: list.number, slabs: outcome.kept.length, removed },
    });
    return json(plain({ list: await loadList(plId), removed }));
  });
}
