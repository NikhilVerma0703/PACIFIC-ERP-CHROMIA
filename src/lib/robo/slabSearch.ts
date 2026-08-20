/**
 * The filter behind GET /api/robo/production — the "Find a Slab" box on Slabs
 * Records.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * setupMasters.ts uses. It exists as a module rather than a few lines in the
 * route for one reason: two of the filters live on the SAME relation. Written
 * inline, the second `where.batchRecipe = {...}` silently replaces the first,
 * so searching a batch number AND a design would quietly ignore one of them and
 * return rows that match only the other. Building the relation filter once, and
 * pinning it in tests/roboSlabSearch.test.ts, is what stops that coming back.
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
  /** The batch number written on the setup this slab was logged against. */
  batchNo?: string | null;
}

/** What the route hands Prisma, and whether the caller filtered at all. */
export interface SlabSearchWhere {
  where: {
    shiftId?: string;
    slabNumber?: { contains: string };
    batchRecipe?: { designName?: { contains: string }; batchNo?: { contains: string } };
    /**
     * The production-date match, which spans two relations — see
     * productionDateWhere. It sits alongside `batchRecipe` rather than inside
     * it: Prisma ANDs the top-level keys, so a date and a design narrow each
     * other instead of one replacing the other.
     */
    /** The production-date branches, as productionDateWhere builds them. */
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
  const batchNo = clean(input.batchNo);

  const where: SlabSearchWhere["where"] = {};
  if (shiftId) where.shiftId = shiftId;
  // Assigned field by field, NOT Object.assign: that helper's signature is
  // `(target: T, source: U) => T & U`, so it never checks the source against
  // the target and a productionDateWhere that changed shape would slip through
  // unnoticed — in the one module written to stop two things drifting apart.
  const dateWhere = productionDateWhere(date);
  if (dateWhere) where.OR = dateWhere.OR;
  if (slabNumber) where.slabNumber = { contains: slabNumber };

  // Both of these narrow the SAME related setup, so they are collected into one
  // object and applied together — that is the AND the operator expects when
  // they type a batch number and a design.
  const recipe: NonNullable<SlabSearchWhere["where"]["batchRecipe"]> = {};
  if (designName) recipe.designName = { contains: designName };
  if (batchNo) recipe.batchNo = { contains: batchNo };
  if (Object.keys(recipe).length > 0) where.batchRecipe = recipe;

  return { where, hasFilters: Boolean(shiftId || date || slabNumber || designName || batchNo) };
}
