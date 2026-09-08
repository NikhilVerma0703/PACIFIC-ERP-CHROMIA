// Invoice rules — PURE. Everything the invoice routes and the two invoice PDFs
// have to DECIDE lives here so tests/commercialInvoices.test.ts can run it
// without Next, Prisma or a session: how order lines (or a packing list's
// slabs) become printed lines, how the snapshot is frozen, how the tax and the
// grand total are worked out, which status may move where, and how every
// number and date prints.
//
// Imports only sibling pure modules by relative path with the .ts extension —
// the way access-rules imports roles.ts — so `node --test` loads it bare.
//
// TWO REFERENCES, TWO LAYOUTS:
//   the JB Homes DTA sheet   PESPL/0137/26-27, IGST 18%, SQFT, "2 CM",
//                            description "ASSORTED COLOURS QUARTZ SLABS",
//                            grand total on a whole rupee with a Round Off row
//   the CIOT export invoice  PESPL/2780, no GST (LUT), SQMT/SQFT, "3CM",
//                            the customer's SKU as the description, 3 dp kept
import { amountInWords } from "./words.ts";
import { computeTax, stateCodeFromGstin, type TaxResult } from "./tax.ts";
import { slabMeasure, sumTo } from "./measure.ts";
import { canonThickness } from "../thickness.ts";
import { gstinChoices, type CommercialSettings, type GstinChoice } from "./settings-defaults.ts";
import type { DocLine, Party, InvoiceSnapshot } from "./types.ts";

// ───────────────────────────── kinds & status ────────────────────────────────

export type InvoiceKind = "DTA" | "EXPORT";
export type InvoiceStatus = "DRAFT" | "ISSUED" | "CANCELLED";

export const INVOICE_KINDS: readonly InvoiceKind[] = ["DTA", "EXPORT"];
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["DRAFT", "ISSUED", "CANCELLED"];

/** The commodity every one of these invoices carries. */
export const COMMODITY = "Artificial Quartz Slabs";

/** What the JB Homes sheet calls a mixed-colour load. Used when a line names
 *  no design of its own — never overwrite a typed description with it. */
export const DTA_DEFAULT_DESCRIPTION = "ASSORTED COLOURS QUARTZ SLABS";

/** The group heading row the DTA table prints above its lines. */
export const DTA_GROUP_HEADING = "Artificial Quartz Slabs";

/** A DOMESTIC order issues a DTA invoice; an EXPORT order an export one. */
export function defaultKindFor(orderKind: string | null | undefined): InvoiceKind {
  return String(orderKind ?? "").toUpperCase() === "DOMESTIC" ? "DTA" : "EXPORT";
}

/** The numbering counter this kind draws from. */
export function sequenceKindFor(kind: InvoiceKind): "dtaInvoice" | "exportInvoice" {
  return kind === "DTA" ? "dtaInvoice" : "exportInvoice";
}

export function canEditInvoice(status: string): boolean { return status === "DRAFT"; }
export function canIssueInvoice(status: string): boolean { return status === "DRAFT"; }
export function canCancelInvoice(status: string): boolean { return status === "DRAFT" || status === "ISSUED"; }

/** Why issuing is refused, or null when it may go ahead. */
export function refuseIssue(inv: { status: string; snapshot?: { lines?: unknown } | null }): string | null {
  if (!canIssueInvoice(inv.status)) return `Only a draft can be issued (this invoice is ${String(inv.status).toLowerCase()})`;
  const lines = inv.snapshot && Array.isArray((inv.snapshot as { lines?: unknown[] }).lines) ? (inv.snapshot as { lines: unknown[] }).lines : [];
  if (lines.length === 0) return "The invoice has no lines — add items to the order and rebuild the draft";
  return null;
}

export function statusTone(status: string): "brand" | "green" | "amber" | "red" {
  switch (status) {
    case "ISSUED": return "green";
    case "DRAFT": return "amber";
    default: return "red";
  }
}

// ───────────────────── one invoice per order (answer 18) ─────────────────────

/** The invoice that blocks a new one on this order: the first that is not
 *  cancelled. Null when the order may take a draft. */
export function openInvoiceOf<T extends { status: string }>(existing: ReadonlyArray<T> | null | undefined): T | null {
  return (existing ?? []).find((i) => String(i.status).toUpperCase() !== "CANCELLED") ?? null;
}

/**
 * Why drafting a second invoice is refused, or null when it may go ahead.
 * "One PI has one invoice" — a cancelled one no longer counts, so a wrong
 * invoice is cancelled with a reason and raised again, never doubled up.
 */
export function refuseCreate(existing: ReadonlyArray<{ status: string; number?: string | null }> | null | undefined): string | null {
  const open = openInvoiceOf(existing);
  if (!open) return null;
  const which = printable(open.number) ? `invoice ${open.number}` : "an invoice";
  return `This order already has ${which} (${String(open.status).toLowerCase()}). One order carries one invoice — cancel it with a reason before raising another`;
}

// ───────────────────── approval before the final invoice (answer 10) ─────────

/** Who may approve the checklist, for the refusal to name. */
export const INVOICE_APPROVERS = "an admin or the Commercial Manager";

/**
 * Why issuing is refused for want of approval, or null. The same sentence
 * stages.canEnter gives, with the approver named, so the clerk knows whose
 * door to knock on rather than which rule they hit.
 */
export function refuseIssueUnapproved(order: { approvedAt?: string | Date | null } | null | undefined): string | null {
  const at = order?.approvedAt;
  if (at !== null && at !== undefined && at !== "") return null;
  return `The checklist must be approved before the final invoice — ${INVOICE_APPROVERS} approves it on the order's Overview tab`;
}

// ───────────────────── the bank and the GSTIN printed (answers 21, 23) ───────

export type BankKey = "export" | "domestic";
export const BANK_KEYS: readonly BankKey[] = ["export", "domestic"];

export function isBankKey(v: unknown): v is BankKey {
  return v === "export" || v === "domestic";
}

/** ICICI (domestic) on a DTA invoice, Kotak (export) otherwise — answer 23's
 *  default, which the dropdown may change while the invoice is a draft. */
export function defaultBankKeyFor(kind: InvoiceKind): BankKey {
  return kind === "DTA" ? "domestic" : "export";
}

/** The printed bank block for a key. */
export function bankBlockFor(settings: CommercialSettings, key: BankKey): InvoiceSnapshot["bank"] {
  const bank = settings.banks[key];
  return {
    name: bank.name, address: bank.address, accountNo: bank.accountNo,
    ifsc: bank.ifsc, swift: bank.swift,
    adCode: bank.adCode, routingBank: bank.routingBank, routingSwift: bank.routingSwift,
  };
}

/**
 * The GSTIN an invoice is issued under: the one asked for when it is on the
 * dropdown, else the company's own (answer 21). Null when a GSTIN was named
 * that the settings do not offer — the route refuses it rather than printing
 * a registration nobody vouched for.
 */
export function gstinChoiceFor(settings: CommercialSettings, requested?: string | null): GstinChoice | null {
  const choices = gstinChoices(settings.company);
  const want = printable(requested).toUpperCase();
  if (!want) return choices[0];
  return choices.find((c) => c.gstin === want) ?? null;
}

/**
 * The label printed beside an alternate GSTIN — where the old export template
 * carried the sister company's name under PESPL's heading. The company's own
 * registration needs no label: the name above it says whose it is.
 */
export function gstinLabelFor(settings: CommercialSettings, choice: GstinChoice): string | null {
  return choice.gstin === settings.company.gstin ? null : choice.label;
}

/** "33AAFCP5374A1ZQ (Pacific Granites (India) Pvt Ltd)" — or just the GSTIN. */
export function gstinWithLabel(gstin: string | null | undefined, label: string | null | undefined): string {
  const g = printable(gstin);
  const l = printable(label);
  return g && l ? `${g} (${l})` : g;
}

// ────── how far an alternate registration reaches (round two, answer 19) ─────

/** The one question the screen asks when an alternate registration is chosen.
 *  Asked once, at the moment of choosing, in the screen's own dialog — the
 *  answer then rides in the snapshot and the workbook obeys it. */
export const GSTIN_APPLY_ALL_QUESTION = "Apply this registration to every sheet of the export workbook?";
export const GSTIN_APPLY_ALL_YES = "Yes — every sheet";
export const GSTIN_APPLY_ALL_NO = "No — this invoice only";

/**
 * A registration that is NOT the company's own, i.e. the sister company's.
 * This is also the predicate for "does choosing it ask the question": the
 * company's own is what every sheet already prints, so there is nothing to
 * decide about its reach.
 *
 * Takes the company's own registration rather than the settings so a browser
 * screen can ask it too — the settings are admin-only, but the first entry of
 * the clerk-readable choices route IS the company's own (gstinChoices).
 */
export function isAlternateOf(ownGstin: string | null | undefined, gstin: string | null | undefined): boolean {
  const g = printable(gstin).toUpperCase();
  return g !== "" && g !== printable(ownGstin).toUpperCase();
}

