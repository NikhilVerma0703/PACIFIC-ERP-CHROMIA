// GET  /api/office/commercial/orders/[id]/holds — this order's holds
// POST /api/office/commercial/orders/[id]/holds — put slabs on hold for it
//
// The 5-day stock hold (settings.holdDays; the body may ask for another length
// within the cap). The slabs become RESERVED in finished goods under this
// order's number, which is what the Finished Goods screen, the inventory sweep
// and the packing list all read; commercial_stock_hold is the module's own
// record of who held what, against what, until when.
//
// When the days run out nothing here extends them (answer 11): the sweep frees
// the slabs, reconcileHold marks the hold EXPIRED and, if it was the order's
// last live hold, sends the order back to CONFIRMED for a fresh stock check.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import { pageArgs, holdTarget } from "@/lib/commercial/holds-rules";
import { db, HOLD_INCLUDE, placeOrderHold, loadOrderForHold } from "../../../holds/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadOrderForHold(id);
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
    const body = await readBody<Record<string, unknown>>(req);
    // The path names the order; a body that ALSO names an enquiry and a
    // different order is confused about what it is holding for, and is
    // answered rather than guessed at (answer 12).
    const target = holdTarget({ ...body, orderId: str(body.orderId) ?? id });
    if (!target.ok) fail(400, target.reason);
    if (target.orderId !== id) fail(400, "The body's orderId does not match the order in the path.");
    const res = await placeOrderHold(id, body, g);
    return json(plain({ hold: res.hold, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: res.sqft }), 201);
  });
}
