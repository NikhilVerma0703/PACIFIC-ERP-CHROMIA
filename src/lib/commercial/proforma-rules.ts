// Proforma invoice rules — PURE. Everything the PI routes and the PI PDF have
// to DECIDE lives here so tests/commercialProforma.test.ts can run it without
// Next, Prisma or a session: how an order becomes a snapshot, how an order
// line becomes a printed line, how a draft edit re-derives the totals, which
// status may move where, and how every number and date is printed.
//
// Imports only sibling pure modules (words, thickness, settings-defaults types)
// by relative path with the .ts extension, the way access-rules imports
// roles.ts, so `node --test` can load it directly.
//
// The reference is the 1404 PI (Surfaces by Pacific, 10-07-2026): its line
// prints "VGWT10301A-Polish-Super Jumbo-30mm-Premium" as the item code,
// "CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium" as the description, 30mm,
// 43 slabs, HSN 68101990, Square Foot, 3208.273 × 5.4 = 17324.657 (which is
// NOT qty × rate at printed precision — 3208.273 × 5.4 = 17324.674 — so the
// stored amount is printed, never recomputed).
import { amountInWords, inrWords } from "./words.ts";
import { canonThickness } from "../thickness.ts";
import type { CommercialSettings } from "./settings-defaults.ts";
import type { DocLine, Party, ProformaSnapshot } from "./types.ts";

// ───────────────────────────── inputs ────────────────────────────────────────

/** The slice of an order line the snapshot needs (OrderItemDto is a superset). */
export interface SnapshotItemInput {
  lineNo?: number | null;
  design?: string | null;
  customerSku?: string | null;
  description?: string | null;
  thickness?: string | null;
  finish?: string | null;
  sizeLabel?: string | null;
  gradeLabel?: string | null;
  qtySlabs?: number | null;
  qty?: number | string | null;
  uom?: string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  hsn?: string | null;
  isSample?: boolean | null;
}

/** The slice of the client the fallbacks need (ClientDto is a superset). */
export interface SnapshotClientInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  commercialExt?: {
    customerCode?: string | null;
    gstin?: string | null;
    stateCode?: string | null;
    shippingAddress?: Party | null;
    billingAddress?: Party | null;
    notifyParty?: Party | null;
  } | null;
}

/** The slice of an order the snapshot reads (OrderDetail is a superset). */
export interface SnapshotOrderInput {
  number: string;
  kind: "DOMESTIC" | "EXPORT" | string;
  currency?: string | null;
  customerPoNumber?: string | null;
  incoterm?: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  billTo?: Party | null;
  consignee?: Party | null;
  notifyParty?: Party | null;
  buyerIfNotConsignee?: Party | null;
  preCarriageBy?: string | null;
  placeOfReceipt?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  finalDestination?: string | null;
  countryOfOrigin?: string | null;
  countryOfDestination?: string | null;
  client?: SnapshotClientInput | null;
  items?: SnapshotItemInput[] | null;
}

export interface SnapshotOptions {
  revision: number;
  /** YYYY-MM-DD; the PI's printed date. */
  date: string;
  validUntil?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
}

// ───────────────────────────── small helpers ─────────────────────────────────

/** Blank-safe text: null, undefined, "None" and whitespace print as "". */
export function printable(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s || s === "None" || s === "null" || s === "undefined") return "";
  return s;
}

function clean(v: unknown): string | null {
  const s = printable(v);
  return s ? s : null;
}