export function isAlternateGstin(settings: CommercialSettings, gstin: string | null | undefined): boolean {
  return isAlternateOf(settings.company.gstin, gstin);
}

/**
 * The scope the snapshot stores for a chosen registration (round two, answer
 * 19). The company's own is always `true` — the question was never asked and
 * every sheet carries it anyway, so storing `false` there would describe a
 * distinction that does not exist. An alternate takes the answer given; with
 * no answer it takes the NARROW one, because a registration nobody confirmed
 * for the packing list, the customer copy and Annexure C1 must not spread
 * itself across three more customs documents on a default.
 */
export function gstinApplyAllFor(
  settings: CommercialSettings,
  gstin: string | null | undefined,
  answer: boolean | null | undefined,
): boolean {
  if (!isAlternateGstin(settings, gstin)) return true;
  return answer === true;
}

/**
 * Only an EXPORT invoice has an export workbook — a DTA invoice's paperwork is
 * the one sheet plus the delivery challan. So round two's answer 19, which is
 * entirely about how far a registration reaches ACROSS THAT WORKBOOK, has
 * nothing to decide on a DTA: asking "apply this to every sheet of the export
 * workbook?" there asks about sheets that will never be printed.
 */
export function hasExportWorkbook(kind: string | null | undefined): boolean {
  return printable(kind).toUpperCase() === "EXPORT";
}

/** Does choosing this registration on this kind of invoice put the question?
 *  Only an alternate (the company's own reaches everything anyway), and only
 *  where there is a workbook for it to reach across. */
export function gstinQuestionApplies(
  ownGstin: string | null | undefined,
  gstin: string | null | undefined,
  kind: string | null | undefined,
): boolean {
  return hasExportWorkbook(kind) && isAlternateOf(ownGstin, gstin);
}

/**
 * The scope to store when the question is NOT put — the company's own, or a
 * DTA invoice that has no workbook. The own registration is `true` (every
 * sheet carries it either way); an unasked alternate takes the NARROW reading,
 * which is exactly what gstinApplyAllFor gives the server for an answer nobody
 * supplied — so screen and server agree instead of one of them inventing a
 * "yes" for sheets nobody confirmed.
 */
export function gstinScopeUnasked(ownGstin: string | null | undefined, gstin: string | null | undefined): boolean {
  return !isAlternateOf(ownGstin, gstin);
}

/** What the screens say the workbook will do with the chosen registration, or
 *  null for the company's own — where there is nothing to explain. `kind` is
 *  the invoice's: a DTA has no workbook, so it gets its own sentence rather
 *  than a promise about sheets it will never print. */
export function gstinScopeNote(
  ownGstin: string | null | undefined,
  x: { gstin: string; gstinApplyAll: boolean },
  kind: string | null | undefined = "EXPORT",
): string | null {
  if (!isAlternateOf(ownGstin, x.gstin)) return null;
  if (!hasExportWorkbook(kind)) return "This registration prints on this DTA invoice; there is no export workbook for it to reach.";
  return x.gstinApplyAll
    ? "This registration prints on every sheet of the export workbook."
    : "This registration prints on the invoice only — the packing list, the customer copy and Annexure C1 keep the company's own.";
}

// ────────────── the invoice's bank follows the PI (round two, answer 20) ─────

/** Why the bank select is refused to everyone below manager level. Shown on
 *  the disabled field, and the 403 the routes answer with. */
export const BANK_FOLLOWS_PI = "The invoice follows the PI's bank; the Commercial Manager may change it";

/** A PI the customer holds: issued, and accepted is issued-and-signed. A
 *  draft is not paper yet and a cancelled one (answer 24) is history, so
 *  neither lends its bank to an invoice. */
export const LIVE_PI_STATUSES: readonly string[] = ["ISSUED", "ACCEPTED"];

export interface PiBankSource {
  status?: string | null;
  revision?: number | null;
  snapshot?: { bankKey?: unknown } | null;
}

export function isLivePi(pi: PiBankSource | null | undefined): boolean {
  return LIVE_PI_STATUSES.includes(printable(pi?.status).toUpperCase());
}

/**
 * The order's live PI. Since answer 24 a revision cancels the one it replaces,
 * so there is at most one; the highest revision wins if a row from before that
 * answer left two standing.
 *
 * This is the ONLY rule that decides it — the screen runs it over the order's
 * proformas and invoices/_lib.ts runs it over the rows it selected, so the two
 * cannot name different PIs as "the live one". On EQUAL revisions the first
 * row given wins, which makes the caller's ordering the tie-break: the route
 * hands them highest revision first and, inside one revision, latest issued.
 */
export function livePiOf<T extends PiBankSource>(pis: ReadonlyArray<T> | null | undefined): T | null {
  let best: T | null = null;
  for (const pi of pis ?? []) {
    if (!isLivePi(pi)) continue;
    if (!best || (pi.revision ?? 0) > (best.revision ?? 0)) best = pi;
  }
  return best;
}

/**
 * The bank a new invoice prints (round two, answer 20): the PI's, so the
 * customer pays into the account the proforma told him to. Only a live PI
 * lends one; with none, or with a PI frozen before the bank was stored, the
 * kind decides as it always did — ICICI domestic, Kotak export (answer 23).
 */
export function bankKeyForInvoice(pi: PiBankSource | null | undefined, kind: InvoiceKind): BankKey {
  if (isLivePi(pi) && isBankKey(pi?.snapshot?.bankKey)) return pi!.snapshot!.bankKey as BankKey;
  return defaultBankKeyFor(kind);
}

/** Changing it away from the PI's is the manager's or an admin's — the same
 *  `cancel` action that cancels a PI or an invoice (answer 24). */
export function mayChangeInvoiceBank(actions: ReadonlyArray<string> | null | undefined): boolean {
  return (actions ?? []).includes("cancel");
}

/** The reason to render on the disabled select, or null when it is allowed. */
export function bankChangeRefusal(actions: ReadonlyArray<string> | null | undefined): string | null {
  return mayChangeInvoiceBank(actions) ? null : BANK_FOLLOWS_PI;
}

// ───────────────────── design codes on the lines (answer 20) ─────────────────

/** design → its code from commercial_design_code; null when the row has none. */
export type DesignCodeLookup = (design: string | null | undefined) => string | null;

/** Build the lookup from the master's rows. Case- and space-insensitive on the
 *  design, because FG names arrive in every spelling the floor uses. */
export function designCodeLookup(rows: ReadonlyArray<{ design: string; code?: string | null }> | null | undefined): DesignCodeLookup {
  const by = new Map<string, string>();
  for (const r of rows ?? []) {
    const key = printable(r.design).toUpperCase().replace(/\s+/g, " ");
    const code = printable(r.code);
    if (key && code) by.set(key, code);
  }
  return (design) => by.get(printable(design).toUpperCase().replace(/\s+/g, " ")) ?? null;
}

export const NO_DESIGN_CODE: DesignCodeLookup = () => null;

/** What the DOCUMENT prints as the item code: the design's code, else the
 *  design name — never blank, and never a "no code" marker on paper. */
export function printedItemCode(line: { itemCode?: string | null; design?: string | null; description?: string | null }): string {
  return printable(line.itemCode) || printable(line.design) || printable(line.description);
}

/** The SCREEN's marker: a line whose design has no code in the master yet. */
export function lineLacksCode(line: { itemCode?: string | null; isSample?: boolean | null }): boolean {
  return !line.isSample && !printable(line.itemCode);
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
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber(): number }).toNumber();
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
export function round3(n: number): number { return Math.round((n + Number.EPSILON) * 1000) / 1000; }
export function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000; }

/** A nominal slab as the packing list measures one (137in × 79in → 348 × 201 cm).
 *  The fallback when a slab carries no measure of its own. */
export const NOMINAL_SLAB = slabMeasure(null, null);

// ───────────────────────────── printing ──────────────────────────────────────

/** "5.4" stays "5.4", 5 prints "5", 2 prints "2": a number without its zeros. */
export function trimNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * How a thickness prints on an invoice. Stored canonical ('3 cm', '2 cm',
 * '1.2 cm', '7 mm'); the DTA sheet writes "2 CM" with a space, the export
 * sheet "3CM" without one. Unknown spellings pass through; blank → null.
 */
export function printInvoiceThickness(raw: string | null | undefined, kind: InvoiceKind): string | null {
  const canon = canonThickness(raw);
  if (!canon) return null;
  const m = canon.match(/^(\d+(?:\.\d+)?)\s*(cm|mm)$/i);
  if (!m) return canon;
  const n = Number(m[1]);
  const cm = m[2].toLowerCase() === "mm" ? n / 10 : n;
  return kind === "EXPORT" ? `${trimNumber(cm)}CM` : `${trimNumber(cm)} CM`;
}

/** The printed unit for a UOM code. DTA prints SQFT or NOS; export prints
 *  SQMT or SQFT (or NOS for a sample line), whichever the order line uses. */
