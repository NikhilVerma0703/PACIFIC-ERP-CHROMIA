// The batch consumables sheet's VOCABULARY AND RULES, with no database in them.
//
// Split out of batchUsage.ts for the reason lib/costing/verification.ts and
// lib/inventory/intakeRules.ts are: `node --test` resolves neither the "@/"
// alias nor Prisma, and a rule that decides a rupee figure but can only be
// checked by opening a browser is a rule nobody checks. Everything here is
// import-free and structural, so a test can call it with a plain object.
//
// batchUsage.ts re-exports all of it, so no caller needs to know it moved.

/** The eight stations a batch passes, in the order the plant runs them, with
 *  the column each one names its person in.
 *
 *  THE PERSON COLUMN IS NOT ALWAYS "operator", and getting it wrong would show
 *  a blank name on the two stations that matter most to polishing: PolishEntry
 *  names a `calliberator` and PolishQc an `inspector`. Same set OPERATOR_FIELDS
 *  describes for the entry forms; kept explicitly per model here because this
 *  has to SELECT one column, not test a name against a set. */
export const BATCH_STATIONS: readonly { model: string; label: string; delegate: string; person: string }[] = [
  { model: "MixerCycle", label: "Mixer", delegate: "mixerCycle", person: "operator" },
  { model: "Distributor", label: "Distributor", delegate: "distributor", person: "operator" },
  { model: "Kreos", label: "Kreos", delegate: "kreos", person: "operator" },
  { model: "Press", label: "Press", delegate: "press", person: "operator" },
  { model: "Oven", label: "Oven", delegate: "oven", person: "operator" },
  { model: "Jot", label: "Jot", delegate: "jot", person: "operator" },
  { model: "PolishEntry", label: "Polishing", delegate: "polishEntry", person: "calliberator" },
  { model: "PolishQc", label: "Polish QC", delegate: "polishQc", person: "inspector" },
];

export interface UsageLine {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  pricedBy: string | null;
  pricedAt: string | null;
  operatorName: string | null;
  enteredBy: string | null;
  /** True when the line came from the floor's own panel rather than being
   *  typed at sign-off — the sheet marks these, because a figure the station
   *  reported and a figure the office entered are different kinds of evidence. */
  fromFloor: boolean;
  date: string;
}

export interface StationUsage {
  station: string;
  label: string;
  department: string;
  /** Everyone the batch's own records name at this station, deduped and in
   *  first-seen order. Empty when the batch has no records there. */
  operators: string[];
  /** Whether the batch has ANY production record at this station — the
   *  difference between "ran it and logged no consumables" and "never ran it". */
  ran: boolean;
  lines: UsageLine[];
}

/** What a sign-off save may carry for one line. `id` present = edit an existing
 *  line; absent = create one. */
export interface UsageEdit {
  id?: string;
  station: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice?: number | null;
  operatorName?: string | null;
}

export interface SaveResult { ok: boolean; error?: string; saved?: number; deleted?: number }

/** One refusal sentence, or null. Kept apart from the write so the rules can be
 *  tested without a database — they are the only thing standing between a
 *  typed rupee figure and the costing sheet. */
export function editProblem(e: UsageEdit, stations: ReadonlySet<string>): string | null {
  const item = String(e.itemName ?? "").trim();
  if (!item) return "Every line needs an item name.";
  if (item.length > 80) return `“${item.slice(0, 20)}…” is too long for an item name.`;
  if (!stations.has(String(e.station ?? ""))) return `“${e.station}” is not a station on this batch.`;
  const q = Number(e.quantity);
  if (!Number.isFinite(q) || q < 0) return `Quantity for “${item}” must be a number, and not negative.`;
  if (q > 1_000_000) return `Quantity for “${item}” looks like a typo (over a million).`;
  const unit = String(e.unit ?? "").trim();
  if (unit.length > 12) return `The unit for “${item}” is too long.`;
  if (e.unitPrice != null) {
    const p = Number(e.unitPrice);
    if (!Number.isFinite(p) || p < 0) return `The price for “${item}” must be a number, and not negative.`;
    if (p > 10_000_000) return `The price for “${item}” looks like a typo (over a crore).`;
  }
  return null;
}