function toNumber(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** Paise precision — what an INR total is money at. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isParty(v: unknown): v is Party {
  return typeof v === "object" && v !== null && typeof (v as Party).name === "string";
}

function partyOrNull(v: unknown): Party | null {
  if (!isParty(v)) return null;
  const lines = Array.isArray(v.lines) ? v.lines.map((l) => printable(l)).filter(Boolean) : [];
  const name = printable(v.name);
  if (!name && lines.length === 0) return null;
  return {
    name,
    lines,
    country: clean(v.country),
    tel: clean(v.tel),
    email: clean(v.email),
    gstin: clean(v.gstin),
    stateCode: clean(v.stateCode),
    code: clean(v.code),
  };
}

// ───────────────────────────── printing rules ────────────────────────────────

/**
 * How a thickness prints on the PI. Stored canonical ('3 cm', '2 cm',
 * '1.2 cm', '7 mm' — lib/thickness canonThickness); an export PI prints
 * millimetres the way the reference does ("30mm"), a domestic one the
 * DTA style ("3 CM"). Unknown spellings pass through untouched; blank → null.
 */
export function printThickness(raw: string | null | undefined, kind: string): string | null {
  const canon = canonThickness(raw);
  if (!canon) return null;
  const m = canon.match(/^(\d+(?:\.\d+)?)\s*(cm|mm)$/i);
  if (!m) return canon;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (kind === "EXPORT") {
    const mm = unit === "cm" ? n * 10 : n;
    return `${trimNumber(mm)}mm`;
  }
  return `${trimNumber(n)} ${unit.toUpperCase()}`;
}

/** The printed unit for a UOM code. */
export function unitLabel(uom: string | null | undefined, kind: string, settings: CommercialSettings): string {
  const u = printable(uom).toUpperCase();
  if (u === "SQFT" || u === "SQ FT" || u === "SQUARE FOOT") return kind === "EXPORT" ? settings.defaults.unitExport : settings.defaults.unitDomestic;
  if (u === "SQMT" || u === "SQM" || u === "SQUARE METRE" || u === "SQUARE METER") return "Square Metre";
  if (u === "NOS" || u === "NO" || u === "PCS") return "Nos";
  return printable(uom);
}

/** "5.4" stays "5.4", "55.9728" stays "55.9728", 5 prints "5": the rate as typed. */
export function trimNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  // toFixed(4) then strip trailing zeros: rates are stored at 4 dp.
  return n.toFixed(4).replace(/\.?0+$/, "");
}

export function fmtQty(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : n.toFixed(3);
}
export function fmtAmount(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : n.toFixed(3);
}
export function fmtRate(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : trimNumber(n);
}
export function fmtSlabs(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : String(Math.round(n));
}

/** YYYY-MM-DD (or an ISO timestamp) → DD-MM-YYYY, the PI's date style. Blank in → "". */
export function formatPiDate(v: string | null | undefined): string {
  const s = printable(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** A Date → YYYY-MM-DD in UTC (the @db.Date convention of dateOnly()). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The PI's validity: issue day + settings.piValidityDays, as YYYY-MM-DD. */
export function validUntilFor(issuedAt: Date, validityDays: number): string {
  const d = new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(validityDays)));
  return isoDate(d);
}

/** "SAL-ORD/26-27/01642" R0 → "SAL-ORD-26-27-01642-R0.pdf" (a slash cannot be a filename). */
export function piFilename(number: string, revision: number): string {
  const safe = printable(number).replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "proforma";
  return `${safe}-R${Math.max(0, Math.round(revision))}.pdf`;
}

/** "SAL-ORD/26-27/01642-R1" — how a revision is named on screen and in the log. */
export function piLabel(number: string, revision: number): string {
  return `${number}-R${revision}`;
}

// ───────────────────────────── lines ─────────────────────────────────────────

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((p) => printable(p)).filter(Boolean).join("-");
}

/**
 * The printed item code. The customer's SKU on its own when that is all the
 * line has; composed "<SKU>-<finish>-<size>-<thickness>-<grade>" when the line
 * carries any of finish / size / grade (the reference's
 * "VGWT10301A-Polish-Super Jumbo-30mm-Premium"). No SKU → null.
 */
export function buildItemCode(item: SnapshotItemInput, kind: string): string | null {
  const sku = clean(item.customerSku);
  if (!sku) return null;
  const hasParts = Boolean(clean(item.finish) || clean(item.sizeLabel) || clean(item.gradeLabel));
  if (!hasParts) return sku;
  return joinParts([sku, item.finish, item.sizeLabel, printThickness(item.thickness, kind), item.gradeLabel]);
}

/**
 * The printed description: what was typed, else composed from the design
 * (upper case) and the same parts — "CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium".
 */
export function buildDescription(item: SnapshotItemInput, kind: string): string {
  const typed = clean(item.description);
  if (typed) return typed;
  const design = clean(item.design)?.toUpperCase() ?? null;
  return joinParts([design, item.finish, item.sizeLabel, printThickness(item.thickness, kind), item.gradeLabel]);
}

