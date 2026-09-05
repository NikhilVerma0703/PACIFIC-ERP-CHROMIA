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
   *  reported and a figure the office entered are different kinds of evidence.
   *  Derived from `source` (scripts/0075) and from nothing else: it used to be
   *  read off operatorName, which the sheet ALSO writes, so sheet-typed lines
   *  came back badged as the floor's. */
  fromFloor: boolean;
  date: string;
}

/** The two paths that write a line, as the `source` column spells them. */
export const LINE_SOURCE = { floor: "floor", signoff: "signoff" } as const;

/** One consumption row as the sheet shows it. Pure, so the badge rule can be
 *  tested without a database. `r` is the Prisma row (or anything shaped like
 *  it); dates come out as ISO strings so the result can cross to the client. */
export function toLine(r: {
  id: unknown; itemName?: unknown; quantity?: unknown; unit?: unknown; unitPrice?: unknown;
  pricedBy?: unknown; pricedAt?: unknown; operatorName?: unknown; enteredBy?: unknown;
  source?: unknown; date?: unknown;
}): UsageLine {
  const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ""));
  return {
    id: String(r.id),
    itemName: String(r.itemName ?? ""),
    quantity: Number(r.quantity ?? 0),
    unit: String(r.unit ?? ""),
    unitPrice: r.unitPrice == null ? null : Number(r.unitPrice),
    pricedBy: (r.pricedBy as string | null | undefined) ?? null,
    pricedAt: r.pricedAt ? iso(r.pricedAt) : null,
    operatorName: (r.operatorName as string | null | undefined) ?? null,
    enteredBy: (r.enteredBy as string | null | undefined) ?? null,
    fromFloor: r.source === LINE_SOURCE.floor,
    date: iso(r.date),
  };
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

/** What a sign-off save may carry for one line.
 *
 *  TWO SHAPES, AND THE SPLIT IS THE STALE-SAVE RULE. A create carries the whole
 *  line. An update carries `id` and ONLY the fields this person changed — a
 *  key that is absent means "leave that column as it is", exactly as `unitPrice`
 *  already worked. Before 2026-09-05 every column was re-sent whenever any one
 *  of them changed, so a verifier who fixed only the Person box on a sheet
 *  opened ten minutes earlier put a colleague's corrected quantity back to the
 *  stale figure — the price and the pricer's name survived, and the line then
 *  read a quantity its pricer never priced. */
export interface UsageCreate {
  id?: undefined;
  station: string;
  itemName: string;
  quantity: number;
  unit?: string;
  /** ABSENT means "leave the price as it is". null means "clear it". A number
   *  sets it. The distinction is what stops one verifier's save from wiping
   *  the other's price: the sheet sends this key only for a line whose price
   *  box was actually touched. */
  unitPrice?: number | null;
  operatorName?: string | null;
}
export interface UsageUpdate {
  id: string;
  station?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number | null;
  operatorName?: string | null;
}
export type UsageEdit = UsageCreate | UsageUpdate;

/** True for an edit of a line that exists. `id` is the discriminant: the sheet
 *  omits it on a new row and JSON drops an undefined key. */
export function isUpdate(e: UsageEdit): e is UsageUpdate {
  return typeof e.id === "string" && e.id !== "";
}

/** What a save writes to the three price columns for one edit, and whether it
 *  writes them at all. `by`/`at` are stamped only when a price is SET — a
 *  cleared price carries no author, and an untouched price is not rewritten,
 *  so the name on a rupee figure stays the name of the person who put it there. */
export function pricePatch(e: Pick<UsageEdit, "unitPrice">, by: string, at: Date):
  { unitPrice: number | null; pricedBy: string | null; pricedAt: Date | null } | null {
  if (!("unitPrice" in e)) return null;
  if (e.unitPrice == null) return { unitPrice: null, pricedBy: null, pricedAt: null };
  return { unitPrice: Number(e.unitPrice), pricedBy: by, pricedAt: at };
}

/** Has this draft moved from what the sheet loaded? The sheet sends only the
 *  lines that have, so a stale copy of the sheet cannot overwrite a colleague's
 *  edits on lines it never touched. Compared as strings, exactly as the boxes
 *  hold them, so "40" and "40.0" typed over each other still count as a change
 *  the person made. */
export interface DraftShape { itemName: string; quantity: string; unit: string; unitPrice: string; operatorName: string; station: string }
export function draftChanged(a: DraftShape, b: DraftShape): boolean {
  return a.itemName.trim() !== b.itemName.trim()
    || a.quantity.trim() !== b.quantity.trim()
    || a.unit.trim() !== b.unit.trim()
    || a.unitPrice.trim() !== b.unitPrice.trim()
    || a.operatorName.trim() !== b.operatorName.trim()
    || a.station !== b.station;
}

