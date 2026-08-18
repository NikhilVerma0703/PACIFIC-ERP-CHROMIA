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

export interface SlabSearchInput {
  shiftId?: string | null;
  /** Production date, matched against the shift's own yyyy-mm-dd date. */
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
    shift?: { date: string };
    slabNumber?: { contains: string };
    batchRecipe?: { designName?: { contains: string }; batchNo?: { contains: string } };
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
  if (date) where.shift = { date };
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
