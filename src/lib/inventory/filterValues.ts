// Shared by the inventory filter UI (a client component) and buildInventoryWhere (server).
// Deliberately its own module: searchWhere.ts imports Prisma, so a "use client" file
// cannot import from it, and duplicating the literal is exactly the hand-sync drift the
// data-driven filter work exists to remove.

/** Filter value meaning "this column IS NULL" — 922 slabs have no grade, 3,525 no bay. */
export const NONE = "__none__";

/** Fold the spelling variations of one customer name onto a single key.
 *
 *  `customer` is free text typed at dispatch time, and the same customer is in the column
 *  under several spellings: "Surfaces by Pacific" (390 slabs), "SURFACES BY PACIFIC" (41)
 *  and "Surfaces by Pacific," (582) are one customer with 1,013 slabs. Matching the raw
 *  string exactly would answer "show me this customer" with a third of their stock, which
 *  is the same failure the design filter uses DesignAlias to avoid.
 *
 *  Deliberately conservative: case, surrounding whitespace, runs of internal whitespace,
 *  and trailing dots/commas only. It will not merge two genuinely different names. */
export const customerKey = (s: string): string =>
  s.trim().replace(/[.,\s]+$/, "").replace(/\s+/g, " ").toLowerCase();
