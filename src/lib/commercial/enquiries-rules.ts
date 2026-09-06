// Enquiries — the PURE rules behind /api/office/commercial/enquiries.
//
// An enquiry is what Commercial logs from the e-mail that brought it: who
// asked (a client on the master, or a prospect not yet on it), what they
// asked for (design / SKU / thickness / quantity lines), and what became of
// it. The decisions live here so node --test can run them: which status
// changes are allowed and what each one writes, what a header or a line
// must carry to be saved, whether an enquiry can become an order, and how
// its lines and its client's defaults turn into the DRAFT order's fields.
//
// Imports only ../thickness.ts and ./clients-rules.ts, both pure. Tested in
// tests/commercialEnquiries.test.ts.
import { canonThickness } from "../thickness.ts";
import { partyFromClient, type PartyBlock } from "./clients-rules.ts";
import type { ChecklistSource } from "./checklist.ts";

export const ENQUIRY_STATUSES = ["NEW", "QUOTED", "ORDERED", "LOST", "CLOSED"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** Still being worked: what the dashboard counts as open. */
export const OPEN_ENQUIRY_STATUSES: readonly EnquiryStatus[] = ["NEW", "QUOTED"];

/** How the enquiry reached Commercial. EMAIL is the default (owner: enquiries
 *  arrive by e-mail). Free text is accepted too; these are the offered ones. */
export const ENQUIRY_SOURCES = ["EMAIL", "PHONE", "WHATSAPP", "VISIT", "WEBSITE", "REFERRAL", "OTHER"] as const;

export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = {
  NEW: "New", QUOTED: "Quoted", ORDERED: "Ordered", LOST: "Lost", CLOSED: "Closed",
};

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
};
const has = (body: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(body, key);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function isEnquiryStatus(v: unknown): v is EnquiryStatus {
  return typeof v === "string" && (ENQUIRY_STATUSES as readonly string[]).includes(v);
}

export type StatusChange =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; status: number; reason: string };

/**
 * May an enquiry in `current` be set to `to`, and what does that write?
 *
 *   → LOST      needs a reason (it is the one thing the owner will ask later)
 *   → ORDERED   never by hand: Convert to order sets it and links the order
 *   from ORDERED nothing moves — the order carries the lifecycle from here
 *   → NEW/QUOTED from LOST or CLOSED reopens and clears the lost reason
 *   → CLOSED    from anything open (dropped without a quote, or a duplicate)
 */
export function enquiryStatusChange(current: string, to: unknown, opts: { lostReason?: unknown } = {}): StatusChange {
  if (!isEnquiryStatus(to)) return { ok: false, status: 400, reason: `Unknown status ${String(to)}` };
  if (to === current) return { ok: false, status: 400, reason: `Already ${ENQUIRY_STATUS_LABEL[to]}` };
  if (to === "ORDERED") return { ok: false, status: 400, reason: "Use Convert to order — it creates the order and marks the enquiry Ordered." };
  if (current === "ORDERED") return { ok: false, status: 409, reason: "This enquiry has become an order; its status follows the order now." };
  if (to === "LOST") {
    const reason = s(opts.lostReason);
    if (!reason) return { ok: false, status: 400, reason: "Say why the enquiry was lost." };
    return { ok: true, patch: { status: "LOST", lostReason: reason } };
  }
  if (to === "NEW" || to === "QUOTED") return { ok: true, patch: { status: to, lostReason: null } };
  return { ok: true, patch: { status: "CLOSED" } };
}

