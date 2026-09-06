// Shared by the proforma handlers — /api/office/commercial/proformas/** and
// /api/office/commercial/orders/[id]/proformas. Not a route: Next ignores a
// colocated file that is not route.ts.
//
// The decisions (what a snapshot contains, which status may move where, what
// prints) live in lib/commercial/proforma-rules and are tested there; this file
// only reads and writes rows.
import { prisma } from "@/lib/prisma";
import { fail, paramId } from "@/lib/commercial/http";
import type { ProformaSnapshot } from "@/lib/commercial/types";

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
  snapshot: ProformaSnapshot;
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

/** Every revision of one number — what issuing has to supersede. */
export async function siblingRevisions(number: string): Promise<Array<{ id: string; number: string; status: string; revision: number }>> {
  return db.commercialProforma.findMany({
    where: { number },
    select: { id: true, number: true, status: true, revision: true },
    orderBy: { revision: "asc" },
  });
}

/** The columns the register and the PI tab list (never the whole snapshot). */
export const PI_LIST_SELECT = {
  id: true, orderId: true, number: true, revision: true, status: true,
  issuedAt: true, validUntil: true, acceptedAt: true, supersededAt: true,
  currency: true, totalAmount: true, notes: true, createdAt: true, updatedAt: true,
} as const;

/** A snapshot read back out of the Json column, or a 500 that names the row. */
export function snapshotOf(pi: ProformaRow): ProformaSnapshot {
  const s = pi.snapshot as unknown;
  if (!s || typeof s !== "object" || Array.isArray(s)) fail(500, `Proforma ${pi.number}-R${pi.revision} has no usable snapshot`);
  return s as ProformaSnapshot;
}
