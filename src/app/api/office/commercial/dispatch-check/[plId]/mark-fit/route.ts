// POST /api/office/commercial/dispatch-check/[plId]/mark-fit
// { scope: "crate", crate: "<key>" } · { scope: "all" }
//
// The two faster ways to say "correct" (round four, answer 1): every still-
// PENDING line in one crate, or every still-PENDING line on the list. Both
// kinds of line, because the crate in front of the checker holds both.
//
// THEY NEVER OVERWRITE AN UNFIT, and that rule is enforced twice on purpose.
// bulkFitPlan picks only the PENDING rows, and the two updateMany calls repeat
// `fit: "PENDING"` in their WHERE — so a line the checker marks unfit on his
// phone in the second between the read and the write is still not erased by the
// "mark all correct" already in flight. An unfit line is a deliberate finding
// with a reason attached; losing one silently is the one failure this whole
// screen exists to prevent.
//
// AND THE ANSWER SAYS WHAT IT SKIPPED. "38 marked correct, 2 left unfit" — a
// bulk action that reported only its successes would let the checker walk away
// believing the crate was clear.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  bulkFitPlan, bulkFitNote, parseBulkFitScope, canVerify, canRecheck, checkerMaySee, fitCounts,
} from "@/lib/commercial/packing-rules";
import { db, paramPl } from "../../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("verify", "dispatchCheck");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await db.commercialPackingList.findUnique({ where: { id: plId }, select: { id: true, number: true, status: true, orderId: true } });
    // The same two gates every verdict on this segment passes: a list outside
    // the dispatch check's statuses is a 404, not a status message.
    if (!list || !checkerMaySee(String(list.status))) fail(404, "Packing list not found");
    const late = canRecheck(String(list.status));
    if (!canVerify(list.status) && !late) {
      fail(409, `${list.number} is already rejected — reopen it before checking again`);
    }

    const body = await readBody<{ scope?: unknown; crate?: unknown }>(req);
    const asked = parseBulkFitScope(body);
    if (!asked.ok) fail(400, asked.reason);

    const [slabs, pieces]: [Array<{ id: string; crateId: string | null; fit: string }>, Array<{ id: string; crateId: string | null; crateNo: string | null; fit: string }>] = await Promise.all([
      db.commercialPackedSlab.findMany({ where: { packingListId: plId }, select: { id: true, crateId: true, fit: true } }),
      db.commercialPackedPiece.findMany({ where: { packingListId: plId }, select: { id: true, crateId: true, crateNo: true, fit: true } }),
    ]);
    const plan = bulkFitPlan(slabs, pieces, asked.scope);

    const stamp = actorStamp(g.user);
    const stampData = { fit: "FIT" as const, unfitReason: null, checkedById: stamp.id, checkedAt: new Date() };
    const [slabRes, pieceRes] = await Promise.all([
      plan.slabIds.length
        ? db.commercialPackedSlab.updateMany({ where: { id: { in: plan.slabIds }, packingListId: plId, fit: "PENDING" }, data: stampData })
        : Promise.resolve({ count: 0 }),
      plan.pieceIds.length
        ? db.commercialPackedPiece.updateMany({ where: { id: { in: plan.pieceIds }, packingListId: plId, fit: "PENDING" }, data: stampData })
        : Promise.resolve({ count: 0 }),
    ]);

    // WHAT IS REPORTED IS WHAT ACTUALLY CHANGED. A row the WHERE refused was a
    // row somebody marked unfit while this request was in the air, so it counts
    // as skipped rather than as marked — the alternative is an answer that
    // claims a line was passed when the database says otherwise.
    const marked = Number(slabRes.count) + Number(pieceRes.count);
    const outcome = { ...plan, marked, skippedUnfit: plan.skippedUnfit + (plan.marked - marked) };
    const note = bulkFitNote(outcome);

    if (late && marked > 0) {
      // A bulk mark on a list the check has already concluded is one act, so it
      // is one line in the order log — the slab-by-slab route logs each verdict
      // because each one is its own act.
      await logOrderEvent(list.orderId, "note", {
        note: `Packing list ${list.number} (${String(list.status).toLowerCase()}): ${asked.scope.kind === "all" ? "the whole list" : "one crate"} marked correct at loading — ${note}`,
        by: g.user,
        payload: { packingListId: plId, scope: asked.scope, marked, skippedUnfit: outcome.skippedUnfit, late: true },
      });
    }

    const [afterSlabs, afterPieces]: [Array<{ fit: string }>, Array<{ fit: string }>] = await Promise.all([
      db.commercialPackedSlab.findMany({ where: { packingListId: plId }, select: { fit: true } }),
      db.commercialPackedPiece.findMany({ where: { packingListId: plId }, select: { fit: true } }),
    ]);
    return json(plain({
      marked,
      skippedUnfit: outcome.skippedUnfit,
      alreadyFit: outcome.alreadyFit,
      note,
      fit: fitCounts(afterSlabs, afterPieces),
    }));
  });
}
