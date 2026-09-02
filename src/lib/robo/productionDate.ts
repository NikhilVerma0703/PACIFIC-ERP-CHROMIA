/**
 * What "Production Date" means, in one place.
 *
 * Pure and alias-free so `node --test` can reach it — the same split
 * setupMasters.ts, slabSearch.ts and setupAge.ts use.
 *
 * THE BUG THIS EXISTS TO FIX. Every screen showed today's date. Slab Records,
 * Complete Details and both Excel exports all read Production Date off
 * `RoboShift.date`, and a shift row is not something anybody fills in — it is
 * plumbing the schema requires, created silently by the entry form with
 * `localDate()`, i.e. the day the tablet was open. So a register being caught
 * up on Monday, for production that ran the previous Thursday, said Monday
 * everywhere, on every slab.
 *
 * The date the operator actually enters is `RoboBatchRecipe.productionDate`,
 * typed at the top of the batch setup. That is the production date. The shift's
 * own date is the fallback and nothing more: setups saved before that field
 * existed have none, and a slab logged without a setup has no setup to ask.
 *
 * Both are plain yyyy-mm-dd strings, the convention the whole Robo module uses,
 * so they compare and sort as text without a timezone anywhere near them.
 */

/** The shapes this needs, structural so any query shape satisfies them. */
export interface DatedSetup { productionDate?: string | null }
export interface DatedShift { date?: string | null }
export interface DatedRecord {
  /** The slab's OWN production date, when it has one. Highest precedence: a
   *  batch that runs past midnight has later slabs carrying their own day while
   *  the setup keeps the batch's start date. INVARIANT: a real yyyy-mm-dd or
   *  NULL, never "" (every writer stores `trim() || null`) — so the where
   *  fallback can gate on `productionDate: null` alone. See the model note. */
  productionDate?: string | null;
  batchRecipe?: DatedSetup | null;
  shift?: DatedShift | null;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** "No production date", as Postgres can hold it: NULL, or the empty string a
 *  non-app writer may have left. productionDateOf() reads both as absent, so
 *  the filter has to as well or a row would show a date it cannot be found by. */
/* ── A NOTE ON THE SHAPES BELOW ───────────────────────────────────────────
   The OR arrays are returned WITHOUT a type annotation, deliberately.

   Prisma's generated where-inputs use XOR<> and Without<> to keep a relation
   filter and a null-relation filter apart. A hand-written interface covering
   both arms — optional `batchRecipe` beside an optional `batchRecipeId?: null`
   — does not satisfy either, so annotating the array with one makes it
   unassignable at the call site even though the value itself is fine. Letting
   TypeScript infer the literal types keeps every branch checked against the
   real Prisma input where it is used.

   "Unset" is also written as two branches rather than `{ in: [null, ""] }`:
   Prisma's `in` filter takes `string[]`, not nulls, so that form does not
   express "IS NULL" at all — it typechecks nowhere and would have matched
   nothing. NULL and "" both have to be their own branch.                     */

/**
 * The production date to SHOW for a slab: its own per-slab date if it has one,
 * else what the operator entered on the setup, else the shift's own date, else
 * "". The per-slab date is what lets one batch span midnight — see DatedRecord.
 */
export function productionDateOf(record: DatedRecord | null | undefined): string {
  return (
    clean(record?.productionDate) ||
    clean(record?.batchRecipe?.productionDate) ||
    clean(record?.shift?.date)
  );
}

/** The same rule for a setup row, which carries its own shift. */
export function setupProductionDate(
  setup: (DatedSetup & { shift?: DatedShift | null }) | null | undefined,
): string {
  return clean(setup?.productionDate) || clean(setup?.shift?.date);
}

/**
 * The Prisma `where` for "slabs produced on this date", written to match what
 * productionDateOf() displays — otherwise a search would return rows whose
 * Production Date column says something else, which is worse than no search.
 *
 * The slab's own per-slab date comes first, then the setup/shift fallback:
 *   0. the slab carries its own date       → match it
 *   1. no slab date, the setup has one      → match it
 *   2. no slab date, the setup carries none → match the shift's date
 *   3. no slab date, there is no setup      → match the shift's date
 *
 * Branch 0 gates the rest: the four fallback branches all require
 * `productionDate: null`, so a slab with its own date is matched ONLY by that
 * date and never leaks into a setup/shift search for a different day. The
 * per-slab column is null-or-real (never "" — see DatedRecord), so `null` alone
 * is "no per-slab date"; no `""` branch is needed for it.
 *
 * The setup level still needs both NULL and "" spelled out — productionDateOf()
 * treats a blank setup date as absent and falls back to the shift, and setups
 * arrive from the upstream app and direct API calls that may have left "".
 *
 * Returns undefined for a blank date so callers can spread it unconditionally.
 */
export function productionDateWhere(date: string | null | undefined) {
  const d = clean(date);
  if (!d) return undefined;
  return {
    OR: [
      { productionDate: d },
      { productionDate: null, batchRecipe: { productionDate: d } },
      { productionDate: null, batchRecipe: { productionDate: null }, shift: { date: d } },
      { productionDate: null, batchRecipe: { productionDate: "" }, shift: { date: d } },
      { productionDate: null, batchRecipe: null, shift: { date: d } },
    ],
  };
}

/**
 * The setups themselves, for the Production Setup sheet of the export. Same
 * rule as above minus the third branch: RoboBatchRecipe.shiftId is required,
 * so a setup always has a shift to fall back to.
 */
export function setupProductionDateWhere(date: string | null | undefined) {
  const d = clean(date);
  if (!d) return undefined;
  // No "there is no setup" branch: this IS the setup, and RoboBatchRecipe.shiftId
  // is required, so there is always a shift to fall back to.
  return {
    OR: [
      { productionDate: d },
      { productionDate: null, shift: { date: d } },
      { productionDate: "", shift: { date: d } },
    ],
  };
}

/* ── delays ───────────────────────────────────────────────────────────────
   A delay log points at the slab it held up and at the shift it was logged
   in. Its production date is the SLAB's, so a delay and the slab it delayed
   never fall on two different days in the same workbook — with the shift's
   date as the fallback, and one extra case the slab does not have: a delay
   logged against no slab at all (RoboDelayLog.productionRecordId is nullable),
   which only the shift can date.                                            */

export interface DatedDelay {
  productionRecord?: DatedRecord | null;
  shift?: DatedShift | null;
}

/** The production date to show for a delay log: its slab's own per-slab date,
 *  else that slab's setup date, else the shift's. Same precedence as a slab. */
export function delayProductionDateOf(delay: DatedDelay | null | undefined): string {
  return (
    clean(delay?.productionRecord?.productionDate) ||
    clean(delay?.productionRecord?.batchRecipe?.productionDate) ||
    clean(delay?.shift?.date)
  );
}

/** The Prisma `where` matching what delayProductionDateOf() displays. Same
 *  per-slab-date-first shape as productionDateWhere, one relation deeper, plus
 *  the slab-less delay that only the shift can date. */
export function delayProductionDateWhere(date: string | null | undefined) {
  const d = clean(date);
  if (!d) return undefined;
  return {
    OR: [
      { productionRecord: { productionDate: d } },
      { productionRecord: { productionDate: null, batchRecipe: { productionDate: d } } },
      { productionRecord: { productionDate: null, batchRecipe: { productionDate: null } }, shift: { date: d } },
      { productionRecord: { productionDate: null, batchRecipe: { productionDate: "" } }, shift: { date: d } },
      { productionRecord: { productionDate: null, batchRecipe: null }, shift: { date: d } },
      { productionRecord: null, shift: { date: d } },
    ],
  };
}

/* ── ranges ──────────────────────────────────────────────────────────────
   The "Date Range" filter on Reports and Downloads: every slab whose Production
   Date falls between From and To, both ends included. Exactly the cases the
   single-date builders above have — the date is the setup's, else the shift's —
   with the one exact match swapped for a bounded one on whichever field is the
   date source.

   Both bounds are optional: a From alone means "from that day onward", a To
   alone means "up to that day", and neither is no filter at all, so the builder
   returns undefined and the caller spreads nothing. yyyy-mm-dd compares as text
   exactly as it compares as a date, so gte/lte draw a real window with no
   timezone in sight. */

/** The gte/lte pair for a [from, to] window, either bound omittable; undefined
 *  when neither is set, so a range with both fields blank is simply no filter. */
function dateRange(from: string | null | undefined, to: string | null | undefined) {
  const lo = clean(from);
  const hi = clean(to);
  if (!lo && !hi) return undefined;
  const r: { gte?: string; lte?: string } = {};
  if (lo) r.gte = lo;
  if (hi) r.lte = hi;
  return r;
}

/**
 * "Slabs produced between From and To", written to match productionDateOf() the
 * same way productionDateWhere() does — the four cases, ranged.
 *
 * The setup-dated branch carries `not: ""` so the no-date marker stays out of
 * it even when the low bound is open: an empty productionDate means "fall back
 * to the shift", and it is the shift-fallback branches that own it. With a real
 * From the guard is redundant (an empty string is already below any date) but
 * harmless, and with an open low bound it is what stops a `{ lte: to }` from
 * quietly matching every date-less row.
 */
export function productionDateRangeWhere(
  from: string | null | undefined,
  to: string | null | undefined,
) {
  const range = dateRange(from, to);
  if (!range) return undefined;
  return {
    OR: [
      // The slab's own date, in range. Null is excluded by SQL comparison, and
      // the per-slab column never holds "" (see DatedRecord), so this needs no
      // `not: ""`; the fallback branches below take over when it is null.
      { productionDate: range },
      { productionDate: null, batchRecipe: { productionDate: { ...range, not: "" } } },
      { productionDate: null, batchRecipe: { productionDate: null }, shift: { date: range } },
      { productionDate: null, batchRecipe: { productionDate: "" }, shift: { date: range } },
      { productionDate: null, batchRecipe: null, shift: { date: range } },
    ],
  };
}

/** The setups themselves, ranged — same as setupProductionDateWhere minus the
 *  "no setup" branch, because this IS the setup and its shift is required. */
export function setupProductionDateRangeWhere(
  from: string | null | undefined,
  to: string | null | undefined,
) {
  const range = dateRange(from, to);
  if (!range) return undefined;
  return {
    OR: [
      { productionDate: { ...range, not: "" } },
      { productionDate: null, shift: { date: range } },
      { productionDate: "", shift: { date: range } },
    ],
  };
}

/** Delays, ranged — the six cases of delayProductionDateWhere, windowed. */
export function delayProductionDateRangeWhere(
  from: string | null | undefined,
  to: string | null | undefined,
) {
  const range = dateRange(from, to);
  if (!range) return undefined;
  return {
    OR: [
      { productionRecord: { productionDate: range } },
      { productionRecord: { productionDate: null, batchRecipe: { productionDate: { ...range, not: "" } } } },
      { productionRecord: { productionDate: null, batchRecipe: { productionDate: null } }, shift: { date: range } },
      { productionRecord: { productionDate: null, batchRecipe: { productionDate: "" } }, shift: { date: range } },
      { productionRecord: { productionDate: null, batchRecipe: null }, shift: { date: range } },
      { productionRecord: null, shift: { date: range } },
    ],
  };
}

/* ── one filter from a screen's selection ──────────────────────────────────
   Reports and Downloads offer All / Date Wise / Date Range. Range beats a
   single date: if a From or To is present it wins, so a stale `date` left in
   state never leaks into a range query. Each combinator returns exactly what
   its single-date and range builders return — an OR block, or undefined for
   "no date filter" — so the routes go on spreading it unconditionally. */

export interface DateSelection {
  /** The single "Date Wise" day. */
  date?: string | null;
  /** The "Date Range" bounds, either omittable. */
  from?: string | null;
  to?: string | null;
}

function isRange(sel: DateSelection): boolean {
  return Boolean(clean(sel.from) || clean(sel.to));
}

/** The production-record where for a screen's date selection. */
export function productionDateSelectWhere(sel: DateSelection) {
  return isRange(sel)
    ? productionDateRangeWhere(sel.from, sel.to)
    : productionDateWhere(sel.date);
}

/** The setup where for a screen's date selection. */
export function setupProductionDateSelectWhere(sel: DateSelection) {
  return isRange(sel)
    ? setupProductionDateRangeWhere(sel.from, sel.to)
    : setupProductionDateWhere(sel.date);
}

/** The delay-log where for a screen's date selection. */
export function delayProductionDateSelectWhere(sel: DateSelection) {
  return isRange(sel)
    ? delayProductionDateRangeWhere(sel.from, sel.to)
    : delayProductionDateWhere(sel.date);
}
