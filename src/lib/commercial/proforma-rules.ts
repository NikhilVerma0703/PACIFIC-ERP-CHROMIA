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
import { canEnter } from "./stages.ts";
import {
  gstinChoices, sellerEntity, parseSellerKey, DEFAULT_SELLER_KEY,
  type BankDetails, type CommercialSettings, type GstinChoice,
} from "./settings-defaults.ts";
import type { AreaAccess } from "./access-rules.ts";
import type { DocLine, Party, ProformaSnapshot } from "./types.ts";

// ───────────────────────────── the PI's own choices ──────────────────────────

/** Which of the two accounts in settings.banks the PI prints (answer 23). */
export type BankKey = "export" | "domestic";
export const BANK_KEYS: readonly BankKey[] = ["export", "domestic"];

/**
 * The snapshot as THIS module writes it. types.ts ProformaSnapshot now carries
 * the two choices answers 21 and 23 put on a PI (bankKey, gstinKey — optional,
 * because PIs frozen before 2026-09-07 have neither; readers fall back to the
 * kind's default bank and the company's own GSTIN) and the `revises` link of
 * answer 24, so this is the same type under the name the PI code has always
 * used. Kept as an alias so the routes, the PDF and the tests keep one name.
 */
export type PiSnapshot = ProformaSnapshot;

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
  /** The salesperson this order's PI is raised for (scripts/0084). Read here
   *  and nowhere else: it is the ORDER's column, not the PI's, so every PI of
   *  an order — including a revision — names the same person, and the PI's own
   *  copy is frozen the moment the draft is built. */
  salespersonName?: string | null;
  /** WHICH GROUP COMPANY SELLS THIS ORDER (scripts/0085). Read here and
   *  nowhere else, for the same reason the salesperson is: it is the ORDER's
   *  column, so every proforma of one order — a revision included — goes out
   *  under one company, and the PI's own copy is frozen the moment the draft
   *  is built. NULL, blank, or a key this build does not know all mean the
   *  default seller, Pacific. */
  sellerKey?: string | null;
  client?: SnapshotClientInput | null;
  items?: SnapshotItemInput[] | null;
}

