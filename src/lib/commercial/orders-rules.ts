// The orders area's decision logic — PURE, import-free, run by
// tests/commercialOrders.test.ts under node --test. The routes under
// /api/office/commercial/orders and the order screens import these rather than
// restating them, so the test exercises what the software does:
//
//   defaultsForKind        what a new EXPORT / DOMESTIC order starts with
//   clientDefaults         what the client master adds on top of that
//   partyFromClient        a printed party block from sales_clients (+ ext)
//   partiesFromClient      bill-to / consignee / notify, preferring the ext blocks
//   normalizeParty         a JSON blob → Party or null
//   itemAmount             qty × rate at 3 dp, unless an amount was typed
//   orderTotals            the ItemsTab footer: slabs, qty by uom, amount, samples
//   changedFields          which header fields an edit actually changed
//   checklistSourceFromOrder  the order + items in the shape prefillChecklist reads
//   ordersWhere            the list filters as a Prisma where
//   renumberLines          lineNo 1..n after a delete
//   canApprove             who may stamp "Approved by"
//   isLiveHold             an ACTIVE hold still inside its expiry window
//   stageFactsOf           what the pipeline gates read off an order row
//   orderWorkspaceView     what the workspace shows when a refresh fails

export type OrderKind = "DOMESTIC" | "EXPORT";
export const ORDER_KINDS: readonly OrderKind[] = ["DOMESTIC", "EXPORT"];
export const PO_EVIDENCE: readonly string[] = ["PO", "PI_ACKNOWLEDGED", "EMAIL"];

/** Same shape as lib/commercial/types Party — restated so this file stays import-free. */
export interface PartyShape {
  name: string;
  lines: string[];
  country?: string | null;
  tel?: string | null;
  email?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  code?: string | null;
}

/** The slice of CommercialSettings these rules read. */
export interface SettingsLike {
  defaults: {
    portOfLoading: string;
    preCarriageBy: string;
    countryOfOrigin: string;
    exportPaymentTerms: string;
    domesticDeliveryTerms: string;
    domesticPaymentTerms: string;
    unitExport: string;
    unitDomestic: string;
  };
  company: { hsnQuartz: string };
}

