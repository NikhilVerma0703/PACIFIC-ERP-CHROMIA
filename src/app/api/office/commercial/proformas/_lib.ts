// Shared by the proforma handlers — /api/office/commercial/proformas/** and
// /api/office/commercial/orders/[id]/proformas. Not a route: Next ignores a
// colocated file that is not route.ts.
//
// The decisions (what a snapshot contains, which status may move where, what
// prints, when issuing is refused) live in lib/commercial/proforma-rules and
// are tested there; this file only reads and writes rows.
import { prisma } from "@/lib/prisma";
import { fail, paramId } from "@/lib/commercial/http";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import type { IssueOrderFacts, PiSnapshot } from "@/lib/commercial/proforma-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** These segments are [piId]; http.paramId reads `id`, so rename on the way in
 *  and keep its "missing id is a 400, not a crash" behaviour. */
export const piIdOf = (params: Promise<{ piId: string }>): Promise<string> =>
  paramId(params.then((p) => ({ id: p.piId })));

/** The order as buildProformaSnapshot wants it: header, client + ext, lines. */
export const ORDER_FOR_SNAPSHOT = {
  client: { include: { commercialExt: true } },
  items: { orderBy: { lineNo: "asc" } },
} as const;

export async function loadOrderForPi(orderId: string): Promise<Record<string, unknown>> {
  if (!orderId) fail(400, "Missing order id");
  const row = await db.commercialOrder.findUnique({ where: { id: orderId }, include: ORDER_FOR_SNAPSHOT });
  if (!row) fail(404, "Order not found");
  return row;
}

export interface ProformaRow extends Record<string, unknown> {
  id: string;
  orderId: string;
  number: string;
  revision: number;
  status: string;
  snapshot: PiSnapshot;
  order?: { id: string; number: string; kind: string; status: string; clientId: string } | null;
}

/** One PI with the bit of its order every handler needs, or a 404. */
export async function loadProforma(piId: string): Promise<ProformaRow> {
  if (!piId) fail(400, "Missing proforma id");
  const row = await db.commercialProforma.findUnique({
    where: { id: piId },
    include: { order: { select: { id: true, number: true, kind: true, status: true, clientId: true } } },
  });
  if (!row) fail(404, "Proforma invoice not found");
  return row as ProformaRow;
}

/** Every PI of one order — what issuing has to retire, and what the next
 *  ordinal is counted over. */
export async function orderProformas(orderId: string): Promise<Array<{ id: string; orderId: string; number: string; status: string; revision: number }>> {
  return db.commercialProforma.findMany({
    where: { orderId },
    select: { id: true, orderId: true, number: true, status: true, revision: true },
    orderBy: { revision: "asc" },
  });
}

/** The order's DRAFT PIs with their snapshots — what refuseRevise reads to
 *  find a draft that already revises the PI being revised (its `revises`
 *  link lives in the snapshot, not in a column). */
export async function orderDrafts(orderId: string): Promise<Array<{ id: string; number: string; status: string; snapshot: PiSnapshot | null }>> {
  return db.commercialProforma.findMany({
    where: { orderId, status: "DRAFT" },
    select: { id: true, number: true, status: true, snapshot: true },
    orderBy: { revision: "asc" },
  });
}

/**
 * The facts piIssueRefusal asks about (answer 1). The order's ACTIVE holds
 * are reconciled first, the way the holds register does on read, so a hold
 * that lapsed since anyone last looked is counted as lapsed and the PI is
 * refused rather than issued against stock that is no longer held.
 */
export async function issueFactsOf(orderId: string): Promise<IssueOrderFacts> {
  const order = await db.commercialOrder.findUnique({ where: { id: orderId }, select: { status: true, stockCheckedAt: true } });
  if (!order) fail(404, "Order not found");
  const active: Array<{ id: string }> = await db.commercialStockHold.findMany({ where: { orderId, status: "ACTIVE" }, select: { id: true } });
  for (const h of active) await reconcileHold(h.id);
  const activeHolds = await db.commercialStockHold.count({ where: { orderId, status: "ACTIVE" } });
  return { status: String(order.status), stockCheckedAt: order.stockCheckedAt ?? null, activeHolds };
}

/** The columns the register and the PI tab list (never the whole snapshot). */
export const PI_LIST_SELECT = {
  id: true, orderId: true, number: true, revision: true, status: true,
  issuedAt: true, validUntil: true, acceptedAt: true, supersededAt: true, cancelledAt: true, cancelReason: true,
  currency: true, totalAmount: true, notes: true, createdAt: true, updatedAt: true,
} as const;

/** A snapshot read back out of the Json column, or a 500 that names the row. */
export function snapshotOf(pi: ProformaRow): PiSnapshot {
  const s = pi.snapshot as unknown;
  if (!s || typeof s !== "object" || Array.isArray(s)) fail(500, `Proforma ${pi.number} has no usable snapshot`);
  return s as PiSnapshot;
}
