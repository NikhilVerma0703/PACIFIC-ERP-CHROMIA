// GET  /api/office/commercial/holds?status=&orderId=&enquiryId= — every hold
// POST /api/office/commercial/holds — { orderId, slabNumbers, … } places an
//      order hold, the same as POST /orders/[id]/holds
//
// There are no enquiry holds (answer 12). This route used to place one when
// the body named an enquiry; it now refuses that with the reason, and the
// enquiry filter on GET stays only so the holds placed before the answer can
// still be found.
//
// The list reconciles each ACTIVE hold on the page against live inventory
// before returning it. It is a handful of reads per page and it keeps the
// module honest: a hold whose five days lapsed overnight reads EXPIRED here,
// not ACTIVE, because the inventory sweep has already freed its slabs — and
// reconcileHold has already sent the order back to the stock check (answer 11).
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import { parseHoldStatus, pageArgs, holdTarget } from "@/lib/commercial/holds-rules";
import { db, HOLD_INCLUDE, placeOrderHold } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "stock");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const status = parseHoldStatus(u.searchParams.get("status"));
    const orderId = str(u.searchParams.get("orderId"));
    const enquiryId = str(u.searchParams.get("enquiryId"));
    const reference = str(u.searchParams.get("reference"));
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (orderId) where.orderId = orderId;
    if (enquiryId) where.enquiryId = enquiryId;
    if (reference) where.reference = { contains: reference, mode: "insensitive" };
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));

    // Reconcile the page's ACTIVE holds first, then read them back, so the rows
    // returned already carry the status the reconciliation just wrote.
    const ids: Array<{ id: string; status: string }> = await db.commercialStockHold.findMany({
      where, orderBy: { placedAt: "desc" }, skip, take: limit, select: { id: true, status: true },
    });
    for (const h of ids) if (h.status === "ACTIVE") await reconcileHold(h.id);

    const [rows, total] = await Promise.all([
      db.commercialStockHold.findMany({ where, orderBy: { placedAt: "desc" }, skip, take: limit, include: HOLD_INCLUDE }),
      db.commercialStockHold.count({ where }),
    ]);
    // A status filter is applied before reconciliation, so a hold that has just
    // been marked EXPIRED can still be on an ?status=ACTIVE page. Drop it here
    // rather than showing it as active one last time.
    const items = status ? (rows as Array<{ status: string }>).filter((r) => r.status === status) : rows;
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request) {
  const g = await commercialGate("write", "stock");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const target = holdTarget(body);
    if (!target.ok) fail(400, target.reason);
    const res = await placeOrderHold(target.orderId, body, g);
    return json(plain({ hold: res.hold, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: res.sqft }), 201);
  });
}