export interface OrderDefaults {
  currency: string;
  incoterm: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  preCarriageBy: string | null;
  portOfLoading: string | null;
  countryOfOrigin: string;
  countryOfDestination: string | null;
  /** For new line items on this order. */
  uom: string;
  hsn: string;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const orNull = (v: unknown): string | null => { const x = s(v); return x ? x : null; };

/** Header fields that are plain text on commercial_order. */
export const HEADER_TEXT_FIELDS: readonly string[] = [
  "customerPoNumber", "currency", "incoterm", "deliveryTerms", "paymentTerms", "paymentMode",
  "preCarriageBy", "placeOfReceipt", "portOfLoading", "portOfDischarge", "finalDestination",
  "countryOfOrigin", "countryOfDestination", "deliverySchedule", "specialPacking",
  "forwarderDetails", "receiverDetails", "customerContact", "notes",
];
/** Header fields that hold a Party JSON block. */
export const HEADER_PARTY_FIELDS: readonly string[] = ["billTo", "consignee", "notifyParty", "buyerIfNotConsignee"];

/**
 * What a new order starts with, by kind. EXPORT is priced in USD, ships from
 * Chennai by road, and carries the export payment terms from settings (blank
 * today); DOMESTIC is INR, ex-factory, 100% advance, and its destination is
 * the country of origin. Everything here is overridden by anything the client
 * master or the form supplies.
 */
export function defaultsForKind(kind: OrderKind, settings: SettingsLike): OrderDefaults {
  const d = settings.defaults;
  const origin = s(d.countryOfOrigin) || "India";
  if (kind === "DOMESTIC") {
    return {
      currency: "INR",
      incoterm: null,
      deliveryTerms: orNull(d.domesticDeliveryTerms),
      paymentTerms: orNull(d.domesticPaymentTerms),
      preCarriageBy: null,
      portOfLoading: null,
      countryOfOrigin: origin,
      countryOfDestination: origin,
      uom: s(d.unitDomestic) || "SQFT",
      hsn: s(settings.company.hsnQuartz) || "68101990",
    };
  }
  return {
    currency: "USD",
    incoterm: null,
    deliveryTerms: null,
    paymentTerms: orNull(d.exportPaymentTerms),
    preCarriageBy: orNull(d.preCarriageBy),
    portOfLoading: orNull(d.portOfLoading),
    countryOfOrigin: origin,
    countryOfDestination: null,
    uom: s(d.unitExport) || "Square Foot",
    hsn: s(settings.company.hsnQuartz) || "68101990",
  };
}

/** The sales_clients columns these rules read. */
export interface ClientLike {
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
}

/** The commercial_client_ext columns these rules read. */
export interface ClientExtLike {
  customerCode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  billingAddress?: unknown;
  shippingAddress?: unknown;
  notifyParty?: unknown;
  defaultIncoterm?: string | null;
  defaultCurrency?: string | null;
}

/** What the client master says about this customer's usual terms — only the
 *  fields it actually has a value for, so the caller can lay it over the kind
 *  defaults without blanking them. */
export function clientDefaults(client: ClientLike | null | undefined, ext: ClientExtLike | null | undefined): Partial<OrderDefaults> & { portOfDischarge?: string; customerContact?: string } {
  const out: Partial<OrderDefaults> & { portOfDischarge?: string; customerContact?: string } = {};
  const currency = orNull(ext?.defaultCurrency) ?? orNull(client?.defaultCurrency);
  if (currency) out.currency = currency.toUpperCase();
  const incoterm = orNull(ext?.defaultIncoterm);
  if (incoterm) out.incoterm = incoterm;
  const pay = orNull(client?.defaultPaymentTerms);
  if (pay) out.paymentTerms = pay;
  const del = orNull(client?.defaultDeliveryTerms);
  if (del) out.deliveryTerms = del;
  const pod = orNull(client?.defaultPortOfDischarge);
  if (pod) out.portOfDischarge = pod;
  const contact = [orNull(client?.contactPerson), orNull(client?.email), orNull(client?.phone)].filter(Boolean).join(" · ");
  if (contact) out.customerContact = contact;
  return out;
}

/** A free-text address → printed lines. Newlines first; a one-line address is
 *  split on commas (the sales master stores "12 Main St, Springfield, IL"). */
export function splitAddress(address: string | null | undefined): string[] {
  const raw = s(address);
  if (!raw) return [];
  const byLine = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parts = byLine.length > 1 ? byLine : raw.split(",").map((l) => l.trim()).filter(Boolean);
  return parts;
}

/** The party block a client prints as when no address block is on file:
 *  name, address lines (+ city when the address does not already say it),
 *  country, phone, email, GSTIN / state code / customer code from the ext. */
export function partyFromClient(client: ClientLike, ext?: ClientExtLike | null): PartyShape {
  const lines = splitAddress(client.address);
  const city = s(client.city);
  if (city && !lines.some((l) => l.toLowerCase().includes(city.toLowerCase()))) lines.push(city);
  return {
    name: s(client.name),
    lines,
    country: orNull(client.country),
    tel: orNull(client.phone),
    email: orNull(client.email),
    gstin: orNull(ext?.gstin),
    stateCode: orNull(ext?.stateCode),
    code: orNull(ext?.customerCode),
  };
}

/** Anything JSON-shaped → a Party, or null when it names nobody and has no
 *  address. `lines` may arrive as an array or as newline-separated text. */
export function normalizeParty(v: unknown): PartyShape | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const name = s(x.name);
  let lines: string[] = [];
  if (Array.isArray(x.lines)) lines = x.lines.map((l) => s(l)).filter(Boolean);
  else if (typeof x.lines === "string") lines = x.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  else if (typeof x.address === "string") lines = splitAddress(x.address);
  if (!name && lines.length === 0) return null;
  return {
    name,
    lines,
    country: orNull(x.country),
    tel: orNull(x.tel ?? x.phone),
    email: orNull(x.email),
    gstin: orNull(x.gstin),
    stateCode: orNull(x.stateCode),
    code: orNull(x.code ?? x.customerCode),
  };
}

