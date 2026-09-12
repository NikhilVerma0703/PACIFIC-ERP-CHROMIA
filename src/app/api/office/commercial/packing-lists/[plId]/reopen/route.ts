// POST /api/office/commercial/packing-lists/[plId]/reopen — pull a list back
// to Commercial from SUBMITTED (sent too early) or REJECTED (the check failed).
//
// Every slab still PACKED goes back to AVAILABLE: while the list is being
// rebuilt those slabs are not in a crate, and leaving them PACKED hides them
// from the next stock check. The verdicts are cleared with it, on the cut-to-
// size lines as well as on the slabs — a list that is about to change is not a
// list the dispatch team has checked.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { unpackSlabs } from "@/lib/commercial/inventory-bridge";
import { canReopen, restoredSlabs, strandedNote, PACKING_STATUS_LABEL, type PackingStatus } from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, byOf, isAdminOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    if (!canReopen(list.status)) {
      fail(409, `${list.number} is ${PACKING_STATUS_LABEL[list.status as PackingStatus]?.toLowerCase() ?? list.status} — only a submitted or rejected list can be reopened`);
    }
    const body = await readBody<{ reason?: unknown }>(req);
    const reason = str(body.reason);

    const numbers = list.slabs.map((s) => Number(s.slabNumber));
    const back = numbers.length
      ? await unpackSlabs({ slabNumbers: numbers, by: byOf(g), isAdmin: isAdminOf(g) })
      : { updated: 0, missing: [] as number[], skipped: [] as Array<{ slab: number; reason: string }>, before: [] };
    // What did NOT come back is named. The rows stay on the list either way —
    // nothing is deleted here — but a slab still PACKED while the list is being
    // rebuilt is invisible to the next stock check, and whoever reopened the
    // list is the only person in a position to chase it.
    const { failed } = restoredSlabs(numbers, back);

    // Both kinds of line lose their verdict, and one statement each says so.
    // A piece row is never deleted here, so a verdict left on it outlives the
    // whole rebuild: an UNFIT one rejects the next check over a fault that was
    // recut before resubmitting, and nothing but a per-line mark can clear it
    // because the bulk marks touch PENDING lines only. A FIT one is worse — the
    // size can be edited on the DRAFT list and the line still reads checked, so
    // the next verify passes on stone nobody looked at.
    const cleared = { fit: "PENDING" as const, unfitReason: null, checkedById: null, checkedAt: null };
    await db.commercialPackedSlab.updateMany({ where: { packingListId: plId }, data: cleared });
    await db.commercialPackedPiece.updateMany({ where: { packingListId: plId }, data: cleared });
    await db.commercialPackingList.update({
      where: { id: plId },
      data: { status: "DRAFT", submittedAt: null, submittedById: null, verifiedAt: null, verifiedById: null, verifiedByName: null },
    });

    const stranded = strandedNote(failed);
    const note = `Packing list ${list.number} reopened${reason ? ` — ${reason}` : ""}. ${back.updated} slab(s) returned to stock; all checks cleared.${stranded ? ` ${stranded}` : ""}`;
    await logOrderEvent(list.orderId, "note", {
      note, by: g.user,
      payload: { packingListId: plId, number: list.number, from: list.status, returnedToStock: back.updated, stranded: failed, reason },
    });
    return json(plain({ list: await loadList(plId), returnedToStock: back.updated, stranded: failed }));
  });
}
