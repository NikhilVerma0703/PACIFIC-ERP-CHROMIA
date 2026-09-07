/**
 * The filter behind GET /api/robo/production — the "Find a Slab" box on Slabs
 * Records.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * setupMasters.ts uses.
 *
 * Batch Number is matched by the ROUTE, not here. "D-1372", "d1372" and a bare
 * "1372" are the same batch and "A-1248" is not "D-1248" — a rule no Prisma
 * `contains` can express (see batchNo.ts). So the route folds the typed number
 * to the set of setup ids it names (batchFilter.ts) and hands them in as
 * `batchRecipeIds`; this narrows on the scalar `batchRecipeId` FK. That also
 * retires the old hazard this module was written around — batch and design both
 * writing `where.batchRecipe`, the second silently clobbering the first — since
 * only Design Name lives on that relation now. It stays a module, and stays
 * pinned in tests/roboSlabSearch.test.ts, so the composition can't quietly rot.
 */

// The .ts is deliberate: this module is reached by `node --test`, whose ESM
// resolver does not add extensions. tsconfig sets allowImportingTsExtensions
// and the bundler resolves the exact path, so it is correct in both.
import { productionDateWhere } from "./productionDate.ts";

export interface SlabSearchInput {
  shiftId?: string | null;
  /**
   * Production date. Matched against the date the OPERATOR entered on the
   * setup, falling back to the shift's own date only where there is none —
   * exactly what the Production Date column shows. See productionDate.ts: a
   * shift's date is the day the tablet was open, and matching on it sent
   * anyone searching for last Thursday's run back an empty table.
   */
  date?: string | null;
  slabNumber?: string | null;
  designName?: string | null;
  /**
   * The setups whose batch number matches what the operator typed, already
   * resolved to ids by the route (matchingBatchRecipeIds over batchNo.ts).
   *
   * `null` means no batch filter. An empty array means a batch WAS searched and
   * nothing matched — a real filter that returns no rows, which is different
   * from no filter and must narrow to zero, not be ignored.
   */
  batchRecipeIds?: string[] | null;
}

/** What the route hands Prisma, and whether the caller filtered at all. */
export interface SlabSearchWhere {
  where: {
    shiftId?: string;
    slabNumber?: { contains: string };
    /** The setup this slab was logged against, matched by resolved id. */
    batchRecipeId?: { in: string[] };
    /** Design Name is the only filter left on the related setup. */
    batchRecipe?: { designName: { contains: string } };
    /**
     * The production-date match, which spans two relations — see
     * productionDateWhere. It sits alongside the other keys rather than inside
     * `batchRecipe`: Prisma ANDs the top-level keys, so a date and a design
     * narrow each other instead of one replacing the other.
     */
    OR?: NonNullable<ReturnType<typeof productionDateWhere>>["OR"];
  };
  hasFilters: boolean;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

export function slabSearchWhere(input: SlabSearchInput): SlabSearchWhere {
  const shiftId = clean(input.shiftId);
  const date = clean(input.date);
  const slabNumber = clean(input.slabNumber);
  const designName = clean(input.designName);
  const batchRecipeIds = input.batchRecipeIds ?? null;

  const where: SlabSearchWhere["where"] = {};
  if (shiftId) where.shiftId = shiftId;
  const dateWhere = productionDateWhere(date);
  if (dateWhere) where.OR = dateWhere.OR;
  if (slabNumber) where.slabNumber = { contains: slabNumber };

  // A null is "no batch filter"; an array — even an empty one — is a filter.
  // `{ in: [] }` matches nothing, which is exactly right for a batch number the
  // operator typed that names no setup: an empty table, not the whole register.
  if (batchRecipeIds !== null) where.batchRecipeId = { in: batchRecipeIds };

  // Design Name is the lone remaining filter on the related setup, so it is set
  // directly — no second writer to clobber it now that batch matches by id.
  if (designName) where.batchRecipe = { designName: { contains: designName } };

  return {
    where,
    hasFilters: Boolean(shiftId || date || slabNumber || designName || batchRecipeIds !== null),
  };
}

/** The most a caller may pull in one page, even by asking — a guard on the
 *  explicit `?limit=`, not on a filtered search. */
export const SLAB_LIST_MAX_TAKE = 500;
/** The window for browsing the whole register with no filter: the latest few,
 *  because that set is unbounded and no one wants every slab ever made at once. */
export const SLAB_LIST_DEFAULT_TAKE = 25;

/**
 * How many rows GET /api/robo/production returns — as a `take` for Prisma, where
 * `undefined` means NO limit (every matching row).
 *
 * A FILTERED search returns every match: pick a batch and you get the whole
 * batch, not its newest 200. This is the bug behind "batch 1423 shows 200 but
 * Reports and Downloads show all 301" — those screens run the same filter with
 * no cap (see exports/production and reports/*), and this brings Slabs Records
 * into line with them, and with Chromia's Slab Records, which shows every match
 * on one page for the same reason: someone working a batch wants all of it in
 * front of them. A truncated list is worse than slow — it silently hides slabs,
 * and the operator has no way to tell 200-of-301 from "that is all there is".
 *
 * Unfiltered browsing of the whole register stays capped at the latest 25,
 * because that set has no bound. An explicit `?limit=` still wins for a caller
 * that wants a set size, capped at 500 so one request can't pull the register.
 */
export function slabListTake(limitParam: number, hasFilters: boolean): number | undefined {
  if (Number.isFinite(limitParam) && limitParam > 0) {
    return Math.min(Math.trunc(limitParam), SLAB_LIST_MAX_TAKE);
  }
  return hasFilters ? undefined : SLAB_LIST_DEFAULT_TAKE;
}