export interface SnapshotOptions {
  /** The PI's own number, from the proforma counter (answers 5, 8, 24) —
   *  never the order's number. */
  number: string;
  /** The order's n-th PI (0 first). An ordinal for the tab's ordering and the
   *  row's unique key; it is NOT part of the number and never prints. */
  revision: number;
  /** YYYY-MM-DD; the PI's printed date. */
  date: string;
  validUntil?: string | null;
  deliveryDate?: string | null;
  /**
   * The Terms & Conditions box, TYPED BY A HUMAN and by nothing else (owner,
   * 2026-09-15). The route passes what the clerk wrote in the box and nothing
   * it worked out for itself; absent or blank means the PI prints an empty
   * Terms & Conditions box, which is a correct printed document. There is
   * deliberately no fallback here — see buildProformaSnapshot.
   */
  notes?: string | null;
  /** Defaults by kind when absent (answer 23). */
  bankKey?: BankKey | null;
  /** Defaults to the company's own registration when absent (answer 21). */
  gstinKey?: string | null;
  revises?: { id: string; number: string } | null;
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

/**
 * THREE DECIMALS WHEN THE THIRD SAYS SOMETHING, TWO WHEN IT DOES NOT.
 *
 * Both of the customer's own reference proformas are matched by this one rule
 * and neither is matched by a flat toFixed(3). SAL-ORD/25-26/01718, the
 * document Monolith sent back on 2026-09-15, prints 1052.24, 12889.94 and a
 * total of 51559.76; SAL-ORD/26-27/01642 prints 3208.273 and 17324.657, where
 * the third decimal is real. Padding everything to three put a trailing zero on
 * every figure of the first — "51559.760" against their "51559.76" — on a
 * document the owner asked to match exactly.
 *
 * Never fewer than two: money with one decimal reads as a typo, and a quantity
 * is money here because it is multiplied by a rate on the same line.
 */
function fixedTrim(n: number): string {
  const s = n.toFixed(3);
  return s.endsWith("0") ? s.slice(0, -1) : s;
}

export function fmtQty(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : fixedTrim(n);
}
export function fmtAmount(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : fixedTrim(n);
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

/**
 * The PI's validity: issue day + settings.piValidityDays, as YYYY-MM-DD — or
 * null when the setting is 0, which is "valid forever" (answer 24). Null, not
 * the issue day: a PI that "expired" the day it was issued would be refused
 * by every customer's accounts department.
 */
export function validUntilFor(issuedAt: Date, validityDays: number): string | null {
  const days = Math.round(Number(validityDays));
  if (!Number.isFinite(days) || days <= 0) return null;
  const d = new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** "SAL-ORD/26-27/N3" → "SAL-ORD-26-27-N3.pdf" (a slash cannot be a filename). */
export function piFilename(number: string): string {
  const safe = printable(number).replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "proforma";
  return `${safe}.pdf`;
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

/** Answer 23: "ICICI on domestic, Kotak on international" — the default the
 *  dropdown opens on. */
export function defaultBankKey(kind: string): BankKey {
  return kind === "DOMESTIC" ? "domestic" : "export";
}

/** A bank key from a request body; anything that is not one of the two is
 *  null so a typo falls back to the kind's default rather than to a blank
 *  bank block on the customer's paper. */
export function parseBankKey(raw: unknown): BankKey | null {
  const s = printable(raw).toLowerCase();
  return (BANK_KEYS as string[]).includes(s) ? (s as BankKey) : null;
}

/**
 * The account a PI prints. The default seller is paid into
 * settings.banks[bankKey] exactly as it always has been (answer 23: Kotak on
 * export, ICICI on domestic); a seller that carries a bank of its OWN is paid
 * into that one whatever the order's kind, because one account per company is
 * the ordinary case and the export/domestic pair is Pacific's arrangement
 * rather than a rule about banking.
 *
 * `sellerKey` is optional and its absence means the default seller, so every
 * call written before there was a second company — and every test pinning the
 * two Indian accounts — keeps its meaning to the letter.
 */
export function piBank(settings: CommercialSettings, bankKey: BankKey, sellerKey?: string | null): BankDetails {
  return sellerEntity(settings, sellerKey).entity.bank ?? settings.banks[bankKey];
}

/** The bank as the snapshot freezes it — a copy, so a later edit in Settings
 *  cannot change a PI the customer already holds. The optional keys are left
 *  OUT when the account has none (ICICI has no AD code or routing bank) rather
 *  than written as undefined: JSON drops undefined, so the snapshot in memory
 *  must already be the snapshot the Json column will hold. */
export function bankBlock(bank: BankDetails): ProformaSnapshot["bank"] {
  const block: ProformaSnapshot["bank"] = {
    name: bank.name,
    address: bank.address,
    accountNo: bank.accountNo,
    ifsc: bank.ifsc,
    swift: bank.swift,
  };
  if (bank.adCode) block.adCode = bank.adCode;
  if (bank.routingBank) block.routingBank = bank.routingBank;
  if (bank.routingSwift) block.routingSwift = bank.routingSwift;
  // The rest of the wire route and the whole ACH route, on the accounts that
  // have them — the same "absent rather than undefined" discipline, and the
  // ACH route copied as a NEW object so a later edit in Settings cannot reach
  // inside a snapshot the customer already holds.
  if (bank.routingAccountNo) block.routingAccountNo = bank.routingAccountNo;
  if (bank.ach && (bank.ach.routingNo || bank.ach.accountNo)) {
    block.ach = { bank: bank.ach.bank, routingNo: bank.ach.routingNo, accountNo: bank.ach.accountNo };
  }
  return block;
}

/**
 * What the PI tab's two dropdowns offer (answers 21, 23), shaped for a screen.
 * Served by GET /proformas/choices under the "view" gate: the settings route
 * itself is admin-only, and a Commercial clerk who cannot see Settings still
 * has to choose the bank and the GSTIN before issuing. Only the labels leave
 * the server — the account numbers print from the frozen snapshot, not from
 * anything this returns.
 */
export interface PiChoices {
  banks: Array<{ key: BankKey; label: string }>;
  gstins: GstinChoice[];
  /** 0 = valid forever (answer 24); the tab says so beside the issue button. */
  piValidityDays: number;
  /**
   * What THIS login may do in the proforma area — the same `areaAccessFor`
   * answer commercialGate("write", "proforma") will give the PI routes.
   *
   * Round two, answers 1 and 2 split the desk: Raghav and Murali hold the
   * write ACTION for their own screens and only READ proformas. The order
   * workspace hands its tabs `actions` alone (OrderTabProps), which cannot
   * tell those two apart from Setumani — so the tab reads the area's own
   * answer off this payload and disables Issue / Accept / Revise / Create
   * draft WITH THE REASON, rather than offering writes the route will 403.
   */
  access: AreaAccess;
}

export function piChoices(settings: CommercialSettings, access: AreaAccess): PiChoices {
  return {
    banks: BANK_KEYS.map((key) => ({ key, label: `${settings.banks[key].name} (${key})` })),
    gstins: gstinChoices(settings.company),
    piValidityDays: Math.max(0, Math.round(Number(settings.piValidityDays)) || 0),
    access,
  };
}

/** What the tab says beside a PI write it cannot offer (answers 1, 2). */
export const PI_NO_WRITE_ACTION_HINT = "Your login can read this order but not write to it";
export const PI_READ_ONLY_HINT = "Your login reads proforma invoices — the Commercial Executive or Manager builds and issues them";

/**
 * Why the PI tab must refuse every write on it, or null when it may offer
 * them. DESIGN.md §9: a refused action is DISABLED WITH ITS REASON, never
 * hidden, so this returns the sentence the button carries rather than a
 * boolean.
 *
 * Two questions, the same two commercialGate("write", "proforma") asks: does
 * this login write at all, and does it write HERE (answers 1 and 2 split the
 * desk, so the second is now the one that usually decides). `access` is null
 * while GET /proformas/choices is still in flight or after it failed: the tab
 * offers the buttons then and the route is the authority — a control that
 * greys itself on a network hiccup is the hiding this rule exists to stop.
 */
export function piWriteRefusal(actions: readonly string[], access: AreaAccess | null | undefined): string | null {
  if (!actions.includes("write")) return PI_NO_WRITE_ACTION_HINT;
  if (access === "view" || access === "none") return PI_READ_ONLY_HINT;
  return null;
}

/**
 * The registration a PI is issued under (answer 21): the chosen one when it
 * is on the settings list, else the company's own. An unknown key is not an
 * error — a GSTIN that was on the list when the draft was built and has
 * since been removed from Settings must not print as a blank.
 */
export function gstinChoiceFor(settings: CommercialSettings, gstinKey: string | null | undefined): GstinChoice {
  const choices = gstinChoices(settings.company);
  const key = printable(gstinKey).toUpperCase();
  return choices.find((c) => c.gstin === key) ?? choices[0];
}

// ───────────────────────────── which company is selling ─────────────────────
// The owner, 2026-09-15: "Im supposed to make a PI from monolith to M&G
// imports. Nothing related to pacific surfaces." A second company sells now —
// MONOLITH SURFACES INC, the group's US subsidiary, selling to a US buyer
// inside the United States — and its proforma is not Pacific's proforma with a
// different name at the top: it is a US invoice, with none of the Indian
// export block on it.
//
// EVERY DECISION THAT DEPENDS ON THE SELLER IS IN THIS SECTION, and every one
// of them reads an absent, blank or unknown key as the default seller. That is
// not leniency, it is the rule scripts/0085 wrote down: the column is
// nullable, NULL means Pacific, and every order and every proforma that
// predates the column must go on printing exactly as it did.

/** The seller as a frozen snapshot carries it. */
export type PiSellerBlock = NonNullable<ProformaSnapshot["seller"]>;

/**
 * The descriptor a DRAFT freezes for a seller key — the key for the record,
 * the label for the screens, and the one fact the layout asks.
 *
 * `indianExporter` reads a MISSING flag as true, so a settings object built by
 * hand without the seller list still describes Pacific the way this whole
 * module did before the list existed. A second seller cannot reach that path:
 * the flag is required on SellingEntity, so leaving it off a new entity is a
 * compile error rather than a US invoice that quietly prints a GSTIN.
 */
export function piSellerFrom(settings: CommercialSettings, key: unknown): PiSellerBlock {
  const { key: resolved, entity } = sellerEntity(settings, key);
  return { key: resolved, label: entity?.label ?? resolved, indianExporter: entity?.indianExporter !== false };
}

/**
 * The seller a FROZEN snapshot was printed under. An absent block is the
 * default seller — every PI frozen before 2026-09-15 has none — and its label
 * is the legal name that snapshot already carries, which on those PIs is
 * Pacific's own. Read the seller through this and never off `snapshot.seller`
 * directly, so the absence rule is stated in one place.
 */
export function piSeller(s: PiSnapshot): PiSellerBlock {
  const frozen = s.seller;
  const fallbackLabel = printable(s.company?.legalName);
  if (frozen && printable(frozen.key)) {
    return {
      key: printable(frozen.key),
      label: printable(frozen.label) || fallbackLabel,
      indianExporter: frozen.indianExporter !== false,
    };
  }
  return { key: DEFAULT_SELLER_KEY, label: fallbackLabel, indianExporter: true };
}

/**
 * Does this PI print the INDIAN EXPORT BLOCK — the GSTIN, the RBI code number,
 * the jurisdictional customs office, the AD code on the bank, and the "goods
 * of Indian Origin" declaration?
 *
 * The question is asked of the SELLER and not of whether those fields happen
 * to be blank. An admin who empties the RBI code in Settings has made a
 * mistake on a Pacific PI and should see the empty box he made; a US company
 * selling inside the US has no RBI code to empty, and its paper must not carry
 * the label at all. Two different things, and only the seller tells them apart.
 */
export function printsIndianBlock(s: PiSnapshot): boolean {
  return piSeller(s).indianExporter;
}

/**
 * The bank line the PI tab's detail block shows: the account the proforma was
 * frozen with, and — only where the key means something — which of the two
 * slots in Settings that account was chosen from.
 *
 * EVERY snapshot carries an export/domestic key, whoever sold, and that is
 * deliberate: a revision of a PI whose order has been moved back to Pacific
 * needs a key to pick one of the two Indian accounts with, which is why
 * carriedIntoRevision keeps it while carrying no seller at all. But piBank
 * ignores that key the moment the seller has an account of its own, so on a
 * Monolith proforma the key names a slot the paper was never paid into.
 * Printed beside Monolith's New York account it labels a US account with the
 * name of one of Pacific's two INDIAN ones — and on a domestic order it does
 * it with Pacific's own ICICI account, two different ICICI accounts one tagged
 * with the other's slot, which is the reading a person could believe. So the
 * key stays on the snapshot, where the revision path needs it, and simply is
 * not shown where it says nothing true.
 *
 * Blank when the snapshot froze no bank name at all, so the screen's own dash
 * stands rather than a slot name in brackets with nothing in front of it.
 */
export function piBankLine(s: PiSnapshot): string {
  const name = printable(s.bank?.name);
  if (!name) return "";
  const slot = printsIndianBlock(s) ? printable(s.bankKey) : "";
  return slot ? `${name} (${slot})` : name;
}

/**
 * Whether the export/domestic key on a frozen snapshot NAMES the account that
 * proforma was paid into — the same question piBankLine asks, for the prose
 * anywhere else that credits a PI with a bank.
 *
 * The invoice a live PI lends its key to is the caller this exists for. That
 * invoice really is drawn on settings.banks[bankKey], because the invoice
 * module has one seller and prints Pacific's account whoever sold, so its log
 * note must go on naming the slot; what the note may not say is that the
 * proforma asked to be paid into it, which a Monolith proforma never did.
 */
export function piOwnsBankKey(s: PiSnapshot | null | undefined): boolean {
  if (!s || !printable(s.bankKey)) return false;
  return printsIndianBlock(s);
}

/** One entry of either of the PI tab's two draft dropdowns. */
export interface PiSelectOption {
  value: string;
  label: string;
}

/** What the GSTIN box offers on a proforma that has no registration to name,
 *  and what the bank box falls back to when the snapshot froze no bank name. */
export const PI_NO_GSTIN_OPTION = "None — this PI prints no GSTIN";
export const PI_SELLER_BANK_OPTION = "The seller's own account";

// THE TWO DRAFT DROPDOWNS' OPTIONS, FOR THE PROFORMA IN HAND.
//
// GET /proformas/choices is not seller-aware and is not going to become so: it
// serves what Settings holds — Pacific's two accounts and the registrations on
// the company master. On a proforma whose seller is NOT an Indian exporter
// neither list holds an entry that means what the draft holds. The GSTIN is
// null, because none prints at all; the bank key is the order kind's default,
// a slot naming an account this paper is not paid into.
//
// A <select> handed a value no option carries does not show a blank — React
// leaves the first enabled option selected — so both boxes would state
// Pacific's registration and Pacific's bank directly above the hint explaining
// that neither prints on this PI, on the one document the owner asked that
// Pacific appear nowhere on. The paper was always right (piGstinFor drops the
// posted choice); the screen was stating the opposite of the rule beneath it.
//
// So for such a proforma each list is ONE entry carrying exactly the value the
// form holds, labelled with what is true. Nothing is hidden: the box stays on
// screen, greyed, with its reason beside it (DESIGN.md §9). It just stops
// naming a company that is not selling.
//
// A snapshot of null — no draft is open — and a proforma frozen before the
// seller existed both take the lists whole, because absent means Pacific.

export function piBankOptions(s: PiSnapshot | null | undefined, banks: readonly PiSelectOption[], current: string): PiSelectOption[] {
  if (s && !printsIndianBlock(s)) return [{ value: current, label: printable(s.bank?.name) || PI_SELLER_BANK_OPTION }];
  return banks.map((b) => ({ value: b.value, label: b.label }));
}

export function piGstinOptions(s: PiSnapshot | null | undefined, gstins: readonly GstinChoice[], current: string): PiSelectOption[] {
  if (s && !printsIndianBlock(s)) return [{ value: current, label: PI_NO_GSTIN_OPTION }];
  // Until the choices land the box offers only what the draft already carries,
  // exactly as it did before there was a second seller.
  return gstins.length
    ? gstins.map((c) => ({ value: c.gstin, label: `${c.gstin} — ${c.label}` }))
    : [{ value: current, label: current || "Company GSTIN" }];
}

/** The identity a seller prints. The default seller IS the company master —
 *  not a copy of it — so correcting the address in Settings corrects it on
 *  every document, proformas included, exactly as before. */
export function sellerIdentity(settings: CommercialSettings, sellerKey?: string | null): {
  legalName: string; addressLines: string[]; country: string; email: string; phone: string;
} {
  const { key, entity } = sellerEntity(settings, sellerKey);
  const c = settings.company;
  if (key === DEFAULT_SELLER_KEY) {
    return {
      legalName: c.legalName,
      addressLines: [...c.addressLines],
      country: settings.defaults.countryOfOrigin || "India",
      email: c.email,
      phone: c.phone,
    };
  }
  return {
    legalName: entity.legalName ?? "",
    addressLines: [...(entity.addressLines ?? [])],
    country: entity.country ?? "",
    email: entity.email ?? "",
    phone: entity.phone ?? "",
  };
}

/**
 * The registration this PI is issued under (answer 21) — or NULL when the
 * seller is not an Indian exporter, because there is then nothing of the kind
 * to choose and the GSTIN must be absent from the paper rather than blank on
 * it. Every place that used to call gstinChoiceFor on the way into a snapshot
 * asks this instead, so a Monolith PI cannot be stamped with Pacific's
 * registration by a route that simply forgot.
 */
export function piGstinFor(settings: CommercialSettings, sellerKey: string | null | undefined, gstinKey: string | null | undefined): GstinChoice | null {
  const { entity } = sellerEntity(settings, sellerKey);
  return entity?.indianExporter !== false ? gstinChoiceFor(settings, gstinKey) : null;
}

/** The `company` block the snapshot freezes: who sold, and the three Indian
 *  registrations that print beside the invoice's own facts — every one of them
 *  empty for a seller that is not an Indian exporter, so the snapshot alone is
 *  enough to know that none of them may be printed. */
export function sellerCompanyBlock(settings: CommercialSettings, sellerKey: string | null | undefined, gstin: string | null): ProformaSnapshot["company"] {
  const { entity } = sellerEntity(settings, sellerKey);
  const indian = entity?.indianExporter !== false;
  const id = sellerIdentity(settings, sellerKey);
  return {
    legalName: id.legalName,
    addressLines: [...id.addressLines],
    gstin: printable(gstin),
    rbiCode: indian ? settings.company.rbiCode : "",
    customsOffice: indian ? settings.company.customsOffice : "",
  };
}

/** The declaration under the totals. The Indian-origin certificate is a
 *  statement only an Indian exporter can make, so a seller that is not one
 *  prints no declaration at all — not a heading with nothing under it. There
 *  is no US wording to put in its place: the owner gave none, and writing a
 *  certification for somebody else to sign is not ours to do. */
export function piDeclarationFor(settings: CommercialSettings, sellerKey?: string | null): string {
  const { entity } = sellerEntity(settings, sellerKey);
  return entity?.indianExporter !== false ? settings.texts.piDeclaration : "";
}

/**
 * The seller as the PI's "Exporter" cell prints it.
 *
 * The signature grew a THIRD argument rather than changing its first two: the
 * default seller's block — name, address, country, telephone, email, GSTIN and
 * state code, in that order and out of those exact settings — is the one this
 * function has always returned, and every existing caller and test keeps
 * asking for it by asking for nothing.
 *
 * A seller that is not an Indian exporter carries no GSTIN and no GST state
 * code, whatever was chosen on the draft: a state code is the first two digits
 * of a GSTIN, so one printed without the other states nothing true.
 */
export function exporterParty(settings: CommercialSettings, gstin?: string | null, sellerKey?: string | null): Party {
  const { key, entity } = sellerEntity(settings, sellerKey);
  const c = settings.company;
  if (key === DEFAULT_SELLER_KEY) {
    return {
      name: c.legalName,
      lines: [...c.addressLines],
      country: settings.defaults.countryOfOrigin || "India",
      tel: c.phone || null,
      email: c.email || null,
      gstin: clean(gstin) ?? c.gstin ?? null,
      stateCode: c.stateCode || null,
      code: null,
    };
  }
  const id = sellerIdentity(settings, key);
  return {
    name: id.legalName,
    lines: [...id.addressLines],
    country: id.country || null,
    tel: clean(id.phone),
    email: clean(id.email),
    gstin: entity.indianExporter ? clean(gstin) : null,
    stateCode: null,
    code: null,
  };
}

function sameParty(a: Party | null, b: Party | null): boolean {
  if (!a || !b) return false;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

// ───────────────────────────── the snapshot ──────────────────────────────────

/**
 * Freeze an order into what the PI prints. Number: the PI's own (opts.number,
 * from the proforma counter — answer 24 made it distinct from the order's).
 * Bank: the chosen key, else the kind's default (answer 23). GSTIN: the chosen
 * registration, else the company's own (answer 21). Consignee: the order's,
 * else the client's shipping address, else the client master. Notify: the
 * order's, else the client's. Buyer if not consignee: the order's, else
 * bill-to when it is a different party.
 *
 * TWO FIELDS HAVE NO FALLBACK AT ALL, and that is the rule rather than an
 * omission (owner, 2026-09-15):
 *
 *  * `notes` — the Terms & Conditions box — is opts.notes, which is what a
 *    human typed, or null. Nothing on the order may be derived into it. The
 *    owner found "25 ton container" printed there and asked for the box to
 *    carry only what someone deliberately wrote, so a container size, a
 *    tonnage, a gross or net weight, a packing note or a stuffing instruction
 *    must never be composed into this field from the order, the packing list
 *    or the settings. A blank box is the correct printed answer: the box is
 *    labelled and still prints, empty, the way the customer's reference PI
 *    shows it.
 * The SELLER is the order's too (scripts/0085), and is frozen here for the
 * same reason and with a sharper edge: it decides the identity at the top of
 * the paper, the bank at the bottom, and whether the Indian export block is on
 * it at all. Reading it at draft time means a proforma printed a year from now
 * is the document that was issued, even if the order is later moved to another
 * company; and because the key comes off the ORDER, every proforma of one
 * order — revisions included — goes out under one company.
 *
 *  * `salespersonName` is the ORDER's column and only that (scripts/0084). It
 *    is emphatically NOT the login that typed the PI: the desk types it, the
 *    salesperson owns the customer, and on a domestic order those are two
 *    different people — falling back to the stamp would print the desk's own
 *    name and answer nobody's question. Frozen here so a printed PI keeps the
 *    name it carried when the order is later reassigned. An export order may
 *    carry one; piSalesperson simply does not print it.
 */
export function buildProformaSnapshot(order: SnapshotOrderInput, settings: CommercialSettings, opts: SnapshotOptions): PiSnapshot {
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
  // The seller is settled FIRST, because the bank, the registration, the
  // identity at the top and the declaration at the bottom all hang off it.
  const seller = piSellerFrom(settings, order.sellerKey);
  const bankKey = opts.bankKey ?? defaultBankKey(kind);
  const bank = piBank(settings, bankKey, seller.key);
  // Null for a seller that is not an Indian exporter — there is no
  // registration to choose and none may print (piGstinFor).
  const gstin = piGstinFor(settings, seller.key, opts.gstinKey);

  const base: PiSnapshot = {
    number: printable(opts.number),
    revision: Math.max(0, Math.round(opts.revision)),
    date: opts.date,
    deliveryDate: clean(opts.deliveryDate),
    validUntil: clean(opts.validUntil),
    kind,
    currency,
    buyerPoNo: clean(order.customerPoNumber),
    exporter: exporterParty(settings, gstin ? gstin.gstin : null, seller.key),
    consignee,
    notifyParty,
    buyerIfNotConsignee,
    countryOfOrigin: printable(order.countryOfOrigin) || settings.defaults.countryOfOrigin || "India",
    countryOfDestination: clean(order.countryOfDestination) ?? consignee.country ?? clean(client?.country) ?? (isExport ? null : "India"),
    deliveryTerms: clean(order.deliveryTerms) ?? clean(order.incoterm) ?? (isExport ? null : clean(settings.defaults.domesticDeliveryTerms)),
    paymentTerms: clean(order.paymentTerms) ?? (isExport ? clean(settings.defaults.exportPaymentTerms) : clean(settings.defaults.domesticPaymentTerms)),
    // THE INDIAN SHIPPING DEFAULTS BELONG TO THE INDIAN EXPORTER, and both of
    // them are asked of the SELLER as well as the kind. settings.defaults holds
    // Pacific's own shipping habits — "CHENNAI", "By Road" — and until this was
    // qualified they filled themselves in on a Monolith proforma whose order
    // had deliberately left them empty: a US company selling inside the US,
    // printing an Indian port of loading and an Indian pre-carriage leg it has
    // no part in. The owner's words were "nothing related to pacific surfaces",
    // and a default is exactly the kind of thing that puts it back quietly.
    //
    // What the order SAYS still prints, whoever sells: these goods do leave
    // from Chennai, and a clerk who types that on a Monolith order means it.
    // Only the silent fallback is withheld.
    preCarriageBy: clean(order.preCarriageBy) ?? (isExport && seller.indianExporter ? clean(settings.defaults.preCarriageBy) : null),
    placeOfReceipt: clean(order.placeOfReceipt),
    vessel: null,
    portOfLoading: clean(order.portOfLoading) ?? (isExport && seller.indianExporter ? clean(settings.defaults.portOfLoading) : null),
    portOfDischarge: clean(order.portOfDischarge),
    finalDestination: clean(order.finalDestination),
    lines,
    totalSlabs: 0,
    totalAmount: 0,
    amountInWords: "",
    grossWeight: null,
    netWeight: null,
    discount: 0,
    bankKey,
    bank: bankBlock(bank),
    gstinKey: gstin ? gstin.gstin : null,
    seller,
    company: sellerCompanyBlock(settings, seller.key, gstin ? gstin.gstin : null),
    declaration: piDeclarationFor(settings, seller.key),
    notes: clean(opts.notes),
    salespersonName: clean(order.salespersonName),
    revises: opts.revises ?? null,
  };
  return recomputeTotals(base);
}

// ───────────────────────────── draft edits ───────────────────────────────────

/**
 * Snapshot fields a DRAFT may have edited from the PI tab.
 *
 * `salespersonName` is here for the same reason every other name on this list
 * is: the order carries it, but the clerk building the paper must be able to
 * correct it on the draft without editing the order — the order was raised by
 * one desk and the PI is asked for by another (owner, 2026-09-15). It stays a
 * DRAFT edit like the rest: once the PI is issued the snapshot is the paper.
 */
export const EDITABLE_TEXT_FIELDS = [
  "date", "deliveryDate", "buyerPoNo", "deliveryTerms", "paymentTerms", "preCarriageBy", "placeOfReceipt",
  "vessel", "portOfLoading", "portOfDischarge", "finalDestination", "countryOfOrigin", "countryOfDestination",
  "grossWeight", "netWeight", "notes", "salespersonName",
] as const;
export const EDITABLE_PARTY_FIELDS = ["consignee", "notifyParty", "buyerIfNotConsignee"] as const;

/**
 * Apply a PATCH body to a draft snapshot: only the fields above, `discount`
 * (a number, never negative), `lines` (a full replacement array), and — when
 * the settings are passed — the two choices, `bankKey` (answer 23) and
 * `gstinKey` (answer 21), which re-freeze the bank block and the printed
 * GSTIN from Settings. Anything else — number, revision, totals, the bank
 * block itself — is ignored, and the totals and the words are re-derived
 * when lines or discount change. Returns a NEW snapshot and whether anything
 * changed.
 */
export function applyDraftPatch(snapshot: PiSnapshot, patch: unknown, settings?: CommercialSettings): { snapshot: PiSnapshot; changed: boolean } {
  // A snapshot frozen before 2026-09-15 has no `salespersonName` key at all,
  // and an absent key is NOBODY — not an edit. It is read with its default
  // here, before anything is compared, the way invoice-rules reads a row
  // written before its own extras existed.
  //
  // Without this the field would be the one member of EDITABLE_TEXT_FIELDS
  // whose comparison below is `undefined !== null`, because it is the one
  // member buildProformaSnapshot does not always write; every other one is on
  // every snapshot, as null at worst. The PI tab posts the field on EVERY save
  // (blank as null), so the first save of every draft already in the register
  // would report `changed` for a blank box nobody touched, and the PATCH route
  // — which keys both its write and its `pi_edited` event off that flag —
  // would rewrite the row and put "draft edited" on the order's timeline for
  // an edit that never happened. The write itself would store null over an
  // absent key and change nothing; the false line in the audit trail is the
  // damage, and a reader of that timeline years later cannot tell it apart
  // from a real one.
  const base: PiSnapshot = { ...snapshot, salespersonName: snapshot.salespersonName ?? null };
  if (typeof patch !== "object" || patch === null) return { snapshot: base, changed: false };
  const p = patch as Record<string, unknown>;
  const next: PiSnapshot = { ...base };
  let changed = false;
  let totalsDirty = false;

  // WHO IS SELLING IS NOT EDITABLE HERE, and its absence from the lists below
  // is deliberate (scripts/0085). The seller is the ORDER's column: it decides
  // the identity at the top of the paper, the account at the bottom and
  // whether the Indian block is on it at all, and letting a draft edit move it
  // would let two proformas of one order go out under two companies. To sell
  // an order under a different company, change the ORDER and build a fresh
  // draft. It is read here only so the two choices that DO re-freeze from
  // Settings re-freeze against the right company.
  const seller = piSeller(base);
  if (settings && "bankKey" in p) {
    const key = parseBankKey(p.bankKey);
    if (key && key !== snapshot.bankKey) {
      next.bankKey = key;
      // A seller with an account of its own has only that one, so the key is
      // recorded as the clerk left it and the block below it does not move.
      next.bank = bankBlock(piBank(settings, key, seller.key));
      changed = true;
    }
  }
  if (settings && "gstinKey" in p) {
    const choice = piGstinFor(settings, seller.key, printable(p.gstinKey));
    if (choice && choice.gstin !== snapshot.gstinKey) {
      next.gstinKey = choice.gstin;
      next.company = { ...snapshot.company, gstin: choice.gstin };
      next.exporter = { ...snapshot.exporter, gstin: choice.gstin };
      changed = true;
    }
  }

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

// SUPERSEDED is a status the enum still carries from the first cut (a revision
// used to keep the number with a suffix and push the old one aside). Since
// answer 24 nothing is superseded: a replaced PI is CANCELLED, with the
// number that replaced it as the reason. The value stays readable so rows
// frozen before 2026-09-07 still list.
export type ProformaStatus = "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "CANCELLED";

/** The order's next PI ordinal: max existing + 1, or 0 for the first. Only
 *  the row's unique key and the tab's ordering use it — never the number. */
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
/** A revision replaces paper the customer holds — an issued or an accepted PI.
 *  A draft is simply edited; a cancelled one is history. */
export function canRevise(status: string): boolean { return status === "ISSUED" || status === "ACCEPTED"; }

/**
 * Why a cancellation is refused, or null when it may go ahead. Round two,
 * answer 8: cancelling asks for a reason, because the register keeps the
 * number and prints that reason beside it — a blank one would leave a struck
 * -through number nobody can account for years later. Status first, so a
 * cancelled PI is told it is cancelled rather than asked for a reason.
 */
export function refuseCancel(pi: { status: string }, reason: string | null | undefined): string | null {
  if (!canCancel(pi.status)) return `A ${pi.status.toLowerCase()} PI cannot be cancelled`;
  if (!printable(reason)) return "Cancelling a PI needs a reason — the register prints it beside the cancelled number";
  return null;
}

/** Why a transition is refused, or null when it may go ahead. */
export function refuseIssue(pi: { status: string; snapshot: { lines: unknown[] } | null | undefined }): string | null {
  if (!canIssue(pi.status)) return `Only a draft can be issued (this PI is ${pi.status.toLowerCase()})`;
  if (!pi.snapshot || !Array.isArray(pi.snapshot.lines) || pi.snapshot.lines.length === 0) return "The PI has no lines — add items to the order and rebuild the draft";
  return null;
}

/** What the issue route needs to know about the order, beyond the PI itself. */
export interface IssueOrderFacts {
  status: string;
  stockCheckedAt: string | Date | null | undefined;
  /** Holds on the order still ACTIVE — after reconcileHold, so a lapsed one
   *  does not count. */
  activeHolds: number;
}

/**
 * Answer 1: "stock check before the PI". The one gate on issuing, asked of
 * stages.canEnter so the PI route and the stage strip refuse with the SAME
 * words. The fact is stockCheckedAt AND a hold that is still live — the stamp
 * alone is history (a hold that lapsed sends the order back to CONFIRMED,
 * answer 11, and the stamp stays).
 *
 * A revision is issued on an order that already stands at PI_ISSUED or
 * further along; that is not a stage move, so canEnter's "Already PI issued"
 * no-op refusal does not apply — the question is asked from STOCK_CHECKED,
 * which keeps the stock gate and the terminal-order refusal and drops the
 * no-op. Advance-with-PI (also answer 1) is the PI's payment terms, not a
 * gate.
 */
export function piIssueRefusal(order: IssueOrderFacts): string | null {
  const stockChecked = Boolean(order.stockCheckedAt) && order.activeHolds > 0;
  const from = order.status === "PI_ISSUED" ? "STOCK_CHECKED" : order.status;
  const check = canEnter(from, "PI_ISSUED", { stockChecked });
  return check.ok ? null : check.reason;
}

/** The reason written on a PI that a revision replaced (answer 24). */
export function revisionReason(newNumber: string): string {
  return `Revised as ${printable(newNumber)}`;
}

/**
 * Issuing a PI cancels every OTHER live PI (issued or accepted) of the same
 * ORDER, as revised by the one being issued: the customer holds one live PI
 * at a time, and answer 24 says the old one is discarded, not kept beside the
 * new. Drafts and cancelled ones are left alone. The match is on the order,
 * not the number — every PI has its own number now.
 *
 * This is the ONLY place a revision retires the old paper. /revise itself
 * leaves the old PI ISSUED: if it cancelled on the spot, the order would have
 * no live PI between revise and issue, and a draft nobody ever issues would
 * leave it with none for good. The old one goes CANCELLED in the same
 * transaction as the new one goes ISSUED, so the register never shows two
 * live PIs or zero.
 */
export function revisedByIssue(all: Array<{ id: string; orderId: string; status: string }>, issuing: { id: string; orderId: string }): string[] {
  return all
    .filter((p) => p.id !== issuing.id && p.orderId === issuing.orderId && (p.status === "ISSUED" || p.status === "ACCEPTED"))
    .map((p) => p.id);
}

/**
 * The `revises` link the issued paper carries. A draft made through /revise
 * already names the PI it replaces; a second draft built directly from the
 * order (POST …/orders/[id]/proformas) does not, yet issuing it retires the
 * live PI all the same — so it is linked to what it retired, else the chain
 * has a hole a reader of the register cannot close. An existing link is never
 * overwritten (the paper names what the clerk revised, even if that PI was
 * cancelled by hand in between). With more than one retired — a state
 * revisedByIssue exists to prevent — the LAST (highest ordinal) is the one
 * the customer held most recently.
 */
export function revisesAtIssue(
  current: { id: string; number: string } | null | undefined,
  retired: Array<{ id: string; number: string }>,
): { id: string; number: string } | null {
  if (current && printable(current.id)) return { id: current.id, number: current.number };
  const last = retired[retired.length - 1];
  return last ? { id: last.id, number: last.number } : null;
}

/**
 * Re-freeze the bank block and the printed GSTIN from Settings at the moment
 * the PI goes out. Both are chosen on the draft (answers 21, 23) and frozen
 * then — but a draft can sit for days while an admin corrects an account
 * number or adds a registration in Settings, and the paper the customer gets
 * must carry Settings as they stand at ISSUE, not at drafting. The KEYS are
 * the clerk's choice and are kept (defaulted by kind / to the company's own
 * when a legacy draft has none); only the details behind them are re-read.
 * After issue nothing re-freezes — an ISSUED snapshot is the paper.
 */
export function refreezeAtIssue(snapshot: PiSnapshot, settings: CommercialSettings): PiSnapshot {
  // THE SELLER IS READ OFF THE SNAPSHOT, NEVER OFF THE ORDER OR THE SETTINGS.
  // What re-freezes at issue is the DETAIL behind a choice — an account number
  // corrected in Settings while the draft sat — and never the choice itself.
  // The order could have been moved to another company in the meantime, and
  // the paper about to go out is the one that was drafted; the seller also has
  // to be known here so the account below is re-read from the right company
  // and the registration is not stamped onto a seller that has none.
  const seller = piSeller(snapshot);
  const bankKey = snapshot.bankKey ?? defaultBankKey(snapshot.kind);
  const gstin = piGstinFor(settings, seller.key, snapshot.gstinKey);
  return {
    ...snapshot,
    bankKey,
    bank: bankBlock(piBank(settings, bankKey, seller.key)),
    gstinKey: gstin ? gstin.gstin : null,
    company: { ...snapshot.company, gstin: gstin ? gstin.gstin : "" },
    exporter: { ...snapshot.exporter, gstin: gstin ? gstin.gstin : null },
  };
}

/** The slice of a PI row the revise gate reads: its status and whom it revises. */
export interface RevisionCandidate {
  id: string;
  number: string;
  status: string;
  snapshot?: { revises?: { id: string; number: string } | null } | null;
}

/** The DRAFT that already revises `oldId`, or null. Only a DRAFT counts: once
 *  it is issued the old PI is cancelled and cannot be revised anyway, and a
 *  cancelled draft is a revision somebody abandoned. */
export function revisionDraftFor<T extends RevisionCandidate>(all: T[], oldId: string): T | null {
  return all.find((p) => p.status === "DRAFT" && p.snapshot?.revises?.id === oldId) ?? null;
}

/**
 * Why a revision is refused, or null when it may go ahead. Two clerks
 * revising the same PI would take two numbers off the counter and leave two
 * drafts racing to retire one paper; the second is refused and pointed at the
 * draft that already exists (409 on the route).
 */
export function refuseRevise(old: { id: string; status: string }, siblings: RevisionCandidate[]): string | null {
  if (!canRevise(old.status)) return `Only an issued or accepted PI can be revised (this PI is ${old.status.toLowerCase()})`;
  const pending = revisionDraftFor(siblings, old.id);
  if (pending) return `A draft revising this PI already exists (${pending.number}) — edit and issue that one`;
  return null;
}

/**
 * What a new draft inherits from the PI it revises: the shipping facts and
 * the two choices the clerk typed onto the old one, which the order does not
 * hold and would otherwise be retyped. Parties, lines and rates are NOT
 * carried — they come from the order as it stands, which is the whole reason
 * a revision is being made. Fed to applyDraftPatch on the fresh snapshot.
 *
 * `salespersonName` is deliberately NOT carried, and that is not the same
 * omission as forgetting it: the order holds it, so the fresh snapshot has
 * already read it from the order along with the parties and the lines. Copying
 * the old PI's value over the top would make a revision the one place an
 * order's reassignment could be silently undone.
 *
 * THE SELLER IS NOT CARRIED EITHER, for exactly that reason and with more at
 * stake: the order holds it, buildProformaSnapshot has already read it, and a
 * revision therefore goes out under the same company as the paper it replaces
 * — as long as nobody has moved the order in between, in which case the
 * revision is the company the order now names, which is what a revision is
 * for. Carrying it would pin a replacement to a company the order no longer
 * claims, and `bankKey` beside it would then name an account of the wrong one.
 */
export function carriedIntoRevision(old: PiSnapshot): Record<string, unknown> {
  return {
    deliveryDate: old.deliveryDate,
    vessel: old.vessel,
    grossWeight: old.grossWeight,
    netWeight: old.netWeight,
    discount: old.discount,
    notes: old.notes,
    preCarriageBy: old.preCarriageBy,
    placeOfReceipt: old.placeOfReceipt,
    portOfLoading: old.portOfLoading,
    portOfDischarge: old.portOfDischarge,
    finalDestination: old.finalDestination,
    bankKey: old.bankKey,
    gstinKey: old.gstinKey,
  };
}

// ─────────────── the register: a cancelled PI stays, it does not vanish ────

/** The slice of a PI row the register reads to place a row and label it. */
export interface RegisterRow {
  id: string;
  number: string;
  revision: number;
  status: string;
  /** The PI issued in this one's place, written when the replacement is
   *  issued (round two, answer 8; column since scripts/0080). */
  replacedById?: string | null;
}

/**
 * The PI issued in `row`'s place, or null. The link is a column on the
 * cancelled row and the replacement is a sibling of the same order, so the
 * number the register prints is resolved from the list the screen already
 * holds — no second read, and a link pointing at a PI outside the list simply
 * resolves to nothing rather than printing a raw id.
 */
export function replacementOf<T extends RegisterRow>(all: T[], row: { id?: string; replacedById?: string | null }): T | null {
  const id = printable(row.replacedById);
  if (!id || id === row.id) return null;
  return all.find((p) => p.id === id) ?? null;
}

/**
 * The register's order: newest ordinal first, EXCEPT that a cancelled PI sits
 * directly under the PI that replaced it, however far apart their ordinals sit
 * (round two, answer 8 — the retired number is read beside the number that
 * retired it, not hunted for further down the page). A chain of revisions
 * unwinds newest to oldest under its live head. A link pointing outside the
 * list, or round a cycle, leaves the row in its ordinal place: every row is
 * listed exactly once, whatever the data says.
 */
export function registerOrder<T extends RegisterRow>(all: T[]): T[] {
  const rows = [...all].sort((a, b) => b.revision - a.revision);
  const under = new Map<string, T[]>();
  const follower = new Set<string>();
  for (const row of rows) {
    const target = replacementOf(rows, row);
    if (!target) continue;
    follower.add(row.id);
    under.set(target.id, [...(under.get(target.id) ?? []), row]);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const emit = (row: T): void => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
    for (const child of under.get(row.id) ?? []) emit(child);
  };
  for (const row of rows) if (!follower.has(row.id)) emit(row);
  // A cycle of replacedById has no head to hang off; those rows still list.
  for (const row of rows) emit(row);
  return out;
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

/**
 * Whether a party block has anything on it to print — asked of the ONE party
 * cell that is not on every PI, "Buyer if Not Consignee".
 *
 * The owner, 2026-09-15: "buyer if not consignee section (only applicable for
 * SBP)". Exactly one customer — Surfaces by Pacific, the group's own US arm —
 * ever buys through a second party, and the cell was rendered unconditionally,
 * so every other PI printed an empty labelled box asking the customer a
 * question about themselves that nobody had an answer to. The block is
 * therefore printed only where there IS one, and is simply absent everywhere
 * else — absent, not blank.
 *
 * Asked through partyBlock rather than of the Party itself so the answer can
 * never disagree with what the cell would actually render: a party that is all
 * blanks and "None"s reduces to nothing printable and does not print, and one
 * that carries only a country or a telephone number still does.
 */
export function printsParty(p: Party | null | undefined): boolean {
  const block = partyBlock(p);
  return Boolean(block.name) || block.lines.length > 0;
}

/**
 * The salesperson named on the printed PI, or "" when the PI does not name one
 * (owner, 2026-09-15: "for dta a small section for salesperson — who has asked
 * for the PI for his customer/consignee").
 *
 * DOMESTIC ONLY. An export PI prints no such block at all, not even an empty
 * label: an export order is shipped against paperwork the buyer's bank and
 * customs read, and an internal name on it answers nobody. The order may still
 * CARRY a salesperson on an export order (scripts/0084 keeps the column kindless
 * so reassigning an order between the two kinds loses nothing) — it is this
 * function that refuses to print it.
 *
 * A domestic PI with no name recorded prints no block either. The block names
 * a person; an empty labelled box naming nobody is the same empty box on the
 * customer's paper that "Buyer if Not Consignee" was just cut for.
 */
export function piSalesperson(s: PiSnapshot): string {
  return s.kind === "DOMESTIC" ? printable(s.salespersonName) : "";
}

/** The printed invoice number is the PI's own number, whole. There is no
 *  revision suffix: a revision is a new number (answer 24). */
export function printedNumber(number: string): string {
  return printable(number);
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
  /**
   * WHAT THE FIRST PARTY CELL IS CALLED. "Exporter" on an Indian exporter's
   * proforma, which is every proforma this module has ever produced and every
   * Pacific one it will produce. A US company selling to a US buyer is not
   * exporting anything — and on the group's own arrangement it may not even be
   * the party that ships — so its paper calls that cell "Seller", which is the
   * one thing the party in it certainly is.
   */
  exporterLabel: string;
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
  /** The Terms & Conditions box: snapshot.notes, and only ever that. The PDF
   *  prints the labelled box whether or not there is anything in it. */
  termsAndConditions: string;
  /** The DTA salesperson block, "" when the PI prints none (piSalesperson).
   *  The PDF renders the block only for a non-blank, the way it renders the
   *  validity line only for a non-blank validUntil. */
  salesperson: string;
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
  /** The beneficiary's account with the correspondent bank — blank on both
   *  Indian accounts, which give none. */
  routingAccountNo: string;
  /** The ACH route, kept apart from the wire route above: its account number
   *  is NOT the account number a wire is sent to, and a payer who mixes the
   *  two lines has the payment returned days later. Blank throughout on an
   *  account with no ACH route, and the layout prints no ACH block at all. */
  achBank: string;
  achRoutingNo: string;
  achAccountNo: string;
  grossWeight: string;
  netWeight: string;
  discount: string;
  totalAmount: string;
  totalSlabs: string;
  amountInWords: string;
  declaration: string;
  currency: string;
  /** "Kotak" / "ICICI" — which of the two accounts this is (answer 23),
   *  for the screen; the PDF prints the block itself. */
  bankKey: string;
  /** WHICH COMPANY SOLD (scripts/0085), for the screens and the register. The
   *  LAYOUT does not ask these: whether the Indian block is printed is
   *  printsIndianBlock(snapshot), asked of the snapshot the way
   *  printsParty(snapshot.buyerIfNotConsignee) is — every value on THIS
   *  interface is a formatted string, and a yes-or-no is not one. */
  sellerKey: string;
  sellerLabel: string;
}

/** Every scalar the PI prints, already formatted. A blank field is "" — the PI
 *  is a customer-facing document and must never show "None" or "null". The
 *  validity is blank when the PI has none (answer 24: valid forever), and the
 *  PDF prints no "valid until" line for a blank. */
export function piPrintFields(s: PiSnapshot): PiPrintFields {
  return {
    title: "PROFORMA INVOICE",
    exporterLabel: printsIndianBlock(s) ? "Exporter" : "Seller",
    invoiceNo: printedNumber(s.number),
    invoiceDate: formatPiDate(s.date),
    buyerPoNo: printable(s.buyerPoNo),
    deliveryDate: formatPiDate(s.deliveryDate),
    validUntil: formatPiDate(s.validUntil),
    rbiCode: printable(s.company.rbiCode),
    gstin: printable(s.company.gstin),
    customsOffice: printable(s.company.customsOffice).toUpperCase(),
    countryOfOrigin: printable(s.countryOfOrigin),
    countryOfDestination: printable(s.countryOfDestination),
    // The box carries what a human typed and nothing else (owner, 2026-09-15).
    // Nothing is composed in here, and nothing falls back to a weight, a
    // tonnage or a packing note off the order: a blank prints a blank.
    termsAndConditions: printable(s.notes),
    salesperson: piSalesperson(s),
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
    routingAccountNo: printable(s.bank.routingAccountNo),
    achBank: printable(s.bank.ach?.bank),
    achRoutingNo: printable(s.bank.ach?.routingNo),
    achAccountNo: printable(s.bank.ach?.accountNo),
    grossWeight: printable(s.grossWeight),
    netWeight: printable(s.netWeight),
    discount: s.discount ? fmtAmount(s.discount) : "",
    totalAmount: fmtAmount(s.totalAmount),
    totalSlabs: fmtSlabs(s.totalSlabs),
    amountInWords: printable(s.amountInWords),
    declaration: printable(s.declaration),
    currency: printable(s.currency).toUpperCase(),
    bankKey: s.bankKey ?? defaultBankKey(s.kind),
    sellerKey: piSeller(s).key,
    sellerLabel: piSeller(s).label,
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
