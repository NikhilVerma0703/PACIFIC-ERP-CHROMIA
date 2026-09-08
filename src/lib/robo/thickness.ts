/**
 * What "Thickness" means for a Robo slab, in one place.
 *
 * Pure and alias-free so `node --test` can reach it — the same split
 * productionDate.ts uses for the date.
 *
 * THE SHAPE OF THE PROBLEM. A slab's thickness lived only on its batch setup
 * (`RoboBatchRecipe.thickness`), one value shared by the whole run, and that is
 * what every screen and export read. A per-slab column exists on
 * `RoboProductionRecord.thickness` but nothing displayed it: the entry form
 * never wrote it and the import wrote thickness to the setup only, so it was
 * NULL on every slab in the database.
 *
 * A batch can change thickness partway through, though — it starts on one and
 * later slabs come off on another — and there was no way to record that without
 * splitting the batch. So the per-slab column now becomes the OVERRIDE: a slab
 * carries its own thickness when it differs from the run's, exactly the way
 * `productionDate` lets a slab carry its own day when the batch crosses
 * midnight. This reads that override, falling back to the setup.
 *
 * INVARIANT (mirrors productionDate): the per-slab column is a real number or
 * NULL, never a stray 0 standing in for "unset" — every writer stores a parsed
 * number or `null`. So "no per-slab thickness" is exactly NULL, and the reader
 * below can use `?? ` to fall back. Because every existing row is NULL, turning
 * this on changes nothing already saved: they all fall through to the setup's
 * thickness, which is what they showed before.
 */

/** The shapes this needs, structural so any query shape satisfies them. */
export interface ThickSetup {
  thickness?: number | null;
}
export interface ThickRecord {
  /** The slab's OWN thickness, when it differs from the batch's. Highest
   *  precedence: a run that changes thickness partway carries the new value on
   *  the later slabs while the setup keeps the run's first thickness. A real
   *  number or NULL, never 0-for-unset — so the fallback can gate on `?? `. */
  thickness?: number | null;
  batchRecipe?: ThickSetup | null;
}

/**
 * The thickness to SHOW for a slab: its own per-slab thickness if it has one,
 * else the thickness entered on the batch setup, else null. The per-slab value
 * is what lets one batch carry more than one thickness — see ThickRecord.
 *
 * `?? ` and not `||`, deliberately: a real slab can be 0-something only in
 * theory, but a `||` would still treat any future 0 as absent, and the whole
 * point of the invariant is that NULL alone means "unset". So the override
 * wins whenever it is non-null, including the (unreal-but-correct) 0.
 */
export function roboThicknessOf(record: ThickRecord | null | undefined): number | null {
  return record?.thickness ?? record?.batchRecipe?.thickness ?? null;
}

/** The same value as a string key, for grouping a forward run of same-thickness
 *  slabs: null becomes "" so "no thickness" is one bucket, and a number is its
 *  own text. Used by the range editor to find where a thickness changes. */
export function roboThicknessKey(record: ThickRecord | null | undefined): string {
  const t = roboThicknessOf(record);
  return t === null ? "" : String(t);
}
