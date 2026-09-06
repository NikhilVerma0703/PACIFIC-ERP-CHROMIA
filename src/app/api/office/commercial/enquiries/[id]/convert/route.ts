// POST /api/office/commercial/enquiries/[id]/convert — the enquiry becomes a
// DRAFT internal sales order.
//
// What it does, in order: refuse if the enquiry cannot be converted (already
// an order, lost, closed, or — the one that catches people — no client on the
// master, because commercial_order.client_id is NOT NULL); copy the lines,
// canonicalising thickness and reading qtySqft as the order's SQFT quantity;
// take the order defaults from the client's commercial ext and the master;
// issue the order number (overridable, like every number here); prefill the
// SOP checklist with the points an enquiry can answer; write the order, its
// `created` event, and the enquiry's ORDERED status and order id.
//
// It returns { orderId, number } — the screen navigates to the order.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { issueNumber } from "@/lib/commercial/sequence";
import { logOrderEvent } from "@/lib/commercial/events";
import { prefillChecklist } from "@/lib/commercial/checklist";
import {
  convertGuard, parseOrderKind, defaultOrderKind, mapEnquiryItemsToOrderItems,
  buildOrderFromEnquiry, checklistSourceFromDraft,
  type ClientForOrder, type EnquiryForOrder, type EnquiryLine,
} from "@/lib/commercial/enquiries-rules";
import { db, loadEnquiry } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id } = await params;
    const enq = await loadEnquiry(id);
    const body = await readBody<Record<string, unknown>>(req);

    // The order it already became, so the refusal can name it.
    const existingOrder = enq.orderId
      ? await db.commercialOrder.findUnique({ where: { id: enq.orderId as string }, select: { number: true } })
      : null;
    const guard = convertGuard(
      { status: String(enq.status), clientId: enq.clientId as string | null, orderId: enq.orderId as string | null, number: enq.number as string },
      existingOrder?.number ?? null,
    );
    if (!guard.ok) fail(guard.status, guard.reason);

    const client = (enq.client ?? await db.salesClient.findUnique({
      where: { id: enq.clientId as string }, include: { commercialExt: true },
    })) as ClientForOrder | null;
    if (!client) fail(400, "That client is no longer on the master.");

    const kind = parseOrderKind(body.kind) ?? defaultOrderKind(client);
    const draft = buildOrderFromEnquiry(enq as unknown as EnquiryForOrder, client, kind);
    const items = mapEnquiryItemsToOrderItems(enq.items as unknown as EnquiryLine[]);
    const checklist = prefillChecklist(null, checklistSourceFromDraft(draft, items));

    const now = new Date();
    const issued = await issueNumber("order", now, body.numberOverride);
    const stamp = actorStamp(g.user);
    let order: { id: string; number: string };
    try {
      order = await db.commercialOrder.create({
        data: {
          ...draft,
          number: issued.number,
          checklist,
          createdById: stamp.id,
          createdByName: stamp.name,
          items: items.length ? { create: items } : undefined,
        },
        select: { id: true, number: true },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        fail(409, `Order number ${issued.number} already exists`);
      }
      throw e;
    }

    await db.commercialEnquiry.update({ where: { id }, data: { status: "ORDERED", orderId: order.id } });
    await logOrderEvent(order.id, "created", {
      note: `Order ${order.number} created from enquiry ${String(enq.number)}${issued.overridden ? " (number typed by hand)" : ""}`,
      by: g.user,
      payload: { number: order.number, kind, clientId: client.id, enquiryId: id, enquiryNumber: enq.number, items: items.length, overridden: issued.overridden },
    });

    return json(plain({ orderId: order.id, number: order.number, kind, items: items.length }), 201);
  });
}
