// POST /api/office/commercial/holds/[id]/extend — { days }
//
// Commercial may extend a hold (owner default, open question 11). Inventory has
// no "change the expiry" transition — changeSlabStatus reserves only FROM
// AVAILABLE — so an extension is two steps through the bridge: release the
// slabs still on this hold under this hold's own reference, then reserve them
// again under the same reference and customer for the new number of days.
//
// THE WINDOW IS REAL AND IS REPORTED. Between the two steps a slab is
// AVAILABLE, so another hold could take it. Anything that does not come back is
// returned in `skipped` and reconciled off the hold, rather than left on the
// hold as if it were still reserved. The answer says how many were re-held, so
// the screen can say "38 of 40 extended — 2 were taken meanwhile".
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { holdSlabs, releaseHeld, reconcileHold } from "@/lib/commercial/inventory-bridge";
import {
  normaliseDays, holdExpiry, stillHeldSlabs, canActOnHold, heldSlabNumbers, type HoldSlabStateLike,
} from "@/lib/commercial/holds-rules";
import { db, HOLD_INCLUDE, loadHold, reconcileAndLoad } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadHold(id);
    const hold = await reconcileAndLoad(id);
    const guard = canActOnHold(String(hold.status));
    if (!guard.ok) fail(409, guard.reason);

    const body = await readBody<{ days?: unknown }>(req);
    const settings = await loadSettings();
    const days = normaliseDays(body.days, settings.holdDays);

    const targets = stillHeldSlabs(hold.slabs as HoldSlabStateLike[]).map((s) => s.slabNumber);
    if (!targets.length) fail(409, "No slab on this hold is still reserved — place a new hold instead.");

    const stamp = actorStamp(g.user);
    const reference = String(hold.reference);
    const customer = (hold.customer as string | null) ?? null;
    const isAdmin = g.actor === "ADMIN";

    const freed = await releaseHeld({ slabNumbers: targets, reference, by: stamp.name, isAdmin });
    const again = await holdSlabs({ slabNumbers: targets, reference, customer, days, by: stamp.name, isAdmin });
    const reheld = heldSlabNumbers(targets, again);

    const now = new Date();
    await db.commercialStockHold.update({
      where: { id },
      data: {
        expiresAt: holdExpiry(now, days),
        ...(again.updated > 0 ? { status: "ACTIVE", releasedAt: null } : {}),
      },
    });
    await reconcileHold(id);
    const after = await db.commercialStockHold.findUnique({ where: { id }, include: HOLD_INCLUDE });

    if (hold.orderId) {
      await logOrderEvent(String(hold.orderId), "hold_placed", {
        note: `Hold ${reference} extended by ${days} day(s) — ${again.updated} of ${targets.length} slab(s) re-held`
          + (again.skipped.length ? `; ${again.skipped.length} could not be re-held` : ""),
        by: g.user,
        payload: { holdId: id, reference, days, extended: true, released: freed.updated, reheld: again.updated, slabs: reheld, skipped: again.skipped },
      });
    }

    return json(plain({
      hold: after,
      days,
      asked: targets.length,
      reheld: again.updated,
      skipped: again.skipped,
      missing: again.missing,
    }));
  });
}