/** A YYYY-MM-DD or ISO string, or a Date → Date; null when not a date. */
export function parseWhen(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const t = s(v);
  if (!t) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00.000Z` : t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const ENQUIRY_HEADER_FIELDS = [
  "clientId", "prospectName", "contactName", "contactEmail", "contactPhone", "source", "subject", "body", "assignedToId",
] as const;

export type HeaderParse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * The enquiry header from a body. create: `receivedAt` defaults to now,
 * `source` to EMAIL, and either a client or a prospect name must be there —
 * an enquiry from nobody cannot be followed up. patch: only the keys sent
 * are written (the counterparty check is the route's, after merging).
 */
export function parseEnquiryHeader(input: unknown, mode: "create" | "patch", now: Date = new Date()): HeaderParse {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of ENQUIRY_HEADER_FIELDS) {
    if (mode === "create" || has(body, k)) data[k] = s(body[k]);
  }
  if (typeof data.source === "string") data.source = data.source.toUpperCase();
  if (mode === "create" && !data.source) data.source = "EMAIL";
  if (has(body, "receivedAt") || mode === "create") {
    const when = parseWhen(body.receivedAt);
    if (has(body, "receivedAt") && body.receivedAt && !when) return { ok: false, status: 400, error: "Received date is not a date." };
    if (when) data.receivedAt = when;
    else if (mode === "create") data.receivedAt = now;
  }
  if (mode === "create" && !data.clientId && !data.prospectName) {
    return { ok: false, status: 400, error: "Attach a client or give the prospect's name." };
  }
  if (typeof data.contactEmail === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) {
    return { ok: false, status: 400, error: `"${data.contactEmail}" is not an e-mail address.` };
  }
  return { ok: true, data };
}

/** After a patch: does the enquiry still name somebody? */
export function hasCounterparty(row: { clientId?: string | null; prospectName?: string | null }): boolean {
  return Boolean(s(row.clientId) || s(row.prospectName));
}

export type ItemParse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * One enquiry line. Thickness is canonicalised ('2 cm'), quantities must be
 * non-negative numbers (slabs a whole one), and a new line must name the
 * design or the customer's SKU — a line with neither describes nothing.
 */
export function parseEnquiryItem(input: unknown, mode: "create" | "patch"): ItemParse {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of ["design", "customerSku", "finish", "notes"] as const) {
    if (mode === "create" || has(body, k)) data[k] = s(body[k]);
  }
  if (mode === "create" || has(body, "thickness")) {
    const t = s(body.thickness);
    data.thickness = t ? canonThickness(t) : null;
  }
  if (mode === "create" || has(body, "qtySlabs")) {
    const n = numOrNull(body.qtySlabs);
    if (body.qtySlabs !== undefined && body.qtySlabs !== null && body.qtySlabs !== "" && n === null) return { ok: false, status: 400, error: "Slabs must be a number." };
    if (n !== null && (n < 0 || !Number.isInteger(n))) return { ok: false, status: 400, error: "Slabs must be a whole number, zero or more." };
    data.qtySlabs = n;
  }
  if (mode === "create" || has(body, "qtySqft")) {
    const n = numOrNull(body.qtySqft);
    if (body.qtySqft !== undefined && body.qtySqft !== null && body.qtySqft !== "" && n === null) return { ok: false, status: 400, error: "Sq ft must be a number." };
    if (n !== null && n < 0) return { ok: false, status: 400, error: "Sq ft cannot be negative." };
    data.qtySqft = n === null ? null : Math.round(n * 1000) / 1000;
  }
  if (mode === "create" && !data.design && !data.customerSku) {
    return { ok: false, status: 400, error: "Name the design or the customer's SKU on each line." };
  }
  return { ok: true, data };
}

/** The next line number: one past the highest, or 1 on an empty list. */
export function nextLineNo(items: Array<{ lineNo: number }>): number {
  return items.reduce((m, i) => Math.max(m, i.lineNo || 0), 0) + 1;
}

/** Items in a POST body: an array of lines, each parsed as a create; the
 *  first bad line stops the whole save so nothing half-lands. */
export function parseEnquiryItems(input: unknown): { ok: true; items: Array<Record<string, unknown>> } | { ok: false; status: number; error: string } {
  if (input === undefined || input === null) return { ok: true, items: [] };
  if (!Array.isArray(input)) return { ok: false, status: 400, error: "items must be a list." };
  const items: Array<Record<string, unknown>> = [];
  for (let i = 0; i < input.length; i++) {
    const r = parseEnquiryItem(input[i], "create");
    if (!r.ok) return { ok: false, status: r.status, error: `Line ${i + 1}: ${r.error}` };
    items.push({ ...r.data, lineNo: i + 1 });
  }
  return { ok: true, items };
}

export type OrderKind = "DOMESTIC" | "EXPORT";

export function parseOrderKind(v: unknown): OrderKind | null {
  const t = String(v ?? "").trim().toUpperCase();
  return t === "DOMESTIC" || t === "EXPORT" ? t : null;
}

/**
 * The kind the Convert dialog offers first when the body names none: an
 * Indian client is a DTA (domestic) sale, everyone else is an export. The
 * country column is free text on the shared master, so "India", "india" and
 * " INDIA " all count and anything blank falls to EXPORT — the module's own
 * default currency (USD) and the CIOT workbook are the export path, and a
 * domestic order is the smaller correction to make on the order screen.
 */
export function defaultOrderKind(client: { country?: string | null } | null | undefined): OrderKind {
  const c = String(client?.country ?? "").trim().toLowerCase();
  return c === "india" || c === "in" || c === "bharat" ? "DOMESTIC" : "EXPORT";
}

export type ConvertGuard = { ok: true } | { ok: false; status: number; reason: string };

/**
 * May this enquiry become an order? An order needs a client on the master
 * (commercial_order.client_id is NOT NULL), so a prospect-only enquiry is
 * refused with the fix spelled out; one already converted points at its
 * order; a lost or closed one has to be reopened first, so the change of
 * mind is on record.
 */
export function convertGuard(enq: { status: string; clientId?: string | null; orderId?: string | null; number?: string | null }, orderNumber?: string | null): ConvertGuard {
  if (enq.status === "ORDERED" || enq.orderId) {
    return { ok: false, status: 409, reason: `Enquiry ${enq.number ?? ""} is already order ${orderNumber ?? enq.orderId ?? ""}.`.replace(/\s+/g, " ").trim() };
  }
  if (!s(enq.clientId)) {
    return { ok: false, status: 400, reason: "Attach a client before converting: an order needs a client on the master. Open the enquiry, pick the client (or create one from the prospect's details), save, then convert." };
  }
  if (enq.status === "LOST" || enq.status === "CLOSED") {
    return { ok: false, status: 409, reason: `This enquiry is ${ENQUIRY_STATUS_LABEL[enq.status as EnquiryStatus].toLowerCase()}; set it back to New first.` };
  }
  return { ok: true };
}

export interface EnquiryLine {
  lineNo: number;
  design?: string | null;
  customerSku?: string | null;
  thickness?: string | null;
  finish?: string | null;
  qtySlabs?: number | null;
  qtySqft?: number | string | null;
  notes?: string | null;
}

export interface OrderLineData {
  lineNo: number;
  design: string | null;
  customerSku: string | null;
  description: string | null;
  thickness: string | null;
  finish: string | null;
  qtySlabs: number | null;
  qty: number | null;
  uom: string;
  notes: string | null;
}

/**
 * Enquiry lines → order lines. Sorted by line number and renumbered 1..n
 * (a line deleted mid-list leaves no gap on the order), thickness canonical,
 * qtySqft becomes qty in SQFT, and a description is composed from
 * design / finish / thickness the way the PI prints it — the orders screen
 * lets Commercial rewrite it. Rates are not on an enquiry; they stay null.
 */
export function mapEnquiryItemsToOrderItems(items: EnquiryLine[]): OrderLineData[] {
  return [...items]
    .sort((a, b) => (a.lineNo || 0) - (b.lineNo || 0))
    .map((it, i) => {
      const design = s(it.design);
      const thickness = s(it.thickness) ? canonThickness(it.thickness) : null;
      const finish = s(it.finish);
      const qty = numOrNull(it.qtySqft);
      return {
        lineNo: i + 1,
        design,
        customerSku: s(it.customerSku),
        description: [design, finish, thickness].filter(Boolean).join("-") || null,
        thickness,
        finish,
        qtySlabs: it.qtySlabs ?? null,
        qty: qty === null ? null : Math.round(qty * 1000) / 1000,
        uom: "SQFT",
        notes: s(it.notes),
      };
    });
}

export interface ClientForOrder {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  contactPerson?: string | null;
  defaultCurrency?: string | null;
  defaultPaymentTerms?: string | null;
  defaultDeliveryTerms?: string | null;
  defaultPortOfDischarge?: string | null;
  commercialExt?: {
    customerCode?: string | null; gstin?: string | null; stateCode?: string | null;
    billingAddress?: PartyBlock | null; shippingAddress?: PartyBlock | null; notifyParty?: PartyBlock | null;
    defaultIncoterm?: string | null; defaultCurrency?: string | null;
  } | null;
}

export interface EnquiryForOrder {
  id: string;
  number: string;
  clientId: string;
  subject?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/** The customer's contact line for the SOP checklist point 19. */
export function contactLine(enq: Pick<EnquiryForOrder, "contactName" | "contactEmail" | "contactPhone">, client: Pick<ClientForOrder, "contactPerson" | "email" | "phone">): string | null {
  const own = [s(enq.contactName), s(enq.contactEmail), s(enq.contactPhone)].filter(Boolean);
  if (own.length) return own.join(" · ");
  const fallback = [s(client.contactPerson), s(client.email), s(client.phone)].filter(Boolean);
  return fallback.length ? fallback.join(" · ") : null;
}

/**
 * The DRAFT order's header from the enquiry and its client's defaults. The
 * ext row's defaults win over the master's (they were set for this module);
 * the currency falls to INR for a domestic order and USD for export when
 * neither names one; bill-to is the ext billing block or a block printed
 * from the master; the consignee is the shipping block or the bill-to.
 * Number, checklist and the createdBy stamp are the route's to add.
 */
/**
 * The DRAFT order's header, typed. Named rather than left as
 * Record<string, unknown> so the convert route can hand it straight to the
 * checklist prefill without a cast — an index-signature object satisfies none
 * of the checklist's optional field types.
 */
export interface OrderDraft {
  kind: OrderKind;
  status: "DRAFT";
  clientId: string;
  enquiryId: string;
  currency: string;
  incoterm: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  portOfDischarge: string | null;
  billTo: PartyBlock;
  consignee: PartyBlock;
  notifyParty: PartyBlock | null;
  countryOfDestination: string | null;
  customerContact: string | null;
  notes: string;
}

export function buildOrderFromEnquiry(enq: EnquiryForOrder, client: ClientForOrder, kind: OrderKind): OrderDraft {
  const ext = client.commercialExt ?? null;
  const billTo: PartyBlock = ext?.billingAddress ?? partyFromClient(client, ext);
  const consignee: PartyBlock = ext?.shippingAddress ?? billTo;
  const currency = s(ext?.defaultCurrency) ?? s(client.defaultCurrency) ?? (kind === "DOMESTIC" ? "INR" : "USD");
  const country = s(consignee.country) ?? s(client.country) ?? (kind === "DOMESTIC" ? "India" : null);
  return {
    kind,
    status: "DRAFT",
    clientId: client.id,
    enquiryId: enq.id,
    currency,
    incoterm: s(ext?.defaultIncoterm),
    deliveryTerms: s(client.defaultDeliveryTerms),
    paymentTerms: s(client.defaultPaymentTerms),
    portOfDischarge: s(client.defaultPortOfDischarge),
    billTo,
    consignee,
    notifyParty: ext?.notifyParty ?? null,
    countryOfDestination: country,
    customerContact: contactLine(enq, client),
    notes: `From enquiry ${enq.number}${s(enq.subject) ? `: ${s(enq.subject)}` : ""}`,
  };
}

/**
 * The DRAFT order in the shape lib/commercial/checklist prefillChecklist
 * reads, so the converted order arrives with the SOP sheet's answerable
 * points already answered. What an enquiry cannot know is left blank for
 * Commercial: the customer's PO number and its evidence, rates and the order
 * value, samples, the delivery schedule, special packing, the forwarder and
 * the receiver. Party blocks reduce to their names, which is all the sheet
 * prints.
 */
export function checklistSourceFromDraft(draft: OrderDraft, items: OrderLineData[]): ChecklistSource {
  const nameOf = (p: PartyBlock | null | undefined) => (p && p.name ? { name: p.name } : null);
  return {
    items: items.map((i) => ({
      description: i.description, design: i.design, thickness: i.thickness, sizeLabel: null,
      qtySlabs: i.qtySlabs, qty: i.qty, uom: i.uom, rate: null, amount: null, isSample: false,
    })),
    currency: draft.currency,
    incoterm: draft.incoterm,
    billTo: nameOf(draft.billTo),
    consignee: nameOf(draft.consignee),
    notifyParty: nameOf(draft.notifyParty),
    portOfDischarge: draft.portOfDischarge,
    finalDestination: draft.countryOfDestination,
    paymentTerms: draft.paymentTerms,
    customerContact: draft.customerContact,
  };
}

/** The Prisma `where` for the list. `status` is one status, "OPEN" (NEW +
 *  QUOTED) or nothing; `q` searches number, prospect, subject, contact and
 *  the client's name, case-insensitively. */
export function enquiryListWhere(opts: { status?: string | null; q?: string | null; clientId?: string | null }): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const st = s(opts.status)?.toUpperCase();
  if (st === "OPEN") where.status = { in: [...OPEN_ENQUIRY_STATUSES] };
  else if (isEnquiryStatus(st)) where.status = st;
  const clientId = s(opts.clientId);
  if (clientId) where.clientId = clientId;
  const q = s(opts.q);
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { prospectName: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { client: { is: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

/** Who the enquiry is from, for a list row. */
export function enquiryParty(row: { client?: { name: string } | null; prospectName?: string | null }): string {
  return row.client?.name ?? s(row.prospectName) ?? "—";
}
