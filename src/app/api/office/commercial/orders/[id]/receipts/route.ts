// GET  /api/office/commercial/orders/[id]/receipts — money received against
//      this order, newest first, with `advanceReceived`
// POST /api/office/commercial/orders/[id]/receipts — record one
//      { kind, amount, currency?, receivedAt, mode?, reference?, notes? }
//
// Answer 29: advance and CAD receipts are recorded here. Answer 2: the first
// ADVANCE is the one fact that lets a packing list dispatch, which is why the
// body goes through receipts-rules before it touches the row — the shape is
// what the pipeline gates on. A terminal order (CLOSED / CANCELLED) 409s.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, dateOnly } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { parseReceipt, advanceReceived, receiptNote, todayIst, canRecordReceipt } from "@/lib/commercial/receipts-rules";
import { db, loadOrderWithItems } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const RECEIPTS_ORDER = [{ receivedAt: "desc" }, { createdAt: "desc" }] as const;

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadOrderWithItems(id);
    const items = await db.commercialReceipt.findMany({ where: { orderId: id }, orderBy: RECEIPTS_ORDER });
    return json(plain({ items, advanceReceived: advanceReceived(items) }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    // A closed or cancelled order takes no more money: there is no dispatch
    // left for an ADVANCE to open (answer 2), and a receipt parked on a
    // finished order is a figure reconciliation would have to chase.
    const allowed = canRecordReceipt(String(order.status ?? ""));
    if (!allowed.ok) fail(409, allowed.reason);
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = parseReceipt(body, { orderCurrency: String(order.currency ?? ""), today: todayIst(new Date()) });
    if (!parsed.ok) fail(400, parsed.error);
    const r = parsed.data;
    const stamp = actorStamp(g.user);
    const row = await db.commercialReceipt.create({
      data: {
        orderId: id,
        kind: r.kind, amount: r.amount, currency: r.currency,
        receivedAt: dateOnly(r.receivedAt),
        mode: r.mode, reference: r.reference, notes: r.notes,
        recordedById: stamp.id, recordedByName: stamp.name,
      },
    });
    await logOrderEvent(id, "receipt_recorded", {
      note: receiptNote(r, "recorded"),
      by: g.user,
      payload: { receiptId: row.id, kind: r.kind, amount: r.amount, currency: r.currency, receivedAt: r.receivedAt, mode: r.mode, reference: r.reference },
    });
    const items = await db.commercialReceipt.findMany({ where: { orderId: id }, orderBy: RECEIPTS_ORDER });
    return json(plain({ receipt: row, items, advanceReceived: advanceReceived(items) }), 201);
  });
}
