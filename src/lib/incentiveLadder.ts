// The money side of the shift incentive: the pool ladder and the pay bands.
//
// THESE ARE COPIES, AND THE TEST SAYS SO. The figures were decided on
// 2026-08-06 and live in scripts/make-incentive-notice-pdf.py, which prints the
// notice on the wall. Python cannot be imported here and TypeScript cannot be
// imported there, so this file restates them — and tests/incentiveMath.test.ts
// reads the Python source and refuses to pass if the two ever disagree. A
// notice promising one ladder while the ERP pays another is worse than no
// notice; see the same argument beside FLOOR_PCT in that script.
//
// Import-free, so node --test and client components both reach it.

/** Good slabs in the month -> the pool everyone shares. A STEP ladder, not a
 *  slope: 7,999 pays the 7,000 row. Below the first row there is no pool. */
export const TIERS: readonly { slabs: number; pool: number }[] = [
  { slabs: 7_000, pool: 300_000 },
  { slabs: 8_000, pool: 600_000 },
  { slabs: 9_000, pool: 800_000 },
  { slabs: 10_000, pool: 1_300_000 },
  { slabs: 11_000, pool: 1_700_000 },
  { slabs: 12_000, pool: 2_500_000 },
];

export const FLOOR_SLABS = TIERS[0].slabs;

/** The pool a counted-good-slab total unlocks; 0 below the floor. */
export function poolFor(countedSlabs: number): number {
  let pool = 0;
  for (const t of TIERS) if (countedSlabs >= t.slabs) pool = t.pool;
  return pool;
}

/** The next row up, or null at the top of the ladder. */
export function nextTier(countedSlabs: number): { slabs: number; pool: number } | null {
  return TIERS.find((t) => countedSlabs < t.slabs) ?? null;
}

/** Who is on the line and what they are paid. Lowest paid first — the tables
 *  read down the ladder. Headcount recorded 2026-08-06, still marked
 *  provisional in the notice pending HR. */
export const ROLES: readonly { key: string; label: string; heads: number; pay: number }[] = [
  { key: "operator", label: "Operator", heads: 75, pay: 20_000 },
  { key: "supervisor", label: "Supervisor / Incharge", heads: 30, pay: 52_500 },
  { key: "catB", label: "Category B (R&D)", heads: 2, pay: 75_000 },
  { key: "manager", label: "Manager", heads: 5, pay: 175_000 },
];

/** The monthly production salary bill — what turns a pool into a percentage. */
export const SALARY_BILL = ROLES.reduce((a, r) => a + r.heads * r.pay, 0);
export const HEADCOUNT = ROLES.reduce((a, r) => a + r.heads, 0);

/** A shift letter's slice of the pool as a percentage of salary, on the
 *  notice's assumption that the bill is split equally across the three
 *  shifts. There is no roster that says otherwise; if one appears, pass the
 *  real per-shift bill instead. */
export function pctOfSalary(shareOfPool: number, pool: number, shiftBill = SALARY_BILL / 3): number {
  return shiftBill > 0 ? (shareOfPool * pool) / shiftBill : 0;
}

/** What one person in each band takes home at that percentage, whole rupees. */
export function bandAmounts(pct: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of ROLES) out[r.key] = Math.round(r.pay * pct);
  return out;
}
