// Class strings and number formatting shared by the invoice and challan
// screens. Kept out of the components so the register, the detail, the challan
// form and the order's invoice tab cannot drift into four different-looking
// tables. Same Tailwind idiom as src/components/office/FinanceBills.tsx.

export const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
export const lbl = "mb-1 block text-xs font-medium text-gray-600";
export const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
export const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
export const btnDanger = "rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60";
export const th = "py-2 pr-4 font-medium";
export const thead = "border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400";
export const errorBox = "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";
export const noteBox = "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800";

/** An amount with its currency, grouped the way that currency is read. */
export function money(n: number | null | undefined, currency = "INR", dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const locale = currency.toUpperCase() === "INR" ? "en-IN" : "en-US";
  return `${currency.toUpperCase() === "INR" ? "₹" : `${currency.toUpperCase()} `}${Number(n).toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** A bare number, grouped, no symbol. */
export function qty(n: number | null | undefined, dp = 3): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** An ISO date (or @db.Date, which arrives as an ISO instant) → 20/08/2026. */
export function dmy(v: string | null | undefined): string {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** The value a <input type="date"> wants. */
export function dateValue(v: string | null | undefined): string {
  if (!v) return "";
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/** Today, in the same form. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