export interface SaveResult { ok: boolean; error?: string; saved?: number; deleted?: number }

/** One refusal sentence, or null. Kept apart from the write so the rules can be
 *  tested without a database — they are the only thing standing between a
 *  typed rupee figure and the costing sheet.
 *
 *  On an UPDATE only the fields carried are checked (an absent field is not
 *  being written). On a create every required field must be there.
 *
 *  NUMBERS MUST ARRIVE AS NUMBERS. `Number("")` is 0 and `Number(true)` is 1,
 *  so a body carrying unitPrice "" used to stamp a price of ₹0 under the
 *  saver's name, and `true` a price of ₹1 (found 2026-09-05, no live rows yet).
 *  The sheet never sends those; the route is callable by anything. */
export function editProblem(e: UsageEdit, stations: ReadonlySet<string>): string | null {
  const update = isUpdate(e);
  const item = String(e.itemName ?? "").trim();
  const label = item || "this line";
  if (!update || "itemName" in e) {
    if (!item) return "Every line needs an item name.";
    if (item.length > 80) return `“${item.slice(0, 20)}…” is too long for an item name.`;
  }
  if (!update || "station" in e) {
    if (!stations.has(String(e.station ?? ""))) return `“${e.station}” is not a station on this batch.`;
  }
  if (!update || "quantity" in e) {
    const q = e.quantity;
    if (typeof q !== "number" || !Number.isFinite(q) || q < 0) return `Quantity for “${label}” must be a number, and not negative.`;
    // A NEW line at zero is "this station used none" and worth recording. An
    // EXISTING line at zero is almost always a quantity box someone cleared
    // meaning to retype it — and on a floor line, zero would also leave the
    // stock decrement standing against nothing. Refuse it and say so.
    if (update && q === 0) return `“${label}” already has a quantity — type the corrected figure rather than leaving it blank, or remove the line.`;
    if (q > 1_000_000) return `Quantity for “${label}” looks like a typo (over a million).`;
  }
  if ("unit" in e) {
    const unit = String(e.unit ?? "").trim();
    if (unit.length > 12) return `The unit for “${label}” is too long.`;
  }
  if ("unitPrice" in e && e.unitPrice != null) {
    const p = e.unitPrice;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) return `The price for “${label}” must be a number, and not negative.`;
    if (p > 10_000_000) return `The price for “${label}” looks like a typo (over a crore).`;
  }
  return null;
}

/** THE RULE THAT KEEPS A FLOOR LINE'S STOCK HONEST. A source='floor' line has
 *  already decremented the stock row it is linked to (quickLog does that as
 *  the station logs it). The sheet never moves stock, so if it let the line be
 *  renamed Gloves -> Emery the Gloves stock would stay short by the quantity
 *  against no line, Emery would stay untouched while its line said it was
 *  consumed, and the row would still be badged "from the floor" and protected
 *  from deletion (found 2026-09-05, no live rows yet). Same for the unit: a
 *  PCS-counted stock was decremented in PCS, and a line that now says KG
 *  describes a movement that never happened.
 *
 *  So on a floor row the item and the unit may not change. Quantity, price
 *  and person may — quantity is the correction the delete guard tells people
 *  to make instead. Compared case-insensitively and trimmed, so retyping the
 *  same name in a different case is not a change. `row.stockName` is the
 *  linked stock row's own spelling when the line is linked; an unlinked floor
 *  row (none should exist since a998961) is held to its own itemName. */
export function floorEditProblem(
  row: { itemName: string; unit: string; stockName?: string | null },
  e: Pick<UsageUpdate, "itemName" | "unit">,
): string | null {
  const canon = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const name = row.stockName ?? row.itemName;
  if ("itemName" in e && canon(e.itemName) !== canon(name)) {
    return `${row.itemName} was logged at the machine and its stock has already moved, so it cannot be renamed here — correct the quantity, or add the right item as a new line and ask the store to adjust the stock.`;
  }
  if ("unit" in e && canon(e.unit) !== canon(row.unit)) {
    return `${row.itemName} was logged at the machine in ${row.unit}, and its stock moved in that unit — the unit cannot be changed here.`;
  }
  return null;
}

/** What the route needs to turn an update into columns. Functions rather than
 *  maps so the pure rule owns no database shape. */
