// POST /api/office/commercial/orders/[id]/items — add a line
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, readBody, plain, paramId, str, int, num, fail } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { loadSettings } from "@/lib/commercial/settings";
import { canonThickness } from "@/lib/thickness";
import { defaultsForKind, itemAmount, nextLineNo, describeItem } from "@/lib/commercial/orders-rules";
import { db, loadOrderWithItems, refreshChecklist } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();
    const kd = defaultsForKind(order.kind as "DOMESTIC" | "EXPORT", settings);
    const qty = num(body.qty), rate = num(body.rate);
    if (body.qty !== undefined && body.qty !== null && body.qty !== "" && qty === null) fail(400, "Quantity must be a number");
    if (body.rate !== undefined && body.rate !== null && body.rate !== "" && rate === null) fail(400, "Rate must be a number");
    const thickness = canonThickness(body.thickness);
    const data = {
      orderId: id,
      lineNo: int(body.lineNo) ?? nextLineNo(order.items as Array<{ lineNo: number }>),
      design: str(body.design), customerSku: str(body.customerSku), description: str(body.description),
      thickness: thickness || null, finish: str(body.finish), sizeLabel: str(body.sizeLabel), gradeLabel: str(body.gradeLabel),
      qtySlabs: int(body.qtySlabs), qty, uom: str(body.uom) ?? kd.uom, rate,
      amount: itemAmount(qty, rate, body.amount),
      hsn: str(body.hsn) ?? kd.hsn, isSample: Boolean(body.isSample), notes: str(body.notes),
    };
    if (!data.design && !data.description && !data.customerSku) fail(400, "A line needs a design, a description or a customer SKU");
    const item = await db.commercialOrderItem.create({ data });
    await refreshChecklist(id);
    await logOrderEvent(id, "edited", { note: `Added ${describeItem(item)}`, by: g.user, payload: { item: "added", itemId: item.id, lineNo: item.lineNo } });
    return json(plain(item), 201);
  });
}
