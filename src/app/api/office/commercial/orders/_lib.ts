// Shared by the /api/office/commercial/orders/** handlers: the detail include
// from DESIGN.md §5, the header-field parser, and the checklist refresh every
// write on an order ends with. Not a route — Next ignores a colocated file
// that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail, str, num, dateOnly } from "@/lib/commercial/http";
import { parseChecklist, prefillChecklist, type ChecklistItem, type ChecklistSource } from "@/lib/commercial/checklist";
import {
  HEADER_TEXT_FIELDS, HEADER_PARTY_FIELDS, ORDER_KINDS, PO_EVIDENCE,
  normalizeParty, checklistSourceFromOrder,
  type OrderHeaderLike, type ChecklistItemLike,
} from "@/lib/commercial/orders-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** DESIGN.md §5 — the one include every tab consumes. */
export const ORDER_DETAIL_INCLUDE = {
  client: { include: { commercialExt: true } },
  enquiry: { select: { id: true, number: true } },
  items: { orderBy: { lineNo: "asc" } },
  holds: { include: { slabs: { orderBy: { slabNumber: "asc" } } }, orderBy: { placedAt: "desc" } },
  productionRequests: { orderBy: { raisedAt: "desc" } },
  proformas: { orderBy: [{ number: "asc" }, { revision: "desc" }] },
  packingLists: { include: { crates: { orderBy: { crateNo: "asc" } }, slabs: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "desc" } },
  invoices: { include: { exportDocSet: true }, orderBy: { invoiceDate: "desc" } },
  challans: { orderBy: { challanDate: "desc" } },
  events: { orderBy: { at: "desc" }, take: 100 },
} as const;

/** The order detail, checklist parsed, or a 404. Pass through plain() before json(). */
export async function loadOrderDetail(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialOrder.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
  if (!row) fail(404, "Order not found");
  return { ...row, checklist: parseChecklist(row.checklist) };
}

/** The bare order row with its items (for writes), or a 404. */
export async function loadOrderWithItems(id: string): Promise<Record<string, unknown> & { items: Array<Record<string, unknown>> }> {
  const row = await db.commercialOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  if (!row) fail(404, "Order not found");
  return row;
}

const has = (body: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);

/**
 * The header fields present in a request body, parsed for Prisma. Only keys
 * the body carries are returned, so a PATCH touches nothing it did not name.
 * Enums are checked here (a bad kind is a 400, not a Postgres error).
 */
export function headerPatchFromBody(body: Record<string, unknown>, opts: { allowKind?: boolean; allowClient?: boolean } = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of HEADER_TEXT_FIELDS) if (has(body, k)) data[k] = str(body[k]);
  for (const k of HEADER_PARTY_FIELDS) if (has(body, k)) data[k] = normalizeParty(body[k]);
  if (has(body, "customerPoDate")) {
    const raw = str(body.customerPoDate);
    const d = dateOnly(raw);
    if (raw && !d) fail(400, "Customer PO date must be YYYY-MM-DD");
    data.customerPoDate = d;
  }
  if (has(body, "poEvidence")) {
    const v = str(body.poEvidence);
    if (v && !PO_EVIDENCE.includes(v.toUpperCase())) fail(400, `PO evidence must be one of ${PO_EVIDENCE.join(", ")}`);
    data.poEvidence = v ? v.toUpperCase() : null;
  }
  if (has(body, "exchangeRate")) {
    const raw = body.exchangeRate;
    const n = num(raw);
    if (raw !== null && raw !== undefined && raw !== "" && n === null) fail(400, "Exchange rate must be a number");
    data.exchangeRate = n;
  }
  if (has(body, "currency")) {
    const c = str(body.currency);
    if (c) data.currency = c.toUpperCase();
    else delete data.currency;            // currency is NOT NULL: a blank means "leave it"
  }
  if (has(body, "countryOfOrigin") && !data.countryOfOrigin) delete data.countryOfOrigin;   // same: NOT NULL with a default
  if (opts.allowKind && has(body, "kind")) {
    const k = str(body.kind)?.toUpperCase();
    if (!k || !ORDER_KINDS.includes(k as "DOMESTIC" | "EXPORT")) fail(400, "kind must be DOMESTIC or EXPORT");
    data.kind = k;
  }
  if (opts.allowClient && has(body, "clientId")) {
    const c = str(body.clientId);
    if (!c) fail(400, "clientId is required");
    data.clientId = c;
  }
  if (has(body, "enquiryId")) data.enquiryId = str(body.enquiryId);
  return data;
}

/** A client row with its commercial ext, or a 400 naming the problem. */
export async function loadClient(clientId: string): Promise<Record<string, unknown>> {
  const client = await db.salesClient.findUnique({ where: { id: clientId }, include: { commercialExt: true } });
  if (!client) fail(400, "Client not found");
  return client;
}

/**
 * The order row and its lines in the shape prefillChecklist reads. The loaders
 * hand back `Record<string, unknown>` (the Prisma client is `any` here while
 * the generated types lag the schema), so the cast happens ONCE, here, rather
 * than at each call site — orders-rules names the fields it actually reads.
 */
export function checklistSourceOf(
  order: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): ChecklistSource {
  return checklistSourceFromOrder(order as OrderHeaderLike, items as ChecklistItemLike[]) as ChecklistSource;
}

/**
 * Re-run the checklist prefill from the order as it now stands. Every write
 * on an order ends here: prefill only fills blanks, so a point Commercial
 * answered by hand is never overwritten (lib/commercial/checklist).
 */
export async function refreshChecklist(orderId: string): Promise<ChecklistItem[]> {
  const order = await loadOrderWithItems(orderId);
  const next = prefillChecklist(parseChecklist(order.checklist), checklistSourceOf(order, order.items));
  await db.commercialOrder.update({ where: { id: orderId }, data: { checklist: next } });
  return next;
}

/** Prisma's unique-violation code, so a duplicate order number is a 409. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
