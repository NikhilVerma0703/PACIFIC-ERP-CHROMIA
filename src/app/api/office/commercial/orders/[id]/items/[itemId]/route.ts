// PATCH  /api/office/commercial/orders/[id]/items/[itemId] — edit a line
// DELETE /api/office/commercial/orders/[id]/items/[itemId] — remove it and renumber
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, int, num } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { canonThickness } from "@/lib/thickness";
import { itemAmount, renumberLines, describeItem } from "@/lib/commercial/orders-rules";
import { db, loadOrderWithItems, refreshChecklist } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

async function loadItem(orderId: string, itemId: string): Promise<Record<string, unknown>> {
  if (!orderId || !itemId) fail(400, "Missing id");
  const item = await db.commercialOrderItem.findUnique({ where: { id: itemId } });
  if (!item || item.orderId !== orderId) fail(404, "Line not found on this order");
  return item;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "orders");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, itemId } = await params;
    await loadOrderWithItems(id);
    const existing = await loadItem(id, itemId);
    const body = await readBody<Record<string, unknown>>(req);
    const data: Record<string, unknown> = {};
    for (const k of ["design", "customerSku", "description", "finish", "sizeLabel", "gradeLabel", "notes"]) if (has(body, k)) data[k] = str(body[k]);
    if (has(body, "thickness")) { const t = canonThickness(body.thickness); data.thickness = t || null; }
    if (has(body, "uom")) { const u = str(body.uom); if (u) data.uom = u; }
    if (has(body, "hsn")) { const h = str(body.hsn); if (h) data.hsn = h; }
    if (has(body, "isSample")) data.isSample = Boolean(body.isSample);
    if (has(body, "lineNo")) { const n = int(body.lineNo); if (n && n > 0) data.lineNo = n; }
    if (has(body, "qtySlabs")) data.qtySlabs = int(body.qtySlabs);
    if (has(body, "qty")) {
      const q = num(body.qty);
      if (body.qty !== null && body.qty !== "" && q === null) fail(400, "Quantity must be a number");
      data.qty = q;
    }
    if (has(body, "rate")) {
      const r = num(body.rate);
      if (body.rate !== null && body.rate !== "" && r === null) fail(400, "Rate must be a number");
      data.rate = r;
    }
    // amount: what was typed stands; otherwise recompute only when qty or rate moved
    const typedAmount = has(body, "amount") ? num(body.amount) : null;
    const dec = (v: unknown): number | null => (v == null ? null : typeof v === "number" ? v : Number((v as { toString(): string }).toString()));
    const qty = has(data, "qty") ? (data.qty as number | null) : dec(existing.qty);
    const rate = has(data, "rate") ? (data.rate as number | null) : dec(existing.rate);
    if (typedAmount !== null) data.amount = itemAmount(qty, rate, typedAmount);
    else if (has(data, "qty") || has(data, "rate")) data.amount = itemAmount(qty, rate);
    if (Object.keys(data).length === 0) return json(plain(existing));
    const item = await db.commercialOrderItem.update({ where: { id: itemId }, data });
    await refreshChecklist(id);
    await logOrderEvent(id, "edited", { note: `Edited ${describeItem(item)} (${Object.keys(data).join(", ")})`, by: g.user, payload: { item: "edited", itemId, lineNo: item.lineNo, fields: Object.keys(data) } });
    return json(plain(item));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "orders");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, itemId } = await params;
    const order = await loadOrderWithItems(id);
    const item = await loadItem(id, itemId);
    const rest = (order.items as Array<{ id: string; lineNo: number }>).filter((i) => i.id !== itemId);
    const renumber = renumberLines(rest);
    await db.$transaction([
      db.commercialOrderItem.delete({ where: { id: itemId } }),
      ...renumber.map((r) => db.commercialOrderItem.update({ where: { id: r.id }, data: { lineNo: r.lineNo } })),
    ]);
    await refreshChecklist(id);
    await logOrderEvent(id, "edited", { note: `Removed ${describeItem(item)}`, by: g.user, payload: { item: "deleted", itemId, lineNo: item.lineNo, renumbered: renumber.length } });
    return json({ ok: true, deleted: itemId, renumbered: renumber.length });
  });
}
