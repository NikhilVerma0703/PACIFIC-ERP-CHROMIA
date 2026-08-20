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
 * The production date to SHOW for a slab (or a setup row): what the operator
 * entered, else the shift's own date, else "".
 */
export function productionDateOf(record: DatedRecord | null | undefined): string {
  return clean(record?.batchRecipe?.productionDate) || clean(record?.shift?.date);
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
 * Three cases, because the fallback has to be expressed in SQL:
 *   1. the setup carries the date        → match it
 *   2. the setup carries none            → match the shift's date
 *   3. there is no setup at all          → match the shift's date
 *
 * Case 2 has to say `productionDate` is unset EXPLICITLY. Without it a slab
 * whose setup is dated the 3rd would also come back when searching the 5th,
 * because its shift row happens to say the 5th — the very confusion this
 * replaces. And "unset" has to mean NULL or "", one branch each:
 * productionDateOf() treats a blank string as no date and falls back to the
 * shift, so a filter that only matched NULL would print a date on a row nothing
 * could find. The app's own writes blank-to-null (setupScalarData), but rows
 * arrive from the upstream standalone app and from direct API calls too.
 *
 * Returns undefined for a blank date so callers can spread it unconditionally.
 */
export function productionDateWhere(date: string | null | undefined) {
  const d = clean(date);
  if (!d) return undefined;
  return {
    OR: [
      { batchRecipe: { productionDate: d } },
      { batchRecipe: { productionDate: null }, shift: { date: d } },
      { batchRecipe: { productionDate: "" }, shift: { date: d } },
      { batchRecipe: null, shift: { date: d } },
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

/** The production date to show for a delay log. */
export function delayProductionDateOf(delay: DatedDelay | null | undefined): string {
  return clean(delay?.productionRecord?.batchRecipe?.productionDate) || clean(delay?.shift?.date);
}

/** The Prisma `where` matching what delayProductionDateOf() displays. */
export function delayProductionDateWhere(date: string | null | undefined) {
  const d = clean(date);
  if (!d) return undefined;
  return {
    OR: [
      { productionRecord: { batchRecipe: { productionDate: d } } },
      { productionRecord: { batchRecipe: { productionDate: null } }, shift: { date: d } },
      { productionRecord: { batchRecipe: { productionDate: "" } }, shift: { date: d } },
      { productionRecord: { batchRecipe: null }, shift: { date: d } },
      { productionRecord: null, shift: { date: d } },
    ],
  };
}
