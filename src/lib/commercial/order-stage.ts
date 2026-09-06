// Moving an order along the pipeline — the server half of ./stages.
//
//   moveOrder(id, "PACKING", by, "Packing list PL/26-27/0004 created")
//     an explicit move, refused only out of a terminal state (canEnter)
//   bumpOrder(id, "STOCK_CHECKED", by, "Hold placed …")
//     the automatic move a side effect implies; only ever moves FORWARD
//     (impliedStage), so a hold placed on an invoiced order changes nothing
//
// Both stamp the stage's timestamp and write an order event. Neither gates
// on anything else — see the note at the head of ./stages.
import { prisma } from "@/lib/prisma";
import { canEnter, impliedStage, stagePatch, stageOf, type OrderStatus } from "./stages";
import { logOrderEvent } from "./events";
import type { CommercialUser } from "./access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export async function moveOrder(orderId: string, to: OrderStatus, by: CommercialUser | null, note?: string | null): Promise<{ ok: true; status: OrderStatus } | { ok: false; reason: string }> {
  const order = await db.commercialOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!order) return { ok: false, reason: "Order not found" };
  const check = canEnter(order.status, to);
  if (!check.ok) return check;
  const now = new Date();
  await db.commercialOrder.update({ where: { id: orderId }, data: stagePatch(to, now) });
  await logOrderEvent(orderId, to === "CANCELLED" ? "cancelled" : "stage", { note: note ?? `${stageOf(order.status)?.label ?? order.status} → ${stageOf(to)?.label ?? to}`, by, payload: { from: order.status, to } });
  return { ok: true, status: to };
}

export async function bumpOrder(orderId: string, implied: OrderStatus, by: CommercialUser | null, note?: string | null): Promise<OrderStatus | null> {
  const order = await db.commercialOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!order) return null;
  const to = impliedStage(order.status, implied);
  if (!to) return null;
  const now = new Date();
  await db.commercialOrder.update({ where: { id: orderId }, data: stagePatch(to, now) });
  await logOrderEvent(orderId, "stage", { note: note ?? `${stageOf(order.status)?.label ?? order.status} → ${stageOf(to)?.label ?? to}`, by, payload: { from: order.status, to, implied: true } });
  return to;
}
