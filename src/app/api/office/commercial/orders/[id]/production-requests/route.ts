// GET  /api/office/commercial/orders/[id]/production-requests — this order's
// POST /api/office/commercial/orders/[id]/production-requests — raise one
//
// What happens when the stock check comes up short: the shortfall goes into the
// Production Planning queue at the back (priority = one past the last request
// still open), the order gets an event, and notifyShortage() tells whichever
// channel Settings has switched on (answer 13: Varun's private Telegram and a
// mail to vmundra, both degrading silently until their credentials exist).
//
// The request is born with its plan (answer 13): plannedSlabs = the shortfall,
// shade = the design master's, cleaningHours = the queue rule against the row
// that will run before it. The planner edits those on the planning page.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str, int } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { notifyShortage } from "@/lib/commercial/notify";
import { canonThickness } from "@/lib/thickness";
import { shortfall, nextPriority, parseStatusFilter, historyOnly, initialPlan, lastInChain } from "@/lib/commercial/production-rules";
import { pageArgs } from "@/lib/commercial/holds-rules";
import { db, REQUEST_INCLUDE, loadOrderForRequest, colourForDesign, loadChainRows, loadPlanning } from "../../../production-requests/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "planning");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadOrderForRequest(id);
    const u = new URL(req.url);
    const raw = u.searchParams.get("status");
    const statuses = raw ? parseStatusFilter(raw) : null;
    const where: Record<string, unknown> = { orderId: id };
    if (statuses) where.status = { in: statuses };
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const orderBy = statuses && historyOnly(statuses) ? { raisedAt: "desc" as const } : { priority: "asc" as const };
    const [items, total] = await Promise.all([
      db.commercialProductionRequest.findMany({ where, orderBy, skip, take: limit, include: REQUEST_INCLUDE }),
      db.commercialProductionRequest.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "planning");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderForRequest(id);
    const body = await readBody<Record<string, unknown>>(req);

    const design = str(body.design);
    if (!design) fail(400, "Which design is short?");
    const thickness = canonThickness(body.thickness);
    if (!thickness) fail(400, "Give the thickness");
    const qtyRequired = int(body.qtyRequired);
    if (qtyRequired === null || qtyRequired <= 0) fail(400, "How many slabs are needed?");
    const qtyAvailable = int(body.qtyAvailable) ?? 0;
    const qtyShort = shortfall(qtyRequired, qtyAvailable);
    if (qtyShort <= 0) fail(400, "Nothing is short — stock covers the quantity required.");

    const orderItemId = str(body.orderItemId);
    if (orderItemId) {
      const item = await db.commercialOrderItem.findFirst({ where: { id: orderItemId, orderId: id }, select: { id: true } });
      if (!item) fail(400, "That line is not on this order");
    }

    // One queue for the plant, so the priority is one past the last OPEN
    // request anywhere — not just this order's.
    const open: Array<{ priority: number; status: string }> = await db.commercialProductionRequest.findMany({
      select: { priority: true, status: true },
      where: { status: { in: ["QUEUED", "SCHEDULED", "IN_PRODUCTION"] } },
    });
    const priority = nextPriority(open);
    const stamp = actorStamp(g.user);

    // The row before this one is the last QUEUED / SCHEDULED request by
    // priority — or, when the queue is empty, the row the plant is running
    // now (else the last one it produced). Answer 13's case: a DARK row in
    // production and a LIGHT request raised behind it is the 6-hour clean,
    // so the running row must count as the predecessor even though its own
    // figure is never rewritten (production-rules.lastInChain).
    // Both sides of the changeover go in as COLOUR rows, not shade words
    // (round two, answer 14): the master's measured L* decides, and the label
    // only stands in for a design nobody has measured. The chain rows already
    // carry the master's L* (loadChainRows).
    const [colour, chain, planning] = await Promise.all([colourForDesign(design), loadChainRows(), loadPlanning()]);
    const prev = lastInChain(chain);
    const plan = initialPlan(qtyShort, colour, prev, planning);

    const row = await db.commercialProductionRequest.create({
      data: {
        orderId: id,
        orderItemId: orderItemId ?? null,
        enquiryId: (order.enquiryId as string | null) ?? null,
        design, thickness,
        finish: str(body.finish),
        qtyRequired, qtyAvailable, qtyShort,
        priority,
        status: "QUEUED",
        plannedSlabs: plan.plannedSlabs,
        shade: plan.shade,
        cleaningHours: plan.cleaningHours,
        // notes is Commercial's ("ship by the 20th"); the cleaning note and the
        // planned batch are the planner's and are set on the queue, not here.
        notes: str(body.notes),
        raisedById: stamp.id, raisedByName: stamp.name,
      },
      include: REQUEST_INCLUDE,
    });

    await logOrderEvent(id, "production_requested", {
      note: `${qtyShort} slab(s) of ${design} ${thickness} requested from production (needed ${qtyRequired}, ${qtyAvailable} in stock)`,
      by: g.user,
      payload: { requestId: row.id, design, thickness, qtyRequired, qtyAvailable, qtyShort, priority, plannedSlabs: plan.plannedSlabs, shade: plan.shade, cleaningHours: plan.cleaningHours },
    });

    const client = order.client as { name?: string } | null;
    await notifyShortage({
      requestId: row.id,
      design, thickness,
      qtyRequired, qtyAvailable, qtyShort,
      orderNumber: String(order.number),
      customer: client?.name ?? null,
      raisedBy: stamp.name,
    });

    // Re-read: notifyShortage stamps notifiedAt / notifiedVia on the row.
    const fresh = await db.commercialProductionRequest.findUnique({ where: { id: row.id }, include: REQUEST_INCLUDE });
    return json(plain(fresh ?? row), 201);
  });
}