/** One order line → one printed line. Amount is the STORED amount, never qty × rate. */
export function buildLine(item: SnapshotItemInput, index: number, kind: string, settings: CommercialSettings): DocLine {
  const qty = round3(toNumber(item.qty, 0));
  const rate = toNumber(item.rate, 0);
  const amount = round3(toNumber(item.amount, 0));
  const slabs = item.qtySlabs === null || item.qtySlabs === undefined ? null : Math.round(toNumber(item.qtySlabs, 0));
  return {
    lineNo: item.lineNo ?? index + 1,
    itemCode: buildItemCode(item, kind),
    description: buildDescription(item, kind),
    design: clean(item.design),
    thickness: printThickness(item.thickness, kind),
    slabs,
    hsn: clean(item.hsn) ?? settings.company.hsnQuartz,
    unit: unitLabel(item.uom, kind, settings),
    qty,
    rate,
    amount,
    isSample: Boolean(item.isSample),
  };
}

/** Coerce a client-supplied line (a PATCHed snapshot) back into a DocLine. */
export function sanitiseLine(raw: unknown, index: number): DocLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as Record<string, unknown>;
  const slabs = l.slabs === null || l.slabs === undefined || l.slabs === "" ? null : Math.round(toNumber(l.slabs, 0));
  return {
    lineNo: Number.isFinite(Number(l.lineNo)) && Number(l.lineNo) > 0 ? Math.round(Number(l.lineNo)) : index + 1,
    itemCode: clean(l.itemCode),
    description: printable(l.description),
    design: clean(l.design),
    thickness: clean(l.thickness),
    slabs,
    hsn: printable(l.hsn),
    unit: printable(l.unit),
    qty: round3(toNumber(l.qty, 0)),
    rate: toNumber(l.rate, 0),
    amount: round3(toNumber(l.amount, 0)),
    isSample: Boolean(l.isSample),
  };
}

// ───────────────────────────── totals ────────────────────────────────────────

/**
 * The words under the total. A PI states its total twice — in figures and in
 * words — and the two must be ONE number.
 *
 * `amountInWords` writes INR in whole rupees (the DTA invoice's style, where
 * the figure is rounded to rupees too). On a PI the figure prints at 3 dp, so
 * whole-rupee words both lose the paise and can round ABOVE the printed
 * figure: "INR 138686.750" over "…Eighty Seven Rupees Only". The PI therefore
 * names the paise. A foreign currency already names its minor unit.
 */
export function piAmountInWords(amount: number, currency: string): string {
  const cur = printable(currency).toUpperCase() || "USD";
  return cur === "INR" ? inrWords(amount, { withPaise: true }) : amountInWords(amount, cur);
}

/**
 * Σ slabs (samples included — the reference's Total row says 68 = 43 + 25),
 * Σ stored amounts less the discount, and the words for that total.
 * An INR total is money at paise precision (2 dp) so that the printed figure
 * and the words that name its paise are the same number; every other currency
 * keeps the document's 3 dp. Returns a NEW snapshot; the input is not touched.
 */
export function recomputeTotals(s: ProformaSnapshot): ProformaSnapshot {
  const totalSlabs = s.lines.reduce((a, l) => a + (l.slabs ?? 0), 0);
  const gross = s.lines.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  const discount = Number.isFinite(s.discount) ? s.discount : 0;
  const currency = printable(s.currency).toUpperCase() || "USD";
  const totalAmount = currency === "INR" ? round2(gross - discount) : round3(gross - discount);
  return { ...s, totalSlabs, totalAmount, amountInWords: piAmountInWords(totalAmount, currency) };
}

// ───────────────────────────── parties ───────────────────────────────────────

/** The client master as a Party — the fallback when the order names no consignee. */
export function clientParty(client: SnapshotClientInput | null | undefined): Party | null {
  if (!client) return null;
  const name = printable(client.name);
  const cityCountry = [printable(client.city), printable(client.country)].filter(Boolean).join(", ");
  const lines = [printable(client.address), cityCountry].filter(Boolean);
  if (!name && lines.length === 0) return null;
  return {
    name,
    lines,
    country: clean(client.country),
    tel: clean(client.phone),
    email: clean(client.email),
    gstin: clean(client.commercialExt?.gstin),
    stateCode: clean(client.commercialExt?.stateCode),
    code: clean(client.commercialExt?.customerCode),
  };
}

