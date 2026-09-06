// POST /api/office/commercial/holds/[id]/release — { slabNumbers?, reason }
//
// Give slabs back to stock. Without slabNumbers every slab still on the hold is
// released; with them, only those of them that are still held (a number that is
// not on this hold is reported back, never touched).
//
// releaseHeld() releases ONLY slabs whose reservedForPi equals this hold's own
// reference — the whole reason the module talks to inventory through the bridge
// rather than /api/inventory/status: somebody else's PI hold can never be
// cleared from here, whatever the body says.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { releaseHeld, reconcileHold } from "@/lib/commercial/inventory-bridge";
import { parseSlabNumbers, releaseTargets, canActOnHold, type HoldSlabStateLike } from "@/lib/commercial/holds-rules";
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

    const body = await readBody<{ slabNumbers?: unknown; reason?: unknown }>(req);
    const asked = Object.prototype.hasOwnProperty.call(body, "slabNumbers") && body.slabNumbers != null
      ? parseSlabNumbers(body.slabNumbers)
      : null;
    const reason = str(body.reason);
    const slabs = hold.slabs as HoldSlabStateLike[];
    const { targets, notOnHold } = releaseTargets(slabs, asked);
    if (!targets.length) fail(409, notOnHold.length ? `Not on this hold: ${notOnHold.join(", ")}` : "Nothing left to release on this hold.");

    const stamp = actorStamp(g.user);
    const res = await releaseHeld({
      slabNumbers: targets,
      reference: String(hold.reference),
      by: stamp.name,
      isAdmin: g.actor === "ADMIN",
    });
    await reconcileHold(id);
    await db.commercialStockHold.update({
      where: { id },
      data: { releasedById: stamp.id, releaseReason: reason },
    });
    const after = await db.commercialStockHold.findUnique({ where: { id }, include: HOLD_INCLUDE });

    if (hold.orderId) {
      await logOrderEvent(String(hold.orderId), "hold_released", {
        note: `${res.updated} slab(s) released from ${hold.reference}${reason ? ` — ${reason}` : ""}`,
        by: g.user,
        payload: { holdId: id, reference: hold.reference, released: res.updated, asked: targets, skipped: res.skipped, notOnHold, reason },
      });
    }

    return json(plain({ hold: after, released: res.updated, skipped: res.skipped, missing: res.missing, notOnHold }));
  });
}