/** Bill-to, consignee and notify party for a new order: the ext's printed
 *  blocks when they name somebody, else the party built from the client row.
 *  The notify party is left null when the ext has none — most orders have no
 *  separate notify party, and an empty block would print as one. */
export function partiesFromClient(client: ClientLike, ext?: ClientExtLike | null): { billTo: PartyShape; consignee: PartyShape; notifyParty: PartyShape | null } {
  const base = partyFromClient(client, ext);
  const billing = normalizeParty(ext?.billingAddress);
  const shipping = normalizeParty(ext?.shippingAddress);
  const notify = normalizeParty(ext?.notifyParty);
  const withIds = (p: PartyShape): PartyShape => ({ ...p, gstin: p.gstin ?? base.gstin, stateCode: p.stateCode ?? base.stateCode, code: p.code ?? base.code, country: p.country ?? base.country });
  const billTo = billing ? withIds(billing) : base;
  const consignee = shipping ? withIds(shipping) : billTo;
  return { billTo, consignee, notifyParty: notify };
}

const round = (n: number, dp: number): number => { const f = 10 ** dp; return Math.round(n * f) / f; };
const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber(): number }).toNumber();
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * The amount on a line. A typed amount stands, at the 3 dp the column keeps:
 * the reference PI's total is not qty × rate at printed precision, and a
 * recompute would print a different figure from the one the customer agreed.
 * Otherwise qty × rate at 3 dp; null when either is unknown.
 */
export function itemAmount(qty: unknown, rate: unknown, typedAmount?: unknown): number | null {
  const typed = asNum(typedAmount);
  if (typed !== null) return round(typed, 3);
  const q = asNum(qty), r = asNum(rate);
  if (q === null || r === null) return null;
  return round(q * r, 3);
}

export interface ItemLike {
  qtySlabs?: number | null;
  qty?: unknown;
  uom?: string | null;
  amount?: unknown;
  isSample?: boolean | null;
}

export interface OrderTotals {
  lines: number;
  goodsLines: number;
  sampleLines: number;
  slabs: number;
  /** e.g. { SQFT: 1200, NOS: 4 } — 3 dp, samples included under their own uom. */
  qtyByUom: Record<string, number>;
  amount: number;
  hasSamples: boolean;
}

/** The ItemsTab footer. Slabs and amounts count every line; a sample line is
 *  flagged, not excluded — the SOP's point 8 asks for the samples. */
export function orderTotals(items: ItemLike[]): OrderTotals {
  const qtyByUom: Record<string, number> = {};
  let slabs = 0, amount = 0, sampleLines = 0;
  for (const it of items) {
    if (it.isSample) sampleLines++;
    slabs += Math.max(0, Math.trunc(asNum(it.qtySlabs) ?? 0));
    const q = asNum(it.qty);
    if (q !== null) {
      const u = s(it.uom) || "—";
      qtyByUom[u] = round((qtyByUom[u] ?? 0) + q, 3);
    }
    amount += asNum(it.amount) ?? 0;
  }
  return {
    lines: items.length,
    goodsLines: items.length - sampleLines,
    sampleLines,
    slabs,
    qtyByUom,
    amount: round(amount, 3),
    hasSamples: sampleLines > 0,
  };
}

/** One comparable form for a stored value and its edited twin: Date and
 *  Decimal become primitives, undefined becomes null, objects are compared by
 *  their sorted-key JSON so two equal party blocks typed in a different key
 *  order do not count as a change. */
