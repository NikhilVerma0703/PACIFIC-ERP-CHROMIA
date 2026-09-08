/**
 * "Apply this from here onward" — the forward run of slabs a range edit touches.
 *
 * Pure and alias-free so `node --test` can reach it. The PATCH handler does the
 * database work (see api/robo/production/[id]/route.ts); this decides WHICH
 * slabs are in the range, and nothing else, so the rule can be tested on its
 * own and read in one place.
 *
 * THE RULE. A batch can change its Production Date or its Thickness partway
 * through — a run crosses midnight, or the line switches to a different slab
 * thickness mid-batch — but the register was saved with one value on the whole
 * run. To correct it without editing every slab by hand, the operator opens the
 * slab where the change BEGINS, sets the new value, and asks for it to carry
 * forward. This computes exactly how far "forward" goes:
 *
 *   start at the edited slab, and include every following slab, in S.No. order,
 *   that currently shows the SAME value the edited slab shows — stopping at the
 *   first slab that already shows something different, or at the end of the
 *   batch.
 *
 * So on a batch that is all one date, editing S.No. 18 -> 20 Aug takes 18 to the
 * end. Do 111 -> 21 Aug first and then 18 -> 20 Aug, and the 18 edit stops at
 * 110 because 111 already reads 21 Aug. Either order lands on 1-17 = the
 * original day, 18-110 = 20 Aug, 111-123 = 21 Aug. And a slab BEFORE the edited
 * one is never in the run, so previously-saved earlier slabs cannot move — which
 * is the one thing a bulk edit must never get wrong.
 *
 * "Same value" is compared as a string KEY the caller supplies (the effective
 * production date, or the effective thickness) so this stays ignorant of which
 * field is being ranged and how each falls back to the batch setup.
 */

export interface RunSlab {
  id: string;
}

/**
 * The ids to update: the edited slab and the contiguous following slabs that
 * share its current value, in the order given.
 *
 * `ordered` MUST already be in the register's running order — S.No. ascending,
 * createdAt as the tiebreak — which is how the caller queries it (orderBy
 * serialNumber then createdAt). The run is read off that order directly; this
 * does not re-sort, so a caller that hands rows in the wrong order gets the
 * wrong run, deliberately: the one true order lives in the query.
 *
 * `keyOf` returns the slab's CURRENT effective value as a string — two slabs are
 * "the same" iff their keys are equal. The edited slab's key is read BEFORE the
 * new value is written (the caller computes the run first, then updates), so it
 * is the OLD value that defines the run, exactly as the rule requires.
 *
 * The edited slab is always in the result (a run of one is still a run), even if
 * `startId` is not found in `ordered` — then the result is just `[startId]`, so
 * a range save can never silently touch nothing.
 */
export function forwardRunIds<T extends RunSlab>(
  ordered: readonly T[],
  startId: string,
  keyOf: (slab: T) => string,
): string[] {
  const startIndex = ordered.findIndex((s) => s.id === startId);
  if (startIndex < 0) return [startId];

  const startKey = keyOf(ordered[startIndex]);
  const ids: string[] = [];
  for (let i = startIndex; i < ordered.length; i++) {
    if (keyOf(ordered[i]) !== startKey) break;
    ids.push(ordered[i].id);
  }
  return ids;
}

/**
 * The register's running order for a batch's slabs: S.No. ascending, with
 * createdAt breaking a tie (two slabs sharing an S.No., or an S.No. left blank).
 * A null S.No. sorts LAST, the same as Postgres `ORDER BY ... ASC NULLS LAST`,
 * so the in-memory order here matches the query the caller uses.
 *
 * Provided so a caller working from an already-loaded list, and the tests, can
 * order rows the one agreed way instead of each re-deriving it.
 */
export function bySerialThenCreated<
  T extends { serialNumber?: number | null; createdAt?: Date | string | null },
>(a: T, b: T): number {
  const as = a.serialNumber;
  const bs = b.serialNumber;
  if (as == null && bs != null) return 1;
  if (as != null && bs == null) return -1;
  if (as != null && bs != null && as !== bs) return as - bs;
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return at - bt;
}