export function invoiceUnit(uom: string | null | undefined, kind: InvoiceKind): string {
  const u = printable(uom).toUpperCase().replace(/[\s.]+/g, "");
  if (u === "NOS" || u === "NO" || u === "PCS" || u === "PC" || u === "SET" || u === "BOX") return "NOS";
  if (u === "SQMT" || u === "SQM" || u === "SQUAREMETRE" || u === "SQUAREMETER" || u === "M2") return "SQMT";
  if (kind === "EXPORT") return "SQFT";
  return "SQFT";
}

/** Which measurement a unit is summed from when lines come off a packing list. */
export function measureFieldFor(unit: string): "sqm" | "sqft" | "nos" {
  if (unit === "SQMT") return "sqm";
  if (unit === "NOS") return "nos";
  return "sqft";
}

/** YYYY-MM-DD (or an ISO timestamp, or a Date) → DD/MM/YYYY — the DTA and
 *  challan date style. Blank in → "". */
export function fmtDMY(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  let y: number, mo: number, d: number;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    y = v.getUTCFullYear(); mo = v.getUTCMonth() + 1; d = v.getUTCDate();
  } else {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  }
  return `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`;
}

/** The same date with dashes — how the PI reference prints one (03-07-2026). */
export function fmtDMYDash(v: unknown): string {
  return fmtDMY(v).replace(/\//g, "-");
}

/** A Date → YYYY-MM-DD in UTC (the @db.Date convention of dateOnly()). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** India is UTC+5:30 all year. */
export const IST_OFFSET_MINUTES = 330;

/**
 * TODAY, on the Indian calendar — the only calendar these documents are dated
 * by. `new Date().toISOString()` gives the UTC day, so an invoice or a challan
 * created between 00:00 and 05:30 IST was stamped YESTERDAY, and one created in
 * that window on 1 April was stamped 31 March and drew its number from the
 * previous financial year's counter.
 */
export function istIsoDate(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Indian digit grouping at a fixed precision — 3,749,231.70 prints as
 *  37,49,231.70, which is what the reference sheets show. */
export function fmtIndian(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Plain grouping for the export sheet, which is read abroad. */
export function fmtWestern(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * How many decimals a RATE must print to keep every digit it is stored with.
 *
 * Rates are kept at 4 dp (round4 on the way in). Printing one at 3 threw a
 * stored digit away, and printed quantity × printed rate then missed the
 * printed amount — 3,160.5 SQFT at 1,005.3223 is 31,77,321.13, but the sheet
 * showed the rate as 1,005.322, which multiplies out to 31,77,320.18: a rupee
 * of daylight on the face of a tax invoice, with nothing on the page to
 * explain it. Never fewer than `min` (a money column reads as money), never
 * more than `max` (nothing is stored past 4 dp).
 */
export function rateDp(rate: number | null | undefined, min = 2, max = 4): number {
  const n = toNumber(rate, 0);
  const lo = Math.max(0, Math.min(min, max));
  if (!Number.isFinite(n)) return lo;
  for (let d = lo; d < max; d++) {
    const f = 10 ** d;
    if (Math.abs(Math.round(n * f) / f - n) < 1e-9) return d;
  }
  return max;
}

/** A rate printed at exactly the precision it is stored with — Indian grouping. */
export function fmtRateIndian(rate: number | null | undefined): string {
  return fmtIndian(rate, rateDp(rate));
}

/** The same for the export sheet, which is read abroad. */
export function fmtRateWestern(rate: number | null | undefined): string {
  return fmtWestern(rate, rateDp(rate));
}

/**
 * The decimals the AMOUNT column prints at so that the column ADDS UP to the
 * Total printed beneath it.
 *
 * Line amounts are kept at 3 dp and the subtotal is their 3-dp sum. Printing
 * the lines at 2 dp while the Total came from that 3-dp subtotal produced a
 * column that did not sum to its own total (100.005 + 200.005 printed as
 * 100.01 + 200.01 = 300.02 under a Total of 300.01). 2 dp whenever the rounded
 * lines still sum to the rounded total — which is nearly always, and is the
 * reference sheet's look — 3 dp when they do not.
 */
export function amountColumnDp(lines: ReadonlyArray<{ amount: number }>, subtotal: number): 2 | 3 {
  const sum = round2(lines.reduce((a, l) => a + round2(Number.isFinite(l.amount) ? l.amount : 0), 0));
  return sum === round2(subtotal) ? 2 : 3;
}

/**
 * "PESPL/0137/26-27      Dated: 14/07/2026" — a document reference and its
 * date, the way the DTA header prints one. ONE date form per page: the DTA
 * convention is DD/MM/YYYY, for the invoice's own date and for the PI's alike
 * (the header used to print the PI's with dashes, so a reader met two date
 * formats an inch apart).
 */
export function datedRef(reference: unknown, date: unknown): string {
  const ref = printable(reference);
  const d = fmtDMY(date);
  if (!d) return ref;
  return ref ? `${ref}      Dated: ${d}` : `Dated: ${d}`;
}

/**
 * The number with its date DIRECTLY UNDER it (answer 6) — the invoice and
 * challan headers and their registers all print this pair, so a reader finds
 * the date in the same place on every document the module issues:
 *
 *   datedLines("PESPL/N12", "2026-07-14") → ["PESPL/N12", "Dated: 14/07/2026"]
 *
 * A missing date gives the number alone rather than a bare "Dated:".
 */
export function datedLines(reference: unknown, date: unknown): string[] {
  const ref = printable(reference);
  const d = fmtDMY(date);
  const out: string[] = [];
  if (ref) out.push(ref);
  if (d) out.push(`Dated: ${d}`);
  return out;
}

/**
 * The financial year a date falls in, as the numbering writes it ("26-27").
 * From the ISO date, not a Date object: the register shows this beside a
 * continuous export number (answer 6), and a Date read in local time would
 * roll 1 April back into March for anyone west of India.
 */
export function fyOfIso(v: unknown): string {
  const m = (v instanceof Date ? isoDate(v) : printable(v)).match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const y = Number(m[1]);
  const start = Number(m[2]) >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/**
 * The financial-year tag the register shows BESIDE an export invoice's number
 * (answer 6): PESPL/N{seq} runs on across years, so the number alone no longer
 * says which year's books it sits in. A DTA number carries its FY already
 * (PESPL/N7/26-27), so it gets nothing. "FY 26-27", or null.
 */
export function fyBadge(kind: string | null | undefined, date: unknown): string | null {
  if (String(kind ?? "").toUpperCase() !== "EXPORT") return null;
  const fy = fyOfIso(date);
  return fy ? `FY ${fy}` : null;
}

/** "PESPL/0137/26-27" → "PESPL-0137-26-27.pdf" (a slash cannot be a filename). */
export function invoiceFilename(number: string): string {
  const safe = printable(number).replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${safe || "invoice"}.pdf`;
}

/**
 * The buyer's PO reference as the CIOT sheets print it:
 *   "PO-4068622 Dt: 03/07/2026 (PI-SAL-ORD/26-27/01642)"
 * No PO on file → just the PI reference; nothing at all → null.
 */
export function buyerPoRef(order: { customerPoNumber?: string | null; customerPoDate?: unknown; number?: string | null }): string | null {
  const po = clean(order.customerPoNumber);
  const dt = fmtDMY(order.customerPoDate);
  const pi = clean(order.number);
  const parts: string[] = [];
  if (po) parts.push(dt ? `${po} Dt: ${dt}` : po);
  if (pi) parts.push(parts.length ? `(PI-${pi})` : `PI-${pi}`);
  return parts.length ? parts.join(" ") : null;
}

// ───────────────────────────── inputs ────────────────────────────────────────

/** The slice of an order line the lines builder reads (OrderItemDto is a superset). */
export interface InvoiceItemInput {
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

/** The slice of a packed slab the lines builder reads (PackedSlabDto is a superset). */
export interface InvoiceSlabInput {
  slabNumber?: number | null;
  design?: string | null;
  customerSku?: string | null;
  thickness?: string | null;
  sqm?: number | string | null;
  sqft?: number | string | null;
}

/** The slice of the client the fallbacks need (ClientDto is a superset). */
export interface InvoiceClientInput {
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
    billingAddress?: Party | null;
    shippingAddress?: Party | null;
    notifyParty?: Party | null;
  } | null;
}

/** The slice of an order the snapshot reads (OrderDetail is a superset). */
export interface InvoiceOrderInput {
  number: string;
  kind: string;
  currency?: string | null;
  exchangeRate?: number | string | null;
  customerPoNumber?: string | null;
  customerPoDate?: unknown;
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
  createdByName?: string | null;
  client?: InvoiceClientInput | null;
  items?: InvoiceItemInput[] | null;
}

export interface InvoiceSnapshotOptions {
  /** YYYY-MM-DD — the invoice's printed date. */
  date: string;
  piNumber?: string | null;
  piDate?: string | null;
  exchangeRate?: number | null;
  vehicleNo?: string | null;
  transporter?: string | null;
  containerNo?: string | null;
  sealNo?: string | null;
  linerOtlNo?: string | null;
  marksAndNos?: string | null;
  packages?: string | null;
  grossWeight?: string | null;
  netWeight?: string | null;
  vessel?: string | null;
  notes?: string | null;
  /** The registration to print (answer 21); blank → the company's own. */
  gstin?: string | null;
  /** The answer to the one question an alternate registration asks (round two,
   *  answer 19). Ignored for the company's own; null → the narrow scope. */
  gstinApplyAll?: boolean | null;
  /** The bank to print (answer 23); blank → by kind (defaultBankKeyFor). The
   *  caller passes the PI's (round two, answer 20, bankKeyForInvoice). */
  bankKey?: BankKey | null;
}

/**
 * What the snapshot carries on top of the InvoiceSnapshot contract since the
 * owner's answers of 2026-09-07: the chosen GSTIN with the label printed
 * beside it when it is not the company's own (answer 21), and which bank the
 * block came from (answer 23), so a draft can switch banks without anyone
 * re-typing account numbers. `company.gstin` is ALSO set to the chosen one,
 * so a reader of the old shape prints the right registration.
 */
export interface InvoiceSnapshotExtras {
  gstin: string;
  gstinLabel: string | null;
  bankKey: BankKey;
  /** Round two, answer 19: how far the chosen registration reaches across the
   *  export workbook. True puts it in every sheet's GSTIN cell; false puts it
   *  on this invoice alone and leaves the other sheets on the company's own. */
  gstinApplyAll: boolean;
}
export type InvoiceDocSnapshot = InvoiceSnapshot & InvoiceSnapshotExtras;

/** The extras of a stored snapshot, with the pre-answer defaults for a row
 *  written before they existed: the company's GSTIN, the bank by kind, and
 *  the WIDE workbook scope — before the question was asked an alternate
 *  registration went into every GSTIN cell there is, so `true` is what those
 *  rows already printed and re-reading one must not quietly change its file. */
export function snapshotExtras(s: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>): InvoiceSnapshotExtras {
  return {
    gstin: printable(s.gstin) || printable(s.company?.gstin),
    gstinLabel: clean(s.gstinLabel),
    bankKey: isBankKey(s.bankKey) ? s.bankKey : defaultBankKeyFor(s.kind),
    gstinApplyAll: typeof s.gstinApplyAll === "boolean" ? s.gstinApplyAll : true,
  };
}

// ───────────────────────────── parties ───────────────────────────────────────

function isParty(v: unknown): v is Party {
  return typeof v === "object" && v !== null && typeof (v as Party).name === "string";
}

/** Anything JSON-shaped → a Party, or null when it names nobody. */
export function partyOrNull(v: unknown): Party | null {
  if (!isParty(v)) return null;
  const lines = Array.isArray(v.lines) ? v.lines.map((l) => printable(l)).filter(Boolean) : [];
  const name = printable(v.name);
  if (!name && lines.length === 0) return null;
  return {
    name, lines,
    country: clean(v.country), tel: clean(v.tel), email: clean(v.email),
    gstin: clean(v.gstin), stateCode: clean(v.stateCode), code: clean(v.code),
  };
}

/** The client master as a Party — the fallback when the order names nobody. */
export function clientParty(client: InvoiceClientInput | null | undefined): Party | null {
  if (!client) return null;
  const name = printable(client.name);
  const cityCountry = [printable(client.city), printable(client.country)].filter(Boolean).join(", ");
  const lines = [printable(client.address), cityCountry].filter(Boolean);
  if (!name && lines.length === 0) return null;
  return {
    name, lines,
    country: clean(client.country), tel: clean(client.phone), email: clean(client.email),
    gstin: clean(client.commercialExt?.gstin),
    stateCode: clean(client.commercialExt?.stateCode),
    code: clean(client.commercialExt?.customerCode),
  };
}

/** The company as a Party. `gstin` is the registration the document is issued
 *  under (answer 21) — the company's own unless the dropdown chose another. */
export function exporterParty(settings: CommercialSettings, gstin?: string | null): Party {
  const c = settings.company;
  return {
    name: c.legalName,
    lines: [...c.addressLines],
    country: settings.defaults.countryOfOrigin || "India",
    tel: c.phone || null,
    email: c.email || null,
    gstin: printable(gstin) || c.gstin || null,
    stateCode: c.stateCode || null,
    code: null,
  };
}

function sameParty(a: Party | null, b: Party | null): boolean {
  if (!a || !b) return false;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

/**
 * The buyer's GST state code: the code on file, else the first two digits of
 * the GSTIN, else null — which computeTax reads as "assume IGST" and flags.
 */
export function buyerStateCode(ext: { stateCode?: string | null; gstin?: string | null } | null | undefined, buyer?: Party | null): string | null {
  return clean(ext?.stateCode)
    ?? stateCodeFromGstin(clean(ext?.gstin))
    ?? clean(buyer?.stateCode)
    ?? stateCodeFromGstin(clean(buyer?.gstin));
}

// ───────────────────────────── lines ─────────────────────────────────────────

/** The order line that carries the rate for a design + thickness pair. */
export function matchOrderItem<T extends InvoiceItemInput>(items: ReadonlyArray<T>, design: string | null | undefined, thickness: string | null | undefined): T | null {
  const d = printable(design).toUpperCase();
  const t = canonThickness(thickness);
  let looseMatch: T | null = null;
  for (const it of items) {
    const id = printable(it.design).toUpperCase();
    const itk = canonThickness(it.thickness);
    if (d && id === d && t && itk === t) return it;
    if (d && id === d && !looseMatch) looseMatch = it;
    if (!d && t && itk === t && !looseMatch) looseMatch = it;
  }
  return looseMatch;
}

/** The description a DTA line prints: the typed one, else the design in
 *  capitals, else the sheet's "ASSORTED COLOURS QUARTZ SLABS". */
export function dtaDescription(item: { description?: string | null; design?: string | null } | null | undefined): string {
  const typed = clean(item?.description);
  if (typed) return typed;
  const design = clean(item?.design);
  return design ? design.toUpperCase() : DTA_DEFAULT_DESCRIPTION;
}

/** The description an export line prints: the customer's SKU when there is
 *  one, else the typed description, else the design. */
export function exportDescription(item: { customerSku?: string | null; description?: string | null; design?: string | null } | null | undefined): string {
  return clean(item?.customerSku) ?? clean(item?.description) ?? clean(item?.design)?.toUpperCase() ?? "";
}

/** One order line → one printed line. The STORED amount is printed when the
 *  line has one; only a line with none is worked out (qty × rate at 3 dp).
 *  The item code is the design master's (answer 20), never the customer's
 *  SKU — that stays in the description, where the CIOT sheet printed it. */
export function lineFromItem(item: InvoiceItemInput, index: number, kind: InvoiceKind, settings: CommercialSettings, codeFor: DesignCodeLookup = NO_DESIGN_CODE): DocLine {
  const unit = invoiceUnit(item.uom, kind);
  const qty = round3(toNumber(item.qty, 0));
  const rate = round4(toNumber(item.rate, 0));
  const typed = item.amount === null || item.amount === undefined || item.amount === "" ? null : round3(toNumber(item.amount, 0));
  const slabs = item.qtySlabs === null || item.qtySlabs === undefined ? null : Math.round(toNumber(item.qtySlabs, 0));
  return {
    lineNo: item.lineNo ?? index + 1,
    itemCode: codeFor(item.design),
    description: kind === "DTA" ? dtaDescription(item) : (exportDescription(item) || dtaDescription(item)),
    design: clean(item.design),
    thickness: printInvoiceThickness(item.thickness, kind),
    slabs,
    hsn: clean(item.hsn) ?? settings.company.hsnQuartz,
    unit,
    qty,
    rate,
    amount: typed ?? round3(qty * rate),
    isSample: Boolean(item.isSample),
  };
}

export interface SlabGroup {
  design: string | null;
  thickness: string;          // canonical, e.g. '2 cm'
  slabs: number;
  sqm: number;
  sqft: number;
}

/**
 * A packing list's slabs grouped by design + canonical thickness, in the order
 * the first slab of each group appears. A slab with no measure of its own
 * counts as a nominal slab (348 × 201 cm), so a group is never short.
 */
export function groupSlabs(slabs: ReadonlyArray<InvoiceSlabInput>): SlabGroup[] {
  const order: string[] = [];
  const by = new Map<string, { design: string | null; thickness: string; sqm: number[]; sqft: number[] }>();
  for (const s of slabs) {
    const design = clean(s.design);
    const thickness = canonThickness(s.thickness);
    const key = `${thickness}|${printable(design).toUpperCase()}`;
    let g = by.get(key);
    if (!g) { g = { design, thickness, sqm: [], sqft: [] }; by.set(key, g); order.push(key); }
    const sqm = toNumber(s.sqm, 0) || NOMINAL_SLAB.sqm;
    const sqft = toNumber(s.sqft, 0) || NOMINAL_SLAB.sqft;
    g.sqm.push(sqm);
    g.sqft.push(sqft);
  }
  return order.map((k) => {
    const g = by.get(k)!;
    return { design: g.design, thickness: g.thickness, slabs: g.sqm.length, sqm: sumTo(g.sqm, 4), sqft: sumTo(g.sqft, 3) };
  });
}

/**
 * The invoice's printed lines.
 *
 *   slabs given   → one line per design + thickness group, quantity summed
 *                   from the slabs themselves, rate / HSN / SKU taken from
 *                   the order line for that design + thickness
 *   slabs absent  → one line per order line, exactly as the order priced it
 *
 * DTA prints "ASSORTED COLOURS QUARTZ SLABS" (or the design) at "2 CM" in
 * SQFT / NOS; EXPORT prints the SKU at "3CM" in SQMT / SQFT.
 */
export function buildInvoiceLines(
  items: ReadonlyArray<InvoiceItemInput> | null | undefined,
  slabs: ReadonlyArray<InvoiceSlabInput> | null | undefined,
  kind: InvoiceKind,
  settings: CommercialSettings,
  codeFor: DesignCodeLookup = NO_DESIGN_CODE,
): DocLine[] {
  const orderItems = (items ?? []).slice();
  if (!slabs || slabs.length === 0) {
    return orderItems.map((it, i) => lineFromItem(it, i, kind, settings, codeFor));
  }
  const groups = groupSlabs(slabs);
  const lines: DocLine[] = groups.map((g, i) => {
    const item = matchOrderItem(orderItems, g.design, g.thickness);
    const unit = invoiceUnit(item?.uom, kind);
    const field = measureFieldFor(unit);
    const qty = field === "sqm" ? round4(g.sqm) : field === "nos" ? g.slabs : round3(g.sqft);
    const rate = round4(toNumber(item?.rate, 0));
    return {
      lineNo: i + 1,
      itemCode: codeFor(g.design ?? item?.design),
      description: kind === "DTA"
        ? dtaDescription({ description: item?.description, design: g.design ?? item?.design })
        : (exportDescription({ customerSku: item?.customerSku, description: item?.description, design: g.design ?? item?.design }) || DTA_DEFAULT_DESCRIPTION),
      design: g.design ?? clean(item?.design),
      thickness: printInvoiceThickness(g.thickness, kind),
      slabs: g.slabs,
      hsn: clean(item?.hsn) ?? settings.company.hsnQuartz,
      unit,
      qty,
      rate,
      amount: round3(qty * rate),
      isSample: Boolean(item?.isSample),
    };
  });
  // Sample lines are not slabs and never appear in a packing list group; they
  // still have to be invoiced, so they come along from the order unchanged.
  const sampleLines = orderItems.filter((it) => it.isSample).map((it, i) => lineFromItem(it, lines.length + i, kind, settings, codeFor));
  return [...lines, ...sampleLines].map((l, i) => ({ ...l, lineNo: i + 1 }));
}

/** Coerce a client-supplied line (a PATCHed draft) back into a DocLine. */
export function sanitiseLine(raw: unknown, index: number): DocLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as Record<string, unknown>;
  const slabs = l.slabs === null || l.slabs === undefined || l.slabs === "" ? null : Math.round(toNumber(l.slabs, 0));
  const qty = round3(toNumber(l.qty, 0));
  const rate = round4(toNumber(l.rate, 0));
  const typed = l.amount === null || l.amount === undefined || l.amount === "" ? null : round3(toNumber(l.amount, 0));
  return {
    lineNo: Number.isFinite(Number(l.lineNo)) && Number(l.lineNo) > 0 ? Math.round(Number(l.lineNo)) : index + 1,
    itemCode: clean(l.itemCode),
    description: printable(l.description),
    design: clean(l.design),
    thickness: clean(l.thickness),
    slabs,
    hsn: printable(l.hsn),
    unit: printable(l.unit) || "SQFT",
    qty,
    rate,
    amount: typed ?? round3(qty * rate),
    isSample: Boolean(l.isSample),
  };
}

// ───────────────────────── lines nobody has priced ───────────────────────────

/**
 * A printed line nobody has priced: it carries a quantity but neither a rate
 * nor an amount.
 *
 * It happens the moment an invoice is drawn from a packing list: a slab of a
 * design the ORDER does not carry finds no order line to take a rate from, and
 * buildInvoiceLines has nothing to price it with, so the line goes onto a tax
 * invoice at zero. Silently. A sample line is exempt — a free display stand is
 * deliberately worth nothing.
 */
export function lineNeedsPrice(l: { qty?: unknown; rate?: unknown; amount?: unknown; isSample?: unknown }): boolean {
  if (l.isSample) return false;
  return toNumber(l.qty, 0) > 0
    && round4(toNumber(l.rate, 0)) === 0
    && round3(toNumber(l.amount, 0)) === 0;
}

/**
 * Whether a line's amount is simply quantity × rate, or a figure somebody
 * typed that the arithmetic does not give (the reference PI's 3,208.273 × 5.4
 * is 17,324.674 and the document says 17,324.657 — that one is kept).
 *
 * The invoice screen leaves the amount box empty on a derived line so that
 * typing a rate re-derives the amount; a typed amount is shown, and stands.
 */
export function isDerivedAmount(l: { qty?: unknown; rate?: unknown; amount?: unknown }): boolean {
  const qty = round3(toNumber(l.qty, 0));
  const rate = round4(toNumber(l.rate, 0));
  return round3(qty * rate) === round3(toNumber(l.amount, 0));
}

/** The line numbers of every line still needing a rate, in printed order. */
export function unpricedLineNos(lines: ReadonlyArray<DocLine> | null | undefined): number[] {
  return (lines ?? []).filter((l) => lineNeedsPrice(l)).map((l) => l.lineNo);
}

/** The sentence the invoice screen shows above such an invoice, or null. */
export function unpricedWarning(lines: ReadonlyArray<DocLine> | null | undefined): string | null {
  const nos = unpricedLineNos(lines);
  if (nos.length === 0) return null;
  const which = nos.length === 1 ? `Line ${nos[0]} has` : `Lines ${nos.join(", ")} have`;
  return `${which} no rate — the order carries no line for that design and thickness. Type the rate before issuing, or the invoice bills those slabs at zero.`;
}

// ───────────────────────────── totals ────────────────────────────────────────

export interface InvoiceTotals {
  subtotal: number;
  totalSlabs: number;
  taxType: TaxResult["taxType"];
  taxRate: number;
  igst: number;
  cgst: number;
  sgst: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
  /** Set when the buyer's state was unknown and IGST was assumed. */
  warning: string | null;
}

/**
 * Σ the printed amounts, then the GST.
 *
 * DTA lands on a whole rupee with the difference in a Round Off row (the
 * reference sheet only rounded its display; we round the figure so the words
 * and the total agree). EXPORT carries no GST — supply under LUT — and keeps
 * its three decimals, the way the PI does.
 */
export function invoiceTotals(
  lines: ReadonlyArray<DocLine>,
  kind: InvoiceKind,
  buyerState: string | null | undefined,
  settings: CommercialSettings,
  currency = "INR",
): InvoiceTotals {
  const subtotal = round3(lines.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0));
  const totalSlabs = lines.reduce((a, l) => a + (l.slabs ?? 0), 0);
  const t = computeTax({
    subtotal,
    kind: kind === "DTA" ? "DOMESTIC" : "EXPORT",
    supplierStateCode: settings.tax.supplierStateCode,
    buyerStateCode: clean(buyerState),
    igstRate: settings.tax.igstRate,
    cgstRate: settings.tax.cgstRate,
    sgstRate: settings.tax.sgstRate,
    roundToWhole: kind === "DTA",
    // Answer 22: domestic is IGST 18% whatever the buyer's state, and no
    // "state code missing" warning is raised — there is nothing to fill in.
    alwaysIgst: settings.tax.alwaysIgst,
  });
  const grandTotal = kind === "EXPORT" ? subtotal : t.grandTotal;
  const roundOff = kind === "EXPORT" ? 0 : t.roundOff;
  const cur = (kind === "DTA" ? "INR" : (printable(currency) || "USD")).toUpperCase();
  return {
    subtotal, totalSlabs,
    taxType: t.taxType, taxRate: t.taxRate,
    igst: t.igst, cgst: t.cgst, sgst: t.sgst, taxTotal: t.taxTotal,
    roundOff, grandTotal,
    amountInWords: amountInWords(grandTotal, cur),
    warning: t.warning,
  };
}

// ───────────────────────────── the snapshot ──────────────────────────────────

/**
 * Freeze an order into what an invoice prints. Bank: domestic for DTA, export
 * otherwise. Buyer: the order's bill-to, else the client master. Consignee:
 * the order's, else the client's shipping address, else the buyer. LUT text on
 * export only. Totals are worked out here and written into the snapshot, so
 * the PDF renders from one frozen object and never from the live order.
 */
export function buildInvoiceSnapshot(
  order: InvoiceOrderInput,
  settings: CommercialSettings,
  kind: InvoiceKind,
  lines: DocLine[],
  opts: InvoiceSnapshotOptions,
): InvoiceDocSnapshot {
  const isExport = kind === "EXPORT";
  const currency = (isExport ? (printable(order.currency) || "USD") : "INR").toUpperCase();
  const client = order.client ?? null;
  const ext = client?.commercialExt ?? null;

  const fromClient = clientParty(client);
  const buyer = partyOrNull(order.billTo) ?? partyOrNull(ext?.billingAddress) ?? fromClient ?? { name: "", lines: [] };
  const consignee = partyOrNull(order.consignee) ?? partyOrNull(ext?.shippingAddress) ?? fromClient ?? buyer;
  const notifyParty = partyOrNull(order.notifyParty) ?? partyOrNull(ext?.notifyParty) ?? null;
  const state = buyerStateCode(ext, buyer);
  const totals = invoiceTotals(lines, kind, state, settings, currency);
  const bankKey = isBankKey(opts.bankKey) ? opts.bankKey : defaultBankKeyFor(kind);
  // A GSTIN the settings do not offer falls back to the company's own here;
  // the route has already refused it, so this only guards a direct caller.
  const gstinChoice = gstinChoiceFor(settings, opts.gstin) ?? gstinChoiceFor(settings, null)!;
  const c = settings.company;

  return {
    kind,
    gstin: gstinChoice.gstin,
    gstinLabel: gstinLabelFor(settings, gstinChoice),
    // round two, answer 19: the answer to the one question the screen asked
    gstinApplyAll: gstinApplyAllFor(settings, gstinChoice.gstin, opts.gstinApplyAll),
    bankKey,
    number: "",                                   // stamped by the route once issueNumber has run
    date: opts.date,
    piNumber: clean(opts.piNumber) ?? clean(order.number),
    piDate: clean(opts.piDate),
    buyerPoRef: buyerPoRef(order),
    salesPerson: clean(order.createdByName),
    commodity: COMMODITY,
    currency,
    exchangeRate: opts.exchangeRate ?? (order.exchangeRate === null || order.exchangeRate === undefined ? null : round4(toNumber(order.exchangeRate, 0))),
    exporter: exporterParty(settings, gstinChoice.gstin),
    buyer: { ...buyer, gstin: buyer.gstin ?? clean(ext?.gstin), stateCode: buyer.stateCode ?? state },
    consignee,
    notifyParty,
    countryOfOrigin: printable(order.countryOfOrigin) || settings.defaults.countryOfOrigin || "India",
    countryOfDestination: clean(order.countryOfDestination) ?? consignee.country ?? clean(client?.country) ?? (isExport ? null : "India"),
    deliveryTerms: clean(order.deliveryTerms) ?? clean(order.incoterm) ?? (isExport ? null : clean(settings.defaults.domesticDeliveryTerms)),
    paymentTerms: clean(order.paymentTerms) ?? (isExport ? clean(settings.defaults.exportPaymentTerms) : clean(settings.defaults.domesticPaymentTerms)),
    preCarriageBy: clean(order.preCarriageBy) ?? (isExport ? clean(settings.defaults.preCarriageBy) : null),
    placeOfReceipt: clean(order.placeOfReceipt),
    vessel: clean(opts.vessel),
    portOfLoading: clean(order.portOfLoading) ?? (isExport ? clean(settings.defaults.portOfLoading) : null),
    portOfDischarge: clean(order.portOfDischarge),
    finalDestination: clean(order.finalDestination),
    lines,
    subtotal: totals.subtotal,
    taxType: totals.taxType,
    taxRate: totals.taxRate,
    igst: totals.igst,
    cgst: totals.cgst,
    sgst: totals.sgst,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
    marksAndNos: clean(opts.marksAndNos),
    packages: clean(opts.packages),
    grossWeight: clean(opts.grossWeight),
    netWeight: clean(opts.netWeight),
    containerNo: clean(opts.containerNo),
    sealNo: clean(opts.sealNo),
    linerOtlNo: clean(opts.linerOtlNo),
    vehicleNo: clean(opts.vehicleNo),
    transporter: clean(opts.transporter),
    lutText: isExport ? (clean(c.lutText)) : null,
    bank: bankBlockFor(settings, bankKey),
    company: {
      legalName: c.legalName, shortName: c.shortName, addressLines: [...c.addressLines],
      gstin: gstinChoice.gstin, iec: c.iec, pan: c.pan, tan: c.tan,
      stateCode: c.stateCode, districtCode: c.districtCode,
      customsOffice: c.customsOffice, commissionerate: c.commissionerate,
      division: c.division, range: c.range, locationCode: c.locationCode,
      hsnQuartz: c.hsnQuartz,
    },
    declaration: isExport ? settings.texts.piDeclaration : settings.texts.dtaDeclaration,
    notes: clean(opts.notes),
  };
}

/** Re-derive subtotal, tax, round-off, grand total and the words on a snapshot
 *  whose lines (or date) were edited. Returns a NEW snapshot. */
export function recomputeSnapshot<S extends InvoiceSnapshot>(snapshot: S, settings: CommercialSettings): S {
  const totals = invoiceTotals(snapshot.lines, snapshot.kind, snapshot.buyer?.stateCode ?? null, settings, snapshot.currency);
  return {
    ...snapshot,
    subtotal: totals.subtotal,
    taxType: totals.taxType,
    taxRate: totals.taxRate,
    igst: totals.igst,
    cgst: totals.cgst,
    sgst: totals.sgst,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
  };
}

// ───────────────────────────── draft edits ───────────────────────────────────

/** Snapshot fields a DRAFT may have edited from the invoice screen. */
export const EDITABLE_TEXT_FIELDS = [
  "date", "piNumber", "piDate", "buyerPoRef", "salesPerson", "commodity",
  "deliveryTerms", "paymentTerms", "preCarriageBy", "placeOfReceipt", "vessel",
  "portOfLoading", "portOfDischarge", "finalDestination", "countryOfDestination",
  "marksAndNos", "packages", "grossWeight", "netWeight",
  "containerNo", "sealNo", "linerOtlNo", "vehicleNo", "transporter", "notes",
] as const;
export const EDITABLE_PARTY_FIELDS = ["buyer", "consignee", "notifyParty"] as const;

/** The transport columns the invoice row itself carries, alongside the snapshot. */
export const TRANSPORT_COLUMNS = ["vehicleNo", "transporter", "lrNo", "containerNo", "sealNo", "ewayBillNo"] as const;

export interface DraftPatchResult {
  snapshot: InvoiceDocSnapshot;
  /** Something in the snapshot is now different from what came in. */
  changed: boolean;
  /**
   * Editable fields the body NAMED and this function threw away — a date that
   * is not YYYY-MM-DD, a blank buyer or consignee, a `lines` that is not an
   * array. The route refuses the whole PATCH when one of these appears rather
   * than answering 200 with the value the user typed silently discarded.
   */
  rejected: string[];
}

/**
 * Apply a PATCH body to a draft snapshot: only the fields above and `lines`
 * (a full replacement array). Number, kind, bank, company and the totals are
 * ignored — the totals are re-derived whenever the lines or the buyer change.
 * Returns a NEW snapshot, whether anything changed, and what was refused.
 */
export function applyDraftPatch(snapshot: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>, patch: unknown, settings: CommercialSettings): DraftPatchResult {
  // A row written before the extras existed is read with its defaults, so the
  // bank and the GSTIN can be changed on it like on any other draft.
  const base: InvoiceDocSnapshot = { ...snapshot, ...snapshotExtras(snapshot) };
  if (typeof patch !== "object" || patch === null) return { snapshot: base, changed: false, rejected: [] };
  const p = patch as Record<string, unknown>;
  const next: InvoiceDocSnapshot = { ...base };
  let changed = false;
  let totalsDirty = false;
  const rejected: string[] = [];

  // The two dropdowns (answers 21, 23). A value the settings do not offer is
  // refused by name, never silently kept as the old one.
  if ("bankKey" in p) {
    if (!isBankKey(p.bankKey)) rejected.push("bankKey");
    else if (p.bankKey !== next.bankKey) { next.bankKey = p.bankKey; next.bank = bankBlockFor(settings, p.bankKey); changed = true; }
  }
  let gstinChanged = false;
  if ("gstin" in p) {
    const choice = gstinChoiceFor(settings, printable(p.gstin) || null);
    if (!choice) rejected.push("gstin");
    else if (choice.gstin !== next.gstin) {
      next.gstin = choice.gstin;
      next.gstinLabel = gstinLabelFor(settings, choice);
      next.company = { ...next.company, gstin: choice.gstin };
      next.exporter = { ...next.exporter, gstin: choice.gstin };
      changed = true;
      gstinChanged = true;
    }
  }
  // Round two, answer 19. The scope belongs to the registration in force AFTER
  // this patch: a switch to a different alternate asks the question again, so
  // a body that names the new GSTIN without an answer gets the narrow scope
  // rather than inheriting the last registration's "every sheet"; a body that
  // re-sends the same GSTIN keeps the answer already stored. A switch back to
  // the company's own puts it to "every sheet" whatever the body said, because
  // there the question does not arise.
  let scopeAnswer: boolean | null;
  if ("gstinApplyAll" in p) {
    if (typeof p.gstinApplyAll !== "boolean") { rejected.push("gstinApplyAll"); scopeAnswer = gstinChanged ? null : next.gstinApplyAll; }
    else scopeAnswer = p.gstinApplyAll;
  } else {
    scopeAnswer = gstinChanged ? null : next.gstinApplyAll;
  }
  const applyAll = gstinApplyAllFor(settings, next.gstin, scopeAnswer);
  if (applyAll !== next.gstinApplyAll) { next.gstinApplyAll = applyAll; changed = true; }

  for (const f of EDITABLE_TEXT_FIELDS) {
    if (!(f in p)) continue;
    let v: string | null;
    if (f === "date") {
      const d = clean(p[f]);
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { rejected.push(f); continue; }
      v = d;
    } else if (f === "piDate") {
      const d = clean(p[f]);
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) { rejected.push(f); continue; }
      v = d;
    } else if (f === "commodity") {
      v = clean(p[f]) ?? snapshot.commodity;
    } else {
      v = clean(p[f]);
    }
    if ((next as unknown as Record<string, unknown>)[f] !== v) { (next as unknown as Record<string, unknown>)[f] = v; changed = true; }
  }
  for (const f of EDITABLE_PARTY_FIELDS) {
    if (!(f in p)) continue;
    const v = partyOrNull(p[f]);
    if ((f === "buyer" || f === "consignee") && !v) { rejected.push(f); continue; }   // an invoice must name both
    if (JSON.stringify(next[f]) !== JSON.stringify(v)) {
      (next as unknown as Record<string, unknown>)[f] = v;
      changed = true;
      if (f === "buyer") totalsDirty = true;                    // the state code drives the tax
    }
  }
  if ("exchangeRate" in p) {
    const raw = p.exchangeRate;
    const v = raw === null || raw === undefined || raw === "" ? null : round4(toNumber(raw, 0));
    if (next.exchangeRate !== v) { next.exchangeRate = v; changed = true; }
  }
  if ("lines" in p) {
    if (!Array.isArray(p.lines)) rejected.push("lines");
    else {
      const lines = (p.lines as unknown[]).map((l, i) => sanitiseLine(l, i)).filter((l): l is DocLine => l !== null);
      if (JSON.stringify(lines) !== JSON.stringify(snapshot.lines)) { next.lines = lines; changed = true; totalsDirty = true; }
    }
  }
  return { snapshot: totalsDirty ? recomputeSnapshot(next, settings) : next, changed, rejected };
}

// ───────────────────── what an edit changed, for the order log ───────────────

/** A PATCH body key → the snapshot field it lands on (the row calls the
 *  invoice date `invoiceDate`; the snapshot calls it `date`). */
const SNAPSHOT_FIELD_FOR: Record<string, string> = { invoiceDate: "date" };

/**
 * The body keys whose snapshot value the patch ACTUALLY changed. The log used
 * to list the row columns written — `subtotal`, `igst`, `grandTotal`, derived
 * on every edit — which named nothing the clerk typed and never a GSTIN or a
 * bank switch. Compared against the stored snapshot with its extras filled in,
 * so a pre-answer row does not report "gstin changed" for a default it always
 * had.
 */
export function patchedSnapshotFields(
  body: Record<string, unknown> | null | undefined,
  before: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>,
  after: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>,
): string[] {
  if (!body || typeof body !== "object") return [];
  const b = { ...before, ...snapshotExtras(before) } as unknown as Record<string, unknown>;
  const a = { ...after, ...snapshotExtras(after) } as unknown as Record<string, unknown>;
  return Object.keys(body).filter((k) => {
    const f = SNAPSHOT_FIELD_FOR[k] ?? k;
    return f in a && JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null);
  });
}

/** PATCH body keys that land ONLY on the invoice row — the snapshot has no
 *  such field, so patchedSnapshotFields cannot see them and the log would
 *  otherwise never name an LR number or a re-pointed packing list. */
export const ROW_ONLY_PATCH_FIELDS = ["lrNo", "ewayBillNo", "packingListId"] as const;

/**
 * Everything one PATCH touched, in the order the body named it: the snapshot
 * fields it actually changed plus the row-only columns it wrote. This is what
 * `invoice_edited` reports. The old payload listed the columns UPDATE wrote —
 * `subtotal`, `igst`, `grandTotal`, re-derived on every edit — so a clerk
 * switching the invoice to the sister company's GSTIN logged "fields:
 * [subtotal, igst, grandTotal]" and the registration change vanished.
 */
export function patchedInvoiceFields(
  body: Record<string, unknown> | null | undefined,
  before: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>,
  after: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>,
): string[] {
  if (!body || typeof body !== "object") return [];
  const snap = new Set(patchedSnapshotFields(body, before, after));
  const rowOnly: readonly string[] = ROW_ONLY_PATCH_FIELDS;
  return Object.keys(body).filter((k) => snap.has(k) || rowOnly.includes(k));
}

export type Change<T> = { from: T; to: T };
export interface RegistrationChange {
  gstin?: Change<string>;
  gstinLabel?: Change<string | null>;
  bankKey?: Change<BankKey>;
  /** Round two, answer 19 — how far the registration reaches is part of the
   *  registration decision, so the log carries it beside the GSTIN itself. */
  gstinApplyAll?: Change<boolean>;
}

/**
 * How the GSTIN (answer 21) and the bank (answer 23) moved in an edit, or null
 * when neither did. These two are what an auditor reading the order log wants
 * to see by value — a tax document re-registered under the sister company is
 * not "fields: [gstin]", it is 33AALCP… → 33AAFCP….
 */
export function registrationChanges(
  before: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>,
  after: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>,
): RegistrationChange | null {
  const b = snapshotExtras(before);
  const a = snapshotExtras(after);
  const out: RegistrationChange = {};
  if (a.gstin !== b.gstin) out.gstin = { from: b.gstin, to: a.gstin };
  if (a.gstinLabel !== b.gstinLabel) out.gstinLabel = { from: b.gstinLabel, to: a.gstinLabel };
  if (a.bankKey !== b.bankKey) out.bankKey = { from: b.bankKey, to: a.bankKey };
  if (a.gstinApplyAll !== b.gstinApplyAll) out.gstinApplyAll = { from: b.gstinApplyAll, to: a.gstinApplyAll };
  return Object.keys(out).length ? out : null;
}

/** How the workbook scope reads in a log line (round two, answer 19). */
export function gstinScopeWord(applyAll: boolean): string {
  return applyAll ? "every sheet" : "this invoice only";
}

/** The log line's tail for a registration change: "GSTIN 33A… → 33B… (label)", "bank export → domestic". */
export function registrationChangeNote(c: RegistrationChange | null | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.gstin || c.gstinLabel) {
    const from = gstinWithLabel(c.gstin?.from ?? null, c.gstinLabel?.from ?? null);
    const to = gstinWithLabel(c.gstin?.to ?? null, c.gstinLabel?.to ?? null);
    parts.push(`GSTIN ${from || "—"} → ${to || "—"}`);
  }
  if (c.gstinApplyAll) parts.push(`workbook ${gstinScopeWord(c.gstinApplyAll.from)} → ${gstinScopeWord(c.gstinApplyAll.to)}`);
  if (c.bankKey) parts.push(`bank ${c.bankKey.from} → ${c.bankKey.to}`);
  return parts.join("; ");
}

// ────────── what the SAVED export form overrides (answers 21, 23) ────────────

/**
 * The two workbook root cells that carry the invoice's registration: the
 * exporter GSTIN line (Invoice!J8) and the bank name (Invoice!G27). Spelled
 * out here rather than imported from export-workbook/mapping.ts so the order
 * screen does not pull 1,500 lines of cell map into the browser bundle;
 * tests/commercialExportWorkbook.test.ts asserts both keys still exist there.
 */
export const EXPORT_ROOT_GSTIN_KEY = "exporterGstinText";
export const EXPORT_ROOT_BANK_KEY = "bankName";

/**
 * The three GSTIN cells the SCOPE answer governs (round two, answer 19): the
 * packing list, the customer's copy of it and the Annexure C1 form. They carry
 * the chosen registration only on a "every sheet" answer; on "this invoice
 * only" they stay on the company's own. Mirrors export-workbook/mapping.ts's
 * GSTIN_OTHER_SHEET_ROOT_KEYS — spelled out here for the same reason the two
 * keys above are, and tests/commercialExportWorkbook.test.ts holds the two
 * lists to the same three keys.
 */
export const EXPORT_ROOT_SHEET_GSTIN_CELLS: ReadonlyArray<{ key: string; sheet: string }> = [
  { key: "plGstin", sheet: "the packing list" },
  { key: "custPlGstin", sheet: "the customer's copy" },
  { key: "c1Gstin", sheet: "Annexure C1" },
];

export interface ExportRootOverride {
  /** the root cell's key in commercial_export_doc_set.rootVariables */
  key: string;
  /** the cell in words: "GSTIN", "bank", or "GSTIN on the packing list" */
  what: string;
  /** true for the three cells round two's answer 19 decides the content of */
  sheetGstin: boolean;
  /** what the invoice's own choice — and, for the three sheets, its SCOPE
   *  answer — says the cell should hold; i.e. what the form defaulted to */
  expected: string;
  /** what the saved form holds, and therefore what the workbook prints */
  saved: string;
}

const squashed = (v: unknown): string => printable(v).toUpperCase().replace(/\s+/g, " ");
const alnum = (v: unknown): string => printable(v).toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Where a SAVED export document set no longer agrees with the invoice it hangs
 * off. The form is prefilled from the snapshot, but every root cell is typed
 * over-able and the workbook prints the saved value — so the Documents tab
 * cannot assert "the workbook prints GSTIN X and the Y account" from the
 * snapshot alone. Returns [] when nothing is saved (roots null) or the cells
 * still match.
 *
 * `ownGstin` is the company's own registration — the first entry of the
 * clerk-readable choices route. It is needed for the three per-sheet cells and
 * only for them: on a "this invoice only" answer (round two, answer 19) those
 * sheets are expected to carry the company's own, which the snapshot cannot
 * supply because buildInvoiceSnapshot overwrites its company block with the
 * chosen registration. Without it those three are left unchecked rather than
 * guessed at — a wrong warning about a customs document is worse than none.
 */
export function exportRootOverrides(
  snapshot: (InvoiceSnapshot & Partial<InvoiceSnapshotExtras>) | null | undefined,
  roots: Record<string, unknown> | null | undefined,
  ownGstin?: string | null,
): ExportRootOverride[] {
  if (!snapshot || !roots || typeof roots !== "object") return [];
  const out: ExportRootOverride[] = [];
  const x = snapshotExtras(snapshot);

  // The cell prints "GSTIN NO: 33AALCP2750N1Z3 (label)", so the registration is
  // looked for INSIDE it: re-typed spacing, a dropped "NO:" or an added label
  // is a wording change, not a different company.
  const savedGstin = roots[EXPORT_ROOT_GSTIN_KEY];
  if (x.gstin && savedGstin !== undefined && !alnum(savedGstin).includes(alnum(x.gstin))) {
    out.push({
      key: EXPORT_ROOT_GSTIN_KEY, what: "GSTIN", sheetGstin: false,
      expected: gstinWithLabel(x.gstin, x.gstinLabel),
      saved: printable(savedGstin),
    });
  }

  // Round two, answer 19. The scope decides what the OTHER three GSTIN cells
  // were prefilled with — the chosen registration on "every sheet", the
  // company's own on "this invoice only" — and a hand that typed over one of
  // them is exactly the case the tab's scope sentence would otherwise state as
  // fact. Same containment test as above: label and wording are free.
  const sheetExpected = x.gstinApplyAll ? x.gstin : printable(ownGstin);
  const sheetShown = x.gstinApplyAll ? gstinWithLabel(x.gstin, x.gstinLabel) : printable(ownGstin);
  if (sheetExpected) {
    for (const cell of EXPORT_ROOT_SHEET_GSTIN_CELLS) {
      const saved = roots[cell.key];
      if (saved === undefined || alnum(saved).includes(alnum(sheetExpected))) continue;
      out.push({
        key: cell.key, what: `GSTIN on ${cell.sheet}`, sheetGstin: true,
        expected: sheetShown, saved: printable(saved),
      });
    }
  }

  const bankOnInvoice = printable(snapshot.bank?.name);
  const savedBank = roots[EXPORT_ROOT_BANK_KEY];
  if (savedBank !== undefined && squashed(savedBank) !== squashed(bankOnInvoice)) {
    out.push({ key: EXPORT_ROOT_BANK_KEY, what: "bank", sheetGstin: false, expected: bankOnInvoice, saved: printable(savedBank) });
  }
  return out;
}

/**
 * "the packing list and Annexure C1" — the sheets whose GSTIN cell the saved
 * form overrides, for the sentence that would otherwise state the scope as
 * fact. Null when the saved form leaves all three alone.
 */
export function overriddenSheetsNote(overrides: ReadonlyArray<ExportRootOverride>): string | null {
  const sheets = (overrides ?? []).filter((o) => o.sheetGstin)
    .map((o) => EXPORT_ROOT_SHEET_GSTIN_CELLS.find((c) => c.key === o.key)?.sheet ?? o.what);
  if (sheets.length === 0) return null;
  if (sheets.length === 1) return sheets[0];
  return `${sheets.slice(0, -1).join(", ")} and ${sheets[sheets.length - 1]}`;
}

/**
 * The figure a SCREEN shows for an invoice's grand total (and subtotal).
 *
 * `commercial_invoice.grand_total` is NUMERIC(16,2) while an export document
 * carries three decimals: a USD 17,324.657 invoice comes back out of that
 * column as 17,324.66, and the register printed 17,324.660 beside a PDF that
 * said .657. The snapshot is the document, so the snapshot's figure is the one
 * to show; the column is the fallback for a row written without one.
 *
 * `grandTotalExact` is what the register route carries in place of the whole
 * snapshot blob.
 */
export function displayGrandTotal(row: { grandTotal?: number | null; grandTotalExact?: number | null; snapshot?: { grandTotal?: number | null } | null } | null | undefined): number | null {
  const snap = row?.snapshot?.grandTotal;
  if (typeof snap === "number" && Number.isFinite(snap)) return snap;
  const exact = row?.grandTotalExact;
  if (typeof exact === "number" && Number.isFinite(exact)) return exact;
  const col = row?.grandTotal;
  return typeof col === "number" && Number.isFinite(col) ? col : null;
}

/** The same for the subtotal, whose column is NUMERIC(16,3) but which the
 *  snapshot still owns — one rule for both, so a screen cannot mix them. */
export function displaySubtotal(row: { subtotal?: number | null; subtotalExact?: number | null; snapshot?: { subtotal?: number | null } | null } | null | undefined): number | null {
  const snap = row?.snapshot?.subtotal;
  if (typeof snap === "number" && Number.isFinite(snap)) return snap;
  const exact = row?.subtotalExact;
  if (typeof exact === "number" && Number.isFinite(exact)) return exact;
  const col = row?.subtotal;
  return typeof col === "number" && Number.isFinite(col) ? col : null;
}

/** The columns the invoice ROW keeps in step with the snapshot after any edit. */
export function rowTotalsFromSnapshot(s: InvoiceSnapshot): Record<string, number | string | null> {
  return {
    subtotal: s.subtotal,
    taxType: s.taxType,
    taxRate: s.taxRate,
    igst: s.igst,
    cgst: s.cgst,
    sgst: s.sgst,
    roundOff: s.roundOff,
    grandTotal: s.grandTotal,
    amountInWords: s.amountInWords,
  };
}

// ───────────────────────────── list filters ──────────────────────────────────

export interface InvoicesFilter {
  kind?: string | null;
  status?: string | null;
  orderId?: string | null;
  from?: string | null;      // YYYY-MM-DD
  to?: string | null;        // YYYY-MM-DD
  q?: string | null;
}

function dateOrNull(v: unknown): Date | null {
  const m = printable(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The register's filters as a Prisma where. `q` matches the invoice number,
 * the order number or the client's name. An unknown kind or status is ignored
 * rather than sent to Postgres as an invalid enum.
 */
export function invoicesWhere(f: InvoicesFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const kind = printable(f.kind).toUpperCase();
  if (INVOICE_KINDS.includes(kind as InvoiceKind)) where.kind = kind;
  const statuses = printable(f.status).split(",").map((s) => s.trim().toUpperCase()).filter((s) => INVOICE_STATUSES.includes(s as InvoiceStatus));
  if (statuses.length === 1) where.status = statuses[0];
  else if (statuses.length > 1) where.status = { in: statuses };
  const orderId = printable(f.orderId);
  if (orderId) where.orderId = orderId;
  const from = dateOrNull(f.from);
  const to = dateOrNull(f.to);
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.invoiceDate = range;
  }
  const q = printable(f.q);
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { order: { number: { contains: q, mode: "insensitive" } } },
      { order: { client: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

/** Page arithmetic for every list: page ≥ 1, limit 1..500, default 1 / 50. */
export function pageArgs(page: unknown, limit: unknown): { page: number; limit: number; skip: number; take: number } {
  const p = Math.max(1, Math.trunc(toNumber(page, 1) || 1));
  const l = Math.min(500, Math.max(1, Math.trunc(toNumber(limit, 50) || 50)));
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}