/**
 * Which bank prints on a proforma. OPEN-QUESTIONS §23: ICICI is the DTA
 * invoice's account; the PI, the export documents and the delivery challan
 * carry Kotak (it is the account on the reference PI and the reference
 * challan). A proforma is a PI whatever its kind, so a DOMESTIC one prints
 * Kotak too: the PI is what an advance is paid against, and the owner has
 * said which account that is. Only the DTA invoice keeps ICICI
 * (invoice-rules picks its own bank by kind).
 */
export function piBank(settings: CommercialSettings): CommercialSettings["banks"]["export"] {
  return settings.banks.export;
}

export function exporterParty(settings: CommercialSettings): Party {
  const c = settings.company;
  return {
    name: c.legalName,
    lines: [...c.addressLines],
    country: settings.defaults.countryOfOrigin || "India",
    tel: c.phone || null,
    email: c.email || null,
    gstin: c.gstin || null,
    stateCode: c.stateCode || null,
    code: null,
  };
}

function sameParty(a: Party | null, b: Party | null): boolean {
  if (!a || !b) return false;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

// ───────────────────────────── the snapshot ──────────────────────────────────

/**
 * Freeze an order into what the PI prints. Bank: Kotak on both kinds
 * (piBank — OPEN-QUESTIONS §23). Consignee: the order's, else the client's shipping address,
 * else the client master. Notify: the order's, else the client's. Buyer if not
 * consignee: the order's, else bill-to when it is a different party.
 */
export function buildProformaSnapshot(order: SnapshotOrderInput, settings: CommercialSettings, opts: SnapshotOptions): ProformaSnapshot {
  const kind: "DOMESTIC" | "EXPORT" = order.kind === "DOMESTIC" ? "DOMESTIC" : "EXPORT";
  const isExport = kind === "EXPORT";
  const currency = (printable(order.currency) || (isExport ? "USD" : "INR")).toUpperCase();
  const client = order.client ?? null;
  const ext = client?.commercialExt ?? null;

  const fromClient = clientParty(client);
  const consignee = partyOrNull(order.consignee) ?? partyOrNull(ext?.shippingAddress) ?? fromClient ?? { name: "", lines: [] };
  const notifyParty = partyOrNull(order.notifyParty) ?? partyOrNull(ext?.notifyParty) ?? null;
  const billTo = partyOrNull(order.billTo) ?? partyOrNull(ext?.billingAddress) ?? null;
  const buyerIfNotConsignee = partyOrNull(order.buyerIfNotConsignee) ?? (billTo && !sameParty(billTo, consignee) ? billTo : null);

  const lines = (order.items ?? []).map((it, i) => buildLine(it, i, kind, settings));
  const bank = piBank(settings);

  const base: ProformaSnapshot = {
    number: order.number,
    revision: Math.max(0, Math.round(opts.revision)),
    date: opts.date,
    deliveryDate: clean(opts.deliveryDate),
    validUntil: clean(opts.validUntil),
    kind,
    currency,
    buyerPoNo: clean(order.customerPoNumber),
    exporter: exporterParty(settings),
    consignee,
    notifyParty,
    buyerIfNotConsignee,
    countryOfOrigin: printable(order.countryOfOrigin) || settings.defaults.countryOfOrigin || "India",
    countryOfDestination: clean(order.countryOfDestination) ?? consignee.country ?? clean(client?.country) ?? (isExport ? null : "India"),
    deliveryTerms: clean(order.deliveryTerms) ?? clean(order.incoterm) ?? (isExport ? null : clean(settings.defaults.domesticDeliveryTerms)),
    paymentTerms: clean(order.paymentTerms) ?? (isExport ? clean(settings.defaults.exportPaymentTerms) : clean(settings.defaults.domesticPaymentTerms)),
    preCarriageBy: clean(order.preCarriageBy) ?? (isExport ? clean(settings.defaults.preCarriageBy) : null),
    placeOfReceipt: clean(order.placeOfReceipt),
    vessel: null,
    portOfLoading: clean(order.portOfLoading) ?? (isExport ? clean(settings.defaults.portOfLoading) : null),
    portOfDischarge: clean(order.portOfDischarge),
    finalDestination: clean(order.finalDestination),
    lines,
    totalSlabs: 0,
    totalAmount: 0,
    amountInWords: "",
    grossWeight: null,
    netWeight: null,
    discount: 0,
    bank: {
      name: bank.name,
      address: bank.address,
      accountNo: bank.accountNo,
      ifsc: bank.ifsc,
      swift: bank.swift,
      adCode: bank.adCode,
      routingBank: bank.routingBank,
      routingSwift: bank.routingSwift,
    },
    company: {
      legalName: settings.company.legalName,
      addressLines: [...settings.company.addressLines],
      gstin: settings.company.gstin,
      rbiCode: settings.company.rbiCode,
      customsOffice: settings.company.customsOffice,
    },
    declaration: settings.texts.piDeclaration,
    notes: clean(opts.notes),
  };
  return recomputeTotals(base);
}

// ───────────────────────────── draft edits ───────────────────────────────────

/** Snapshot fields a DRAFT may have edited from the PI tab. */
export const EDITABLE_TEXT_FIELDS = [
  "date", "deliveryDate", "buyerPoNo", "deliveryTerms", "paymentTerms", "preCarriageBy", "placeOfReceipt",
  "vessel", "portOfLoading", "portOfDischarge", "finalDestination", "countryOfOrigin", "countryOfDestination",
  "grossWeight", "netWeight", "notes",
] as const;
export const EDITABLE_PARTY_FIELDS = ["consignee", "notifyParty", "buyerIfNotConsignee"] as const;

/**
 * Apply a PATCH body to a draft snapshot: only the fields above, `discount`
 * (a number, never negative) and `lines` (a full replacement array). Anything
 * else — number, revision, bank, company, totals — is ignored, and the totals
 * and the words are re-derived when lines or discount change. Returns a NEW
 * snapshot and whether anything changed.
 */
export function applyDraftPatch(snapshot: ProformaSnapshot, patch: unknown): { snapshot: ProformaSnapshot; changed: boolean } {
  if (typeof patch !== "object" || patch === null) return { snapshot, changed: false };
  const p = patch as Record<string, unknown>;
  const next: ProformaSnapshot = { ...snapshot };
  let changed = false;
  let totalsDirty = false;

  for (const f of EDITABLE_TEXT_FIELDS) {
    if (!(f in p)) continue;
    const v = f === "countryOfOrigin" ? (printable(p[f]) || snapshot.countryOfOrigin) : f === "date" ? (clean(p[f]) ?? snapshot.date) : clean(p[f]);
    if (f === "date" && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) continue;
    if (f === "deliveryDate" && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) continue;
    if ((next as unknown as Record<string, unknown>)[f] !== v) { (next as unknown as Record<string, unknown>)[f] = v; changed = true; }
  }
  for (const f of EDITABLE_PARTY_FIELDS) {
    if (!(f in p)) continue;
    const v = partyOrNull(p[f]);
    if (f === "consignee" && !v) continue;              // a PI must name a consignee; an empty one is ignored
    if (JSON.stringify(next[f]) !== JSON.stringify(v)) { (next as unknown as Record<string, unknown>)[f] = v; changed = true; }
  }
  if ("discount" in p) {
    const d = Math.max(0, round3(toNumber(p.discount, 0)));
    if (d !== snapshot.discount) { next.discount = d; changed = true; totalsDirty = true; }
  }
  if ("lines" in p && Array.isArray(p.lines)) {
    const lines = (p.lines as unknown[]).map((l, i) => sanitiseLine(l, i)).filter((l): l is DocLine => l !== null);
    if (JSON.stringify(lines) !== JSON.stringify(snapshot.lines)) { next.lines = lines; changed = true; totalsDirty = true; }
  }
  return { snapshot: totalsDirty ? recomputeTotals(next) : next, changed };
}

// ───────────────────────────── revisions & status ────────────────────────────

export type ProformaStatus = "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "CANCELLED";

/** The next revision for a number: max existing + 1, or 0 for the first. */
export function nextRevision(existing: Array<{ revision: number }> | number[]): number {
  let max = -1;
  for (const e of existing) {
    const r = typeof e === "number" ? e : e.revision;
    if (Number.isFinite(r) && r > max) max = r;
  }
  return max + 1;
}

export function canEditDraft(status: string): boolean { return status === "DRAFT"; }
export function canIssue(status: string): boolean { return status === "DRAFT"; }
export function canAccept(status: string): boolean { return status === "ISSUED"; }
export function canCancel(status: string): boolean { return status === "DRAFT" || status === "ISSUED" || status === "ACCEPTED"; }

/** Why a transition is refused, or null when it may go ahead. */
export function refuseIssue(pi: { status: string; snapshot: { lines: unknown[] } | null | undefined }): string | null {
  if (!canIssue(pi.status)) return `Only a draft can be issued (this revision is ${pi.status.toLowerCase()})`;
  if (!pi.snapshot || !Array.isArray(pi.snapshot.lines) || pi.snapshot.lines.length === 0) return "The PI has no lines — add items to the order and rebuild the draft";
  return null;
}

/**
 * Issuing a revision supersedes every OTHER issued (or accepted) revision of
 * the same number: the customer holds one live PI at a time. Drafts and
 * cancelled ones are left alone.
 */
export function supersededIds(all: Array<{ id: string; number: string; status: string }>, issuing: { id: string; number: string }): string[] {
  return all
    .filter((p) => p.id !== issuing.id && p.number === issuing.number && (p.status === "ISSUED" || p.status === "ACCEPTED"))
    .map((p) => p.id);
}

/** Badge tone per status, shared by the tab and any list. */
export function statusTone(status: string): "brand" | "green" | "amber" | "red" {
  switch (status) {
    case "ISSUED": return "brand";
    case "ACCEPTED": return "green";
    case "DRAFT": return "amber";
    default: return "red";
  }
}

/** ?page=&limit= for the PI register; 1 / 50 by default, 200 the ceiling. */
export function pageArgs(pageRaw: unknown, limitRaw: unknown): { page: number; limit: number; skip: number } {
  const p = Math.max(1, Math.round(Number(pageRaw)) || 1);
  const l = Math.min(200, Math.max(1, Math.round(Number(limitRaw)) || 50));
  return { page: p, limit: l, skip: (p - 1) * l };
}

/** Statuses a register filter may name; anything else is ignored (no filter). */
export const PROFORMA_STATUSES: ProformaStatus[] = ["DRAFT", "ISSUED", "ACCEPTED", "SUPERSEDED", "CANCELLED"];
export function parseProformaStatus(raw: unknown): ProformaStatus | null {
  const s = printable(raw).toUpperCase();
  return (PROFORMA_STATUSES as string[]).includes(s) ? (s as ProformaStatus) : null;
}

// ─────────────────────── what the PDF actually prints ────────────────────────
// The layout lives in lib/commercial/pdf/proforma.ts, but every STRING it puts
// in a cell is decided here, so tests/commercialProforma.test.ts can assert the
// printed document without rendering one: blank stays blank (never "None"),
// dates are DD-MM-YYYY, quantities and amounts 3 dp, the rate as typed.

/** A party as printed: the bold name, then address lines, then what it carries. */
export function partyBlock(p: Party | null | undefined): { name: string; lines: string[] } {
  if (!p) return { name: "", lines: [] };
  const lines = (Array.isArray(p.lines) ? p.lines : []).map((l) => printable(l)).filter(Boolean);
  const country = printable(p.country);
  if (country && !lines.some((l) => l.toUpperCase().includes(country.toUpperCase()))) lines.push(country);
  const tel = printable(p.tel);
  if (tel) lines.push(`Tel: ${tel}`);
  const email = printable(p.email);
  if (email) lines.push(`Email: ${email}`);
  const gstin = printable(p.gstin);
  if (gstin) lines.push(`GSTIN: ${gstin}`);
  return { name: printable(p.name), lines };
}

/** The printed invoice number: the order number, with -R1 / -R2 on a revision
 *  (OPEN-QUESTIONS §24 default — a revision keeps the number with a suffix). */
export function printedNumber(number: string, revision: number): string {
  const n = printable(number);
  return revision > 0 ? `${n}-R${Math.round(revision)}` : n;
}

/** The item table's header: one row of labels, three of them stacked under
 *  "Description of goods" as the reference's second header row. */
export function piTableHeader(currency: string): { top: string[]; sub: string[] } {
  const cur = printable(currency).toUpperCase() || "USD";
  return {
    top: ["Item Code", "Description of goods", "", "", "HSN/SAC", "Unit", "Quantity", `Rate In ${cur} unit`, `Total Amount in ${cur}`],
    sub: ["Color", "Thick", "No of Slabs"],
  };
}

/** One printed row: 9 cells, in the header's order. */
export function piRow(line: DocLine): string[] {
  return [
    printable(line.itemCode),
    printable(line.description),
    printable(line.thickness),
    fmtSlabs(line.slabs),
    printable(line.hsn),
    printable(line.unit),
    fmtQty(line.qty),
    fmtRate(line.rate),
    fmtAmount(line.amount),
  ];
}

/** The Total row: the slab count and the amount, everything else blank. */
export function piTotalRow(s: ProformaSnapshot): string[] {
  return ["", "Total", "", fmtSlabs(s.totalSlabs), "", "", "", "", fmtAmount(s.totalAmount)];
}

export interface PiPrintFields {
  title: string;
  invoiceNo: string;
  invoiceDate: string;
  buyerPoNo: string;
  deliveryDate: string;
  validUntil: string;
  rbiCode: string;
  gstin: string;
  customsOffice: string;
  countryOfOrigin: string;
  countryOfDestination: string;
  termsAndConditions: string;
  deliveryTerms: string;
  paymentTerms: string;
  preCarriageBy: string;
  placeOfReceipt: string;
  vessel: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  bankName: string;
  bankAddress: string;
  adCode: string;
  accountNo: string;
  ifsc: string;
  swift: string;
  routingBank: string;
  routingSwift: string;
  grossWeight: string;
  netWeight: string;
  discount: string;
  totalAmount: string;
  totalSlabs: string;
  amountInWords: string;
  declaration: string;
  currency: string;
}

/** Every scalar the PI prints, already formatted. A blank field is "" — the PI
 *  is a customer-facing document and must never show "None" or "null". */
export function piPrintFields(s: ProformaSnapshot): PiPrintFields {
  return {
    title: "PROFORMA INVOICE",
    invoiceNo: printedNumber(s.number, s.revision),
    invoiceDate: formatPiDate(s.date),
    buyerPoNo: printable(s.buyerPoNo),
    deliveryDate: formatPiDate(s.deliveryDate),
    validUntil: formatPiDate(s.validUntil),
    rbiCode: printable(s.company.rbiCode),
    gstin: printable(s.company.gstin),
    customsOffice: printable(s.company.customsOffice).toUpperCase(),
    countryOfOrigin: printable(s.countryOfOrigin),
    countryOfDestination: printable(s.countryOfDestination),
    termsAndConditions: printable(s.notes),
    deliveryTerms: printable(s.deliveryTerms),
    paymentTerms: printable(s.paymentTerms),
    preCarriageBy: printable(s.preCarriageBy),
    placeOfReceipt: printable(s.placeOfReceipt),
    vessel: printable(s.vessel),
    portOfLoading: printable(s.portOfLoading),
    portOfDischarge: printable(s.portOfDischarge),
    finalDestination: printable(s.finalDestination),
    bankName: printable(s.bank.name),
    bankAddress: printable(s.bank.address),
    adCode: printable(s.bank.adCode),
    accountNo: printable(s.bank.accountNo),
    ifsc: printable(s.bank.ifsc),
    swift: printable(s.bank.swift),
    routingBank: printable(s.bank.routingBank),
    routingSwift: printable(s.bank.routingSwift),
    grossWeight: printable(s.grossWeight),
    netWeight: printable(s.netWeight),
    discount: s.discount ? fmtAmount(s.discount) : "",
    totalAmount: fmtAmount(s.totalAmount),
    totalSlabs: fmtSlabs(s.totalSlabs),
    amountInWords: printable(s.amountInWords),
    declaration: printable(s.declaration),
    currency: printable(s.currency).toUpperCase(),
  };
}

/** What the PI tab warns about before anyone issues: an empty PI, or one with
 *  nobody to ship to. Both are printable, so this is a warning, not a block —
 *  except an empty PI, which refuseIssue turns into a 400. */
export function orderWarnings(order: { items?: unknown[] | null; consignee?: Party | null; client?: SnapshotClientInput | null }): string[] {
  const out: string[] = [];
  if (!Array.isArray(order.items) || order.items.length === 0) out.push("This order has no items — a PI built now would print an empty table.");
  const consignee = partyOrNull(order.consignee) ?? clientParty(order.client ?? null);
  if (!consignee || !printable(consignee.name)) out.push("No consignee on the order and no client address to fall back on — the PI would print a blank consignee.");
  return out;
}