export interface PatchContext {
  /** The row is source='floor': item and unit are never rewritten, even when
   *  carried (floorEditProblem has already confirmed they are unchanged). */
  fromFloor: boolean;
  /** The stock row an item name links to, by case-insensitive name, or
   *  undefined when the store has no such item (the line saves unlinked). */
  stockFor: (itemName: string) => { id: string; itemName: string } | undefined;
  /** The consumables department id a station files under. */
  departmentFor: (station: string) => string;
  by: string;
  at: Date;
}

/** THE COLUMNS ONE UPDATE REWRITES — AND ONLY THOSE. Every key here is
 *  conditional on the edit carrying that field, which is what makes an absent
 *  field mean "leave it alone": the route spreads this into updateMany's data
 *  and nothing else, so a stale copy of the sheet cannot revert a column its
 *  saver never touched. An empty result is a no-op the route skips. */
export function updatePatch(e: UsageUpdate, ctx: PatchContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("itemName" in e && !ctx.fromFloor) {
    const typed = String(e.itemName ?? "").trim();
    const stock = ctx.stockFor(typed);
    // THE ITEM'S NAME IS THE STOCK ROW'S NAME whenever the line is linked to
    // one. Typing "gloves" against the "Gloves" row used to save the typed
    // spelling while linking to the row, so every dashboard that groups by
    // itemName showed two items that were one.
    out.itemName = stock?.itemName ?? typed;
    out.inventoryStockId = stock?.id ?? null;
  }
  if ("quantity" in e) out.quantity = Number(e.quantity);
  if ("unit" in e && !ctx.fromFloor) out.unit = String(e.unit ?? "").trim() || "PCS";
  if ("station" in e) {
    const station = String(e.station ?? "");
    out.station = station;
    // The department follows the station, or a line moved between stations
    // would keep reporting under the old one.
    out.departmentId = ctx.departmentFor(station);
  }
  if ("operatorName" in e) out.operatorName = e.operatorName ?? null;
  const priced = pricePatch(e, ctx.by, ctx.at);
  if (priced) Object.assign(out, priced);
  return out;
}

/** THE CLIENT HALF OF THE SAME RULE: one draft row into what the save sends.
 *  A new row (no id) is sent whole. An existing row is sent as `id` plus every
 *  field whose trimmed text differs from `before` — the copy the sheet loaded —
 *  and nothing else. `before` undefined (a row the baseline never saw) sends
 *  every field, which is the safe direction: it writes what is on screen. */
export function wireEdit(d: DraftShape & { id?: string }, before: DraftShape | undefined): UsageEdit {
  const item = d.itemName.trim();
  const unit = d.unit.trim() || "PCS";
  const person = d.operatorName.trim() || null;
  const price = d.unitPrice.trim() === "" ? null : Number(d.unitPrice.trim());
  if (!d.id) {
    return { station: d.station, itemName: item, quantity: Number(d.quantity.trim() || 0), unit, operatorName: person, unitPrice: price };
  }
  const moved = (k: keyof DraftShape) => !before || before[k].trim() !== d[k].trim();
  const out: UsageUpdate = { id: d.id };
  if (moved("station")) out.station = d.station;
  if (moved("itemName")) out.itemName = item;
  // A cleared quantity box is 0 here on purpose: editProblem refuses 0 on an
  // existing line with a sentence, which is better than guessing what was meant.
  if (moved("quantity")) out.quantity = Number(d.quantity.trim());
  if (moved("unit")) out.unit = unit;
  if (moved("unitPrice")) out.unitPrice = price;
  if (moved("operatorName")) out.operatorName = person;
  return out;
}

/** The name a save is signed with. The login's trimmed name, else its email,
 *  else "unknown" — never "". `name ?? email` let a login whose name was the
 *  empty string sign a price as pricedBy "" (found 2026-09-05), and a blank
 *  author beside a rupee figure is exactly what pricedBy exists to prevent. */
export function saverName(name: unknown, email: unknown): string {
  return String(name ?? "").trim() || String(email ?? "").trim() || "unknown";
}

/** WHICH STOCK ROWS THE SHEET OFFERS AND LINKS. The same filter the machine
 *  forms apply (entry/mixer, entry/slab/[model]): DIRECT_MATERIAL is resin and
 *  grit, received against invoices and consumed by the recipe, and nobody logs
 *  it from a station. Until 2026-09-05 the sheet's list was unfiltered, so the
 *  two screens that write one batch's consumables offered two different lists
 *  and the sheet would link a "Resin" line to the resin stock row. Spelled as
 *  a Prisma `where` so both readers pass the one object. */
export const SHEET_ITEM_WHERE = { category: { not: "DIRECT_MATERIAL" } } as const;
