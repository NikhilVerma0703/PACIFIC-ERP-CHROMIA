// GET  /api/office/commercial/orders/[id]/holds — this order's holds
// POST /api/office/commercial/orders/[id]/holds — put slabs on hold for it
//
// The 5-day stock hold (settings.holdDays; the body may ask for another length
// within the cap). The slabs become RESERVED in finished goods under this
// order's number, which is what the Finished Goods screen, the inventory sweep
// and the packing list all read; commercial_stock_hold is the module's own
// record of who held what, against what, until when.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import { parseSlabNumbers, normaliseDays, resolveHoldReference, pageArgs } from "@/lib/commercial/holds-rules";
import { db, HOLD_INCLUDE, placeHold } from "../../../holds/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function loadOrder(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialOrder.findUnique({
    where: { id },
    select: {
      id: true, number: true, status: true,
      client: { select: { id: true, name: true } },
      // The enquiry's number is the OTHER reference this order's stock may
      // legitimately sit under: a hold placed before the conversion carries
      // it (open question 12), and an extension or a release of that hold has
      // to be able to name it. Nothing else is allowed — see below.
      enquiry: { select: { id: true, number: true } },
    },
  });
  if (!row) fail(404, "Order not found");
  return row;
}

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadOrder(id);
    const u = new URL(req.url);
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const where = { orderId: id };
    const ids: Array<{ id: string; status: string }> = await db.commercialStockHold.findMany({
      where, orderBy: { placedAt: "desc" }, skip, take: limit, select: { id: true, status: true },
    });
    for (const h of ids) if (h.status === "ACTIVE") await reconcileHold(h.id);
    const [items, total] = await Promise.all([
      db.commercialStockHold.findMany({ where, orderBy: { placedAt: "desc" }, skip, take: limit, include: HOLD_INCLUDE }),
      db.commercialStockHold.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrder(id);
    const body = await readBody<Record<string, unknown>>(req);
    const slabNumbers = parseSlabNumbers(body.slabNumbers);
    if (!slabNumbers.length) fail(400, "Tick at least one slab to hold");

    const settings = await loadSettings();
    const days = normaliseDays(body.days, settings.holdDays);
    // THE REFERENCE IS NOT A LABEL, IT IS THE MODULE'S NOTION OF OWNERSHIP.
    // releaseHeld frees exactly the slabs stamped with a hold's reference and
    // packSlabs packs only slabs held under a reference the caller owns, so a
    // body that said `reference: "PSPL/PI/25-26/0042"` — another team's PI —
    // handed this order that team's reserved slabs to release and to pack. It
    // is now checked against what this order actually is.
    const enquiry = order.enquiry as { number?: string | null } | null;
    const ref = resolveHoldReference(body.reference, [String(order.number), enquiry?.number ?? null]);
    if (!ref.ok) fail(400, ref.reason);
    const reference = ref.reference;
    const client = order.client as { name?: string } | null;
    const customer = str(body.customer) ?? (client?.name ?? null);
    const stamp = actorStamp(g.user);

    const res = await placeHold({
      slabNumbers, reference, customer, days,
      notes: str(body.notes),
      orderId: id, enquiryId: null,
      by: stamp.name, byId: stamp.id, isAdmin: g.actor === "ADMIN",
    });

    await bumpOrder(id, "STOCK_CHECKED", g.user, `Stock held under ${reference}`);
    await logOrderEvent(id, "hold_placed", {
      note: `${res.updated} slab(s) held under ${reference} for ${days} day(s)`
        + (res.skipped.length ? `; ${res.skipped.length} skipped` : "")
        + (res.missing.length ? `; ${res.missing.length} not in stock` : ""),
      by: g.user,
      payload: { holdId: res.hold.id, reference, days, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: res.sqft },
    });

    return json(plain({ hold: res.hold, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: res.sqft }), 201);
  });
}
