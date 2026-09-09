// Document numbering — the PURE half. Formats are templates with three
// placeholders, filled from a date and a counter:
//
//   {fy}      Indian financial year label, April start: 2026-09-06 → "26-27"
//   {yy}      two-digit calendar year: "26"
//   {seq}     the counter; {seq:5} zero-pads to 5 digits
//
// The real documents (2026-09-05):
//   PI / internal sales order   SAL-ORD/25-26/01404      → "SAL-ORD/{fy}/{seq:5}"
//   export invoice              PESPL/2780               → "PESPL/{seq:4}"
//   DTA (domestic) invoice      PESPL/0137/26-27         → "PESPL/{seq:4}/{fy}"
//   delivery challan            PESPL/DC/20/26           → "PESPL/DC/{seq}/{yy}"
//
// WHO OWNS THE NUMBER IS UNDECIDED (owner, 2026-09-05: "we'll clear later").
// These shapes look like Tally voucher numbers, and the finance module already
// imports Tally XML. So every generated number is also OVERRIDABLE by hand on
// the document, and the counter's next value is editable in settings — if
// Tally stays the source of truth, the ERP mirrors it; if the ERP becomes it,
// nothing changes here.
//
// Pure: no imports. Tested in tests/commercialRules.test.ts.

export interface NumberingSpec {
  /** Counter key in commercial_sequence. */
  key: string;
  /** Template with {fy} {yy} {seq[:N]} placeholders. */
  template: string;
  /** true → one counter per financial year (key becomes "<key>:<fy>"). */
  perFy: boolean;
}

/** Financial year starts 1 April. 2026-03-31 → "25-26"; 2026-04-01 → "26-27". */
export function fyLabel(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** Two-digit calendar year, e.g. "26". */
export function yy(d: Date): string {
  return String(d.getFullYear()).slice(2);
}

/** The counter key for a spec on a date: per-FY specs get the FY appended so a
 *  new April starts the count again without a manual reset. */
export function sequenceKey(spec: NumberingSpec, d: Date): string {
  return spec.perFy ? `${spec.key}:${fyLabel(d)}` : spec.key;
}

/** Fill a template. Unknown placeholders are left in place so a typo in
 *  settings is visible on the document rather than silently blank. */
export function formatNumber(template: string, parts: { fy: string; yy: string; seq: number }): string {
  return template.replace(/\{(fy|yy|seq)(?::(\d+))?\}/g, (_m, name: string, pad?: string) => {
    if (name === "fy") return parts.fy;
    if (name === "yy") return parts.yy;
    const s = String(parts.seq);
    return pad ? s.padStart(Number(pad), "0") : s;
  });
}

/** One call: the number a document dated d gets for counter value seq. */
export function documentNumber(spec: NumberingSpec, d: Date, seq: number): string {
  return formatNumber(spec.template, { fy: fyLabel(d), yy: yy(d), seq });
}

/** A number typed by hand: trimmed, and never empty. */
export function cleanOverride(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