function comparable(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return JSON.stringify((v as { toNumber(): number }).toNumber());
  if (typeof v === "string") {
    // an ISO instant and a Date must read the same
    const m = v.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    if (m) return JSON.stringify(new Date(v).toISOString());
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(comparable).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${comparable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The keys of `after` whose value differs from `before`'s — what an "edited"
 *  event names. Keys `after` does not carry are not compared. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(after)) {
    if (comparable(before[k]) !== comparable(after[k])) out.push(k);
  }
  return out;
}

/** Any date-ish value → DD/MM/YYYY, the way the reference documents write a
 *  PO date ("PO-4068622 Dt: 03/07/2026"). Empty when not a date. */
export function fmtDateDMY(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  let y: number, m: number, d: number;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    y = v.getUTCFullYear(); m = v.getUTCMonth() + 1; d = v.getUTCDate();
  } else {
    const mm = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!mm) return "";
    y = Number(mm[1]); m = Number(mm[2]); d = Number(mm[3]);
  }
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** The order-row fields the checklist prefill reads. */
export interface OrderHeaderLike {
  customerPoNumber?: string | null;
  customerPoDate?: unknown;
  poEvidence?: string | null;
  currency?: string | null;
  incoterm?: string | null;
  billTo?: unknown;
  consignee?: unknown;
  notifyParty?: unknown;
  portOfDischarge?: string | null;
  finalDestination?: string | null;
  paymentTerms?: string | null;
  paymentMode?: string | null;
  forwarderDetails?: string | null;
  receiverDetails?: string | null;
  customerContact?: string | null;
  deliverySchedule?: string | null;
  specialPacking?: string | null;
}

export interface ChecklistItemLike {
  description?: string | null; design?: string | null; thickness?: string | null; sizeLabel?: string | null;
  qtySlabs?: number | null; qty?: unknown; uom?: string | null; rate?: unknown; amount?: unknown; isSample?: boolean | null;
}

/** The order and its lines in the shape lib/commercial/checklist
 *  prefillChecklist reads. Decimal columns become numbers; the PO date is
 *  written DD/MM/YYYY; party blocks reduce to their names. */
export function checklistSourceFromOrder(order: OrderHeaderLike, items: ChecklistItemLike[]): Record<string, unknown> {
  const nameOf = (p: unknown): { name: string } | null => { const x = normalizeParty(p); return x && x.name ? { name: x.name } : null; };
  return {
    customerPoNumber: orNull(order.customerPoNumber),
    customerPoDate: fmtDateDMY(order.customerPoDate) || null,
    poEvidence: orNull(order.poEvidence),
    items: items.map((i) => ({
      description: orNull(i.description), design: orNull(i.design), thickness: orNull(i.thickness), sizeLabel: orNull(i.sizeLabel),
      qtySlabs: i.qtySlabs ?? null, qty: asNum(i.qty), uom: orNull(i.uom), rate: asNum(i.rate), amount: asNum(i.amount), isSample: Boolean(i.isSample),
    })),
    currency: orNull(order.currency),
    incoterm: orNull(order.incoterm),
    billTo: nameOf(order.billTo),
    consignee: nameOf(order.consignee),
    notifyParty: nameOf(order.notifyParty),
    portOfDischarge: orNull(order.portOfDischarge),
    finalDestination: orNull(order.finalDestination),
    paymentTerms: orNull(order.paymentTerms),
    paymentMode: orNull(order.paymentMode),
    forwarderDetails: orNull(order.forwarderDetails),
    receiverDetails: orNull(order.receiverDetails),
    customerContact: orNull(order.customerContact),
    deliverySchedule: orNull(order.deliverySchedule),
    specialPacking: orNull(order.specialPacking),
  };
}

export interface OrdersFilter {
  status?: string | null;
  kind?: string | null;
  clientId?: string | null;
  q?: string | null;
}

