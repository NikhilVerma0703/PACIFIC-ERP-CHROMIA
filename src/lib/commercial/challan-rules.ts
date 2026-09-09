// Delivery challan rules — PURE. The challan is a movement, not a sale
// (samples, display stands, goods to the sister company), so its arithmetic
// is small: an approximate amount per line, a total, the total in words, and
// four copies of the same page. All of it here, so node --test runs it.
import type { ChallanItem } from "./types.ts";
import { inrWords } from "./words.ts";

export type ChallanStatus = "DRAFT" | "ISSUED" | "CANCELLED";

/** The four copies the PGI reference sheet names (outside its print area — so
 *  they never printed; the owner's default is that each copy carries its label). */
export const CHALLAN_COPIES: readonly string[] = [
  "Original - Buyer Copy",
  "Duplicate - Transporter Copy",
  "Triplicate - Central Excise Copy",
  "Quadruplicate - Assessee Copy",
];

export const CHALLAN_DEFAULT_PO_REF = "Verbal";
export const CHALLAN_DEFAULT_COMMODITY = "Artificial Quartz Slabs";
export const CHALLAN_UNITS: readonly string[] = ["Nos", "Box", "SQFT", "Set"];

const r2 = (n: number): number => Math.round(n * 100) / 100;
const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : null;
};

export function canEditChallan(status: string): boolean { return status === "DRAFT"; }
export function canIssueChallan(status: string): boolean { return status === "DRAFT"; }
export function canCancelChallan(status: string): boolean { return status === "DRAFT" || status === "ISSUED"; }

/**
 * A line's approximate amount: what was typed when an amount was typed,
 * otherwise rate × the area when the line has one (the sheet's rate is per
 * SQFT), otherwise rate × quantity. Two decimals.
 *
 * ZERO IS NOT "TYPED". ChallanItem.amount is `number`, not `number | null`, so
 * a line built anywhere but normaliseChallanItems arrives carrying 0 — and
 * treating that as a typed amount left challanTotals printing 0.00 against a
 * priced line. A deliberate zero is still zero: it can only come from a zero
 * rate, which works out to zero anyway.
 */
export function challanLineAmount(item: { qty: number; sqft: number | null; rate: number; amount?: number | null }): number {
  if (item.amount != null && Number.isFinite(item.amount) && item.amount !== 0) return r2(item.amount);
  const basis = item.sqft != null && item.sqft > 0 ? item.sqft : item.qty;
  return r2(basis * item.rate);
}

/** Items typed on the screen → ChallanItem[]: coerced, blank rows dropped,
 *  amounts filled by challanLineAmount. `amount: null` means "work it out". */
export function normaliseChallanItems(raw: unknown): ChallanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChallanItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const description = s(x.description);
    const qty = num(x.qty) ?? 0;
    const rate = num(x.rate) ?? 0;
    const sqft = num(x.sqft);
    if (!description && qty === 0 && rate === 0 && sqft == null) continue;
    const item: ChallanItem = { description, qty, unit: s(x.unit) || "Nos", sqft, rate, amount: 0, hsn: s(x.hsn) || null };
    item.amount = challanLineAmount({ qty, sqft, rate, amount: num(x.amount) });
    out.push(item);
  }
  return out;
}

export interface ChallanTotals {
  items: ChallanItem[];
  totalQty: number;
  totalSqft: number;
  totalAmount: number;
}

/** Every line's amount settled, and the three column totals (2 dp). */
export function challanTotals(items: ChallanItem[]): ChallanTotals {
  const settled = items.map((i) => ({ ...i, amount: challanLineAmount(i) }));
  const sum = (f: (i: ChallanItem) => number | null | undefined): number => r2(settled.reduce((a, i) => a + (Number(f(i)) || 0), 0));
  return { items: settled, totalQty: sum((i) => i.qty), totalSqft: sum((i) => i.sqft), totalAmount: sum((i) => i.amount) };
}

