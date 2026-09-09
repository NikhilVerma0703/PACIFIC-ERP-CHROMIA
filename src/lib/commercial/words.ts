// Amounts in words — PURE. Two styles, because the reference documents use
// two and neither is what the ported module's amountToWords produces
// (UPPERCASE "AND CENTS", which matches none of them):
//
//   foreign (PI, export invoice): Western grouping, Title Case, the minor unit
//     named, e.g. 17324.657 →
//     "USD Seventeen Thousand, Three Hundred And Twenty Four and Sixty Six Cent only."
//     (cents = round(.657 × 100) = 66; the reference prints "Cent" singular)
//
//   Indian (DTA invoice, challan): lakh/crore grouping, whole rupees after
//     rounding, e.g. 3749231.7 →
//     "Thirty Seven Lakh Forty Nine Thousand Two Hundred Thirty Two Rupees Only."
//
// Negative amounts are written with "Minus" in front; zero is "Zero".

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0..99 in words; "" for 0. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0..999 in words. withAnd → "Three Hundred And Twenty Four" (the PI style). */
function threeDigits(n: number, withAnd: boolean): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!h) return twoDigits(rest);
  const head = `${ONES[h]} Hundred`;
  if (!rest) return head;
  return `${head}${withAnd ? " And " : " "}${twoDigits(rest)}`;
}

/** Western grouping: thousand, million, billion. Groups joined with ", ". */
export function westernWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const scales = ["", "Thousand", "Million", "Billion", "Trillion"];
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const g = n % 1000;
    if (g) parts.unshift(`${threeDigits(g, true)}${scales[i] ? ` ${scales[i]}` : ""}`);
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(", ");
}

/** Indian grouping: thousand, lakh, crore (and arab beyond). Groups joined with " ". */
export function indianWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crorePlus = Math.floor(n / 1e7);
  if (crorePlus) parts.push(`${indianWords(crorePlus)} Crore`);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  n %= 1e3;
  if (n) parts.push(threeDigits(n, false));
  return parts.join(" ");
}

/** Split an amount into whole and minor (2 dp), rounding half up on the minor. */
export function splitMinor(amount: number): { whole: number; minor: number; negative: boolean } {
  const negative = amount < 0;
  const cents = Math.round(Math.abs(amount) * 100);
  return { whole: Math.floor(cents / 100), minor: cents % 100, negative };
}

/**
 * The PI / export-invoice style.
 *   foreignWords(17324.657, "USD") → "USD Seventeen Thousand, Three Hundred And Twenty Four and Sixty Six Cent only."
 *   foreignWords(1200, "EUR")      → "EUR One Thousand, Two Hundred only."
 */
export function foreignWords(amount: number, currency = "USD", minorUnit = "Cent"): string {
  const { whole, minor, negative } = splitMinor(amount);
  const head = `${currency} ${negative ? "Minus " : ""}${westernWords(whole)}`;
  const tail = minor ? ` and ${twoDigits(minor)} ${minorUnit}` : "";
  return `${head}${tail} only.`;
}

/**
 * The DTA / challan style, whole rupees after rounding half up.
 *   inrWords(3749231.7) → "Thirty Seven Lakh Forty Nine Thousand Two Hundred Thirty Two Rupees Only."
 *   inrWords(6000)      → "Six Thousand Rupees Only."
 * withPaise: true keeps the paise ("... Rupees and Fifty Paise Only.").
 */
export function inrWords(amount: number, opts: { withPaise?: boolean } = {}): string {
  if (opts.withPaise) {
    const { whole, minor, negative } = splitMinor(amount);
    const head = `${negative ? "Minus " : ""}${indianWords(whole)} Rupees`;
    return minor ? `${head} and ${twoDigits(minor)} Paise Only.` : `${head} Only.`;
  }
  const rounded = Math.round(Math.abs(amount));
  return `${amount < 0 ? "Minus " : ""}${indianWords(rounded)} Rupees Only.`;
}

/** Pick the style from the currency: INR → Indian, anything else → foreign. */
export function amountInWords(amount: number, currency: string): string {
  return currency.toUpperCase() === "INR" ? inrWords(amount) : foreignWords(amount, currency.toUpperCase());
}
