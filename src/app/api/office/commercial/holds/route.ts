// GET  /api/office/commercial/holds?status=&orderId=&enquiryId= — every hold
// POST /api/office/commercial/holds — an ENQUIRY-referenced hold
//
// A hold may be placed before there is an order (owner default, open question
// 12): the reference is then the enquiry number. Order-referenced holds are
// placed at /orders/[id]/holds, which also bumps the order's stage.
//
// The list reconciles each ACTIVE hold on the page against live inventory
// before returning it. It is a handful of reads per page and it keeps the
// module honest: a hold whose five days lapsed overnight reads EXPIRED here,
// not ACTIVE, because the inventory sweep has already freed its slabs.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import { parseSlabNumbers, normaliseDays, resolveHoldReference, parseHoldStatus, pageArgs } from "@/lib/commercial/holds-rules";
import { db, HOLD_INCLUDE, placeHold } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view");
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
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const enquiryId = str(body.enquiryId);
    if (!enquiryId) fail(400, "An enquiry hold needs enquiryId — hold against an order at /orders/[id]/holds");
    const enquiry = await db.commercialEnquiry.findUnique({
      where: { id: enquiryId },
      select: {
        id: true, number: true, prospectName: true,
        client: { select: { id: true, name: true } },
        // An enquiry that has already been converted: its order's number is
        // the only other reference its stock may sit under.
        orders: { select: { number: true } },
      },
    });
    if (!enquiry) fail(404, "Enquiry not found");

    const slabNumbers = parseSlabNumbers(body.slabNumbers);
    if (!slabNumbers.length) fail(400, "Tick at least one slab to hold");

    const settings = await loadSettings();
    const days = normaliseDays(body.days, settings.holdDays);
    // As on the order route: the reference decides which slabs this module will
    // later treat as its own to release and to pack, so it is derived from the
    // enquiry (and the order it became), never taken from the body on trust.
    const orders = (enquiry.orders ?? []) as Array<{ number?: string | null }>;
    const ref = resolveHoldReference(body.reference, [String(enquiry.number), ...orders.map((o) => o.number ?? null)]);
    if (!ref.ok) fail(400, ref.reason);
    const reference = ref.reference;
    const client = enquiry.client as { name?: string } | null;
    const customer = str(body.customer) ?? client?.name ?? (enquiry.prospectName as string | null) ?? null;
    const stamp = actorStamp(g.user);

    const res = await placeHold({
      slabNumbers, reference, customer, days,
      notes: str(body.notes),
      orderId: null, enquiryId,
      by: stamp.name, byId: stamp.id, isAdmin: g.actor === "ADMIN",
    });
    // No order, so no order event: the enquiry's holds are its own record until
    // the enquiry is converted, and the hold row carries who placed it.
    return json(plain({ hold: res.hold, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: res.sqft }), 201);
  });
}