/** The orders list filter as a Prisma where. `status` may be one stage or a
 *  comma list; `q` matches the order number, the customer's PO number or the
 *  client's name, case-insensitively. Unknown kinds are ignored rather than
 *  sent to Postgres as an invalid enum. */
export function ordersWhere(f: OrdersFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const statuses = s(f.status).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (statuses.length === 1) where.status = statuses[0];
  else if (statuses.length > 1) where.status = { in: statuses };
  const kind = s(f.kind).toUpperCase();
  if (ORDER_KINDS.includes(kind as OrderKind)) where.kind = kind;
  const clientId = s(f.clientId);
  if (clientId) where.clientId = clientId;
  const q = s(f.q);
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { customerPoNumber: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

/** Page arithmetic for every list: page ≥ 1, limit 1..500, default 1 / 50. */
export function pageArgs(page: unknown, limit: unknown): { page: number; limit: number; skip: number; take: number } {
  const p = Math.max(1, Math.trunc(asNum(page) ?? 1));
  const l = Math.min(500, Math.max(1, Math.trunc(asNum(limit) ?? 50)));
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}

/** The next line number: one past the highest, 1 on an empty order. */
export function nextLineNo(items: Array<{ lineNo: number }>): number {
  return items.reduce((m, i) => Math.max(m, i.lineNo), 0) + 1;
}

/** After a delete, lines are 1..n in their existing order. Returns only the
 *  rows whose number changes, so the route writes the minimum. */
export function renumberLines<T extends { id: string; lineNo: number }>(items: T[]): Array<{ id: string; lineNo: number }> {
  const sorted = [...items].sort((a, b) => a.lineNo - b.lineNo);
  const out: Array<{ id: string; lineNo: number }> = [];
  sorted.forEach((it, i) => { if (it.lineNo !== i + 1) out.push({ id: it.id, lineNo: i + 1 }); });
  return out;
}

/** Who may stamp "Approved by" on the checklist. Owner, 2026-09-07 (answer
 *  10): "approved by Murali" — the Commercial Manager. Commercial prepares,
 *  the manager or an admin approves, the dispatch checker never. The same
 *  line as COMMERCIAL_ACTORS.approve in access-rules.ts, restated on the
 *  actor string so the workspace can ask without the user object. */
export function canApprove(actor: string | null | undefined): boolean {
  return actor === "ADMIN" || actor === "COMMERCIAL_MANAGER";
}

// ───────────────────────────── the pipeline's facts ──────────────────────────

/** The order fields the three stage gates read (answers 1, 2, 10). Holds and
 *  receipts may arrive as the full lists the detail carries or as the one-row
 *  probes order-stage loads; `advanceReceived` may already be derived. */
export interface StageFactSource {
  stockCheckedAt?: unknown;
  approvedAt?: unknown;
  /** `expiresAt` (Date or ISO string) is read when present; a probe that did
   *  not select it has already filtered on it server-side. */
  holds?: ReadonlyArray<{ status: string; expiresAt?: unknown }> | null;
  receipts?: ReadonlyArray<{ kind: string }> | null;
  advanceReceived?: boolean | null;
}

/**
 * Whether a hold row is a LIVE stock check at `now`: ACTIVE and not past its
 * expiry. The inventory sweep (reconcileHold) is what stamps EXPIRED, and it
 * runs later than the lapse — so a row that still says ACTIVE with an
 * expiresAt in the past is slabs nobody is holding any more, and must not let
 * the PI through (answers 1, 11). A missing expiresAt is trusted (the server
 * probe selected only rows still inside their window); an unreadable one is
 * not — a hold whose expiry cannot be read is not proof of anything.
 */
export function isLiveHold(h: { status: string; expiresAt?: unknown }, now: Date): boolean {
  if (h.status !== "ACTIVE") return false;
  if (h.expiresAt === undefined || h.expiresAt === null) return true;
  const t = h.expiresAt instanceof Date ? h.expiresAt.getTime() : new Date(String(h.expiresAt)).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

export interface StageFactsShape {
  stockChecked: boolean;
  approved: boolean;
  advanceReceived: boolean;
}

/**
 * What an order has actually done, for stages.canEnter. Every fact is a
 * definite boolean — canEnter only refuses on an explicit `false`, so an
 * `undefined` here would let the PI, the invoice or the truck through
 * ungated, which is the failure this exists to prevent.
 *
 *   stockChecked     stockCheckedAt is stamped AND a hold is still live —
 *                    ACTIVE and inside its expiry window at `now`: a lapsed
 *                    hold sends the order back to the stock check (answer
 *                    11), so the stamp alone is history, not a fact
 *   approved         approvedAt is stamped (answer 10)
 *   advanceReceived  an ADVANCE receipt exists (answers 2, 29)
 */
export function stageFactsOf(o: StageFactSource, now: Date = new Date()): StageFactsShape {
  const activeHold = Boolean(o.holds?.some((h) => isLiveHold(h, now)));
  const advance = typeof o.advanceReceived === "boolean" ? o.advanceReceived : Boolean(o.receipts?.some((r) => r.kind === "ADVANCE"));
  return {
    stockChecked: o.stockCheckedAt != null && o.stockCheckedAt !== "" && activeHold,
    approved: o.approvedAt != null && o.approvedAt !== "",
    advanceReceived: advance,
  };
}

// ───────────────────────── the workspace's own state ─────────────────────────

/** What OrderWorkspace holds: the last order that loaded (null until one has)
 *  and the message from the last read that failed (null when the last read
 *  worked). */
export interface WorkspaceState {
  order: unknown;
  error?: string | null;
}

export interface WorkspaceView {
  /** Render the header, the stage strip and the open tab. */
  showWorkspace: boolean;
  /** The page is nothing but this message — only when no order has ever loaded. */
  fatal: string | null;
  /** A banner ABOVE a workspace that is still showing the last good order. */
  stale: string | null;
  /** Nothing to show and nothing wrong yet: the first read is in flight. */
  loading: boolean;
}

/**
 * What the order workspace renders for a given state.
 *
 * The rule that matters: ONCE AN ORDER HAS LOADED, A FAILED READ NEVER TAKES
 * THE SCREEN AWAY. A refresh runs after every write and whenever a tab asks
 * for one, so a 500, a dropped connection or a lapsed session would otherwise
 * unmount the open tab and throw away whatever the user had typed into it
 * (the PI tab's draft edit, the items tab's half-finished line). The failure
 * is shown as a banner over the last good order instead, and the tab — with
 * its own state — stays mounted. Only a first read that never landed leaves
 * nothing to show, and that is the one case the message owns the page.
 */
export function orderWorkspaceView(state: WorkspaceState): WorkspaceView {
  const error = orNull(state.error);
  if (state.order) return { showWorkspace: true, fatal: null, stale: error, loading: false };
  return { showWorkspace: false, fatal: error, stale: null, loading: error === null };
}

/** A one-line description of a line item for the order log. */
export function describeItem(it: { lineNo?: number | null; design?: string | null; description?: string | null; thickness?: string | null; qtySlabs?: number | null; qty?: unknown; uom?: string | null; isSample?: boolean | null }): string {
  const what = s(it.description) || [s(it.design), s(it.thickness)].filter(Boolean).join(" ") || "line";
  const qty = it.qtySlabs ? `${it.qtySlabs} slabs` : asNum(it.qty) !== null ? `${asNum(it.qty)} ${s(it.uom)}`.trim() : "";
  return `${it.lineNo ? `Line ${it.lineNo}: ` : ""}${what}${qty ? ` × ${qty}` : ""}${it.isSample ? " (sample)" : ""}`;
}