/**
 * The declared total in words — the PAISE INCLUDED, because the challan prints
 * its Grand Total to two decimals on all four copies and the words have to say
 * the same number.
 *
 * Rounding to whole rupees the way a DTA invoice does is right there only
 * because the DTA invoice ALSO rounds its grand total to a whole rupee and
 * shows the difference in a Round Off row. A challan has no round-off row: it
 * prints 48,708.75 and used to word it "Forty Eight Thousand Seven Hundred
 * Nine Rupees Only.", and at the paise boundary 6,000.50 became "Six Thousand
 * One Rupees Only" — the figure and the words disagreeing on a statutory
 * movement document, in four copies, one of them for Central Excise.
 *
 *   challanWords(48708.75) → "Forty Eight Thousand Seven Hundred Eight Rupees and Seventy Five Paise Only."
 *   challanWords(6000)     → "Six Thousand Rupees Only."
 */
export function challanWords(total: number): string {
  return inrWords(total, { withPaise: true });
}

/** The tariff head printed in the header: the first line's HSN, else the company's quartz HSN. */
export function challanTariffHead(items: ChallanItem[], fallback: string): string {
  return items.map((i) => s(i.hsn)).find(Boolean) || fallback;
}

/** "PESPL/DC/20/26" → "PESPL-DC-20-26.pdf". */
export function challanFilename(number: string): string {
  return `${s(number).replace(/[\/\s]+/g, "-") || "challan"}.pdf`;
}

/** YYYY-MM-DD (or ISO) → DD/MM/YYYY, the challan's date form. */
export function challanDate(iso: string | null | undefined): string {
  const m = s(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * The number with its date DIRECTLY UNDER it (answer 6), as the challan
 * header, the challan book and the order's Invoice tab all print it:
 *
 *   challanNumberLines("PESPL/DC/N3/26", "2026-08-20") → ["PESPL/DC/N3/26", "Dated: 20/08/2026"]
 *
 * A missing date gives the number alone rather than a bare "Dated:"; a
 * missing number, the date alone — a draft is never printed headless.
 */
export function challanNumberLines(number: unknown, iso: string | null | undefined): string[] {
  const out: string[] = [];
  const n = s(number);
  const d = challanDate(iso);
  if (n) out.push(n);
  if (d) out.push(`Dated: ${d}`);
  return out;
}

// ───────────────────────────── list filters ──────────────────────────────────

export interface ChallansFilter {
  status?: string | null;
  orderId?: string | null;
  from?: string | null;      // YYYY-MM-DD
  to?: string | null;        // YYYY-MM-DD
  q?: string | null;
}

const CHALLAN_STATUSES: readonly string[] = ["DRAFT", "ISSUED", "CANCELLED"];

function dateOrNull(v: unknown): Date | null {
  const m = s(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The challan list's filters as a Prisma where. `q` matches the challan
 * number, the consignee's name or the PO reference; an unknown status is
 * ignored rather than sent to Postgres as an invalid enum.
 */
export function challansWhere(f: ChallansFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const statuses = s(f.status).split(",").map((x) => x.trim().toUpperCase()).filter((x) => CHALLAN_STATUSES.includes(x));
  if (statuses.length === 1) where.status = statuses[0];
  else if (statuses.length > 1) where.status = { in: statuses };
  const orderId = s(f.orderId);
  if (orderId) where.orderId = orderId;
  const from = dateOrNull(f.from);
  const to = dateOrNull(f.to);
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.challanDate = range;
  }
  const q = s(f.q);
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { consigneeName: { contains: q, mode: "insensitive" } },
      { poRef: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** Page arithmetic for the challan list: page >= 1, limit 1..500, default 1 / 50.
 *  `?limit=0` means "you did not say", not "give me one row". */
export function pageArgs(page: unknown, limit: unknown): { page: number; limit: number; skip: number; take: number } {
  const p = Math.max(1, Math.trunc(num(page) || 1));
  const l = Math.min(500, Math.max(1, Math.trunc(num(limit) || 50)));
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}

/** Badge tone per status, shared by the list, the detail and the order tab. */
export function challanStatusTone(status: string): "brand" | "green" | "amber" | "red" {
  switch (status) {
    case "ISSUED": return "green";
    case "DRAFT": return "amber";
    default: return "red";
  }
}

/** Why issuing is refused, or null when it may go ahead. */
export function refuseChallanIssue(ch: { status: string; items?: unknown }): string | null {
  if (!canIssueChallan(ch.status)) return `Only a draft can be issued (this challan is ${s(ch.status).toLowerCase()})`;
  const items = Array.isArray(ch.items) ? ch.items : [];
  if (items.length === 0) return "The challan has no lines — add at least one before issuing";
  return null;
}
