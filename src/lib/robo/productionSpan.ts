/**
 * Total Production Time for a set of filtered slabs: the LAST slab's Out Time
 * minus the FIRST slab's In Time, across exactly the slabs given and nothing
 * else. It is the Reports KPI of the same name — a batch that started at 11:30
 * and finished its last slab at 17:52 ran for 6h 22m.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * productionDate.ts / slabSearch.ts use.
 *
 * DATE-AWARE, ON PURPOSE. In and Out are wall-clock "HH:MM" strings with no day
 * of their own, so a min/max over the strings alone is only right inside one
 * day — a batch past midnight, or a filter spanning several days, would give a
 * nonsense span (an 08:00 the next morning reads as "earlier" than 11:30). Each
 * slab is placed on an absolute timeline by slabPlacement.ts — the SAME rule the
 * hourly chart uses, so this KPI and the chart under it always describe the
 * same run: a slab's own Out before its In is the next day, and a stored date
 * that jumps forward while the clock barely moved is ignored (it once pushed
 * batch 1432 to "35 hours" over an 11:00–23:00 chart).
 *
 * A filter can cover several batches. Each batch is its own run — its first
 * slab anchors its own day — because register serials restart per batch and
 * one batch's evening cannot tell the next batch's morning where it sits.
 *
 * No timezone enters, matching the rest of the Robo module: the date anchors an
 * absolute-minutes value only so two of them can be subtracted, and the anchor
 * cancels in the difference. The clock is never consulted — an open run that has
 * never completed a slab has no Out Time, so no span, by design (not "up to now").
 */

import { type PlaceableSlab, placeSlabs, registerOrder } from "./slabPlacement.ts";

/** A slab reduced to what the span needs: the day it was produced (already
 *  resolved through productionDateOf — a yyyy-mm-dd, or "" when unknown), its
 *  clock In / Out, each nullable, its register order, and the run (batch) it
 *  belongs to. */
export interface SpanSlab extends PlaceableSlab {
  productionDate: string;
  /** Which run this slab is part of (the batch setup id). Slabs sharing a key
   *  are placed as one sequence; absent, every slab is one run. */
  runKey?: string | null;
}

/**
 * Minutes from the earliest In Time to the latest Out Time across `slabs`.
 *
 * Returns null when no span can be formed — not one slab carries an In Time, or
 * none carries an Out Time (nothing is completed yet) — so the KPI shows "—"
 * rather than a fabricated 0 or a value off the wall clock. A negative result
 * (a data inconsistency, e.g. the only Out Time predates the only In Time) is
 * also null, never a wrong number.
 *
 * The earliest In and the latest Out are found independently: the first slab in
 * and the last slab out may be different slabs, which is exactly "when did the
 * run start" and "when did it finish".
 */
export function productionSpanMinutes(slabs: readonly SpanSlab[]): number | null {
  const runs = new Map<string, SpanSlab[]>();
  for (const s of slabs) {
    const key = s.runKey ?? "";
    const run = runs.get(key);
    if (run) run.push(s);
    else runs.set(key, [s]);
  }

  let firstIn: number | null = null;
  let lastOut: number | null = null;
  for (const run of runs.values()) {
    for (const { inAbs, outAbs } of placeSlabs(registerOrder(run))) {
      if (inAbs !== null && (firstIn === null || inAbs < firstIn)) firstIn = inAbs;
      if (outAbs !== null && (lastOut === null || outAbs > lastOut)) lastOut = outAbs;
    }
  }
  if (firstIn === null || lastOut === null) return null;
  const diff = lastOut - firstIn;
  return diff >= 0 ? diff : null;
}

/**
 * Avg Slabs/hour — the operator's definition: Total Slabs Produced ÷ the elapsed
 * batch duration, where the duration is the production span (first In → last Out,
 * `productionSpanMinutes`) with DELAYS LEFT IN, not subtracted. A batch of 46
 * slabs running 14:10 → 21:50 (7h 40m = 460 min) is 46 ÷ 7.6667 ≈ 6.0/hour.
 *
 * Built only from the recorded span, so it is deterministic — the same filtered
 * data always gives the same number, unlike the old figure that divided by shift
 * open-time measured up to the current clock and so drifted as a shift stayed
 * open. Rounded to one decimal, to match how it is shown.
 *
 * Returns null when there is no duration to divide by — no span (nothing has
 * completed), or a zero/negative one — so the KPI shows "—" rather than dividing
 * by zero or inventing a rate.
 */
export function avgSlabsPerHour(totalSlabs: number, spanMinutes: number | null): number | null {
  if (spanMinutes === null || spanMinutes <= 0) return null;
  return Math.round((totalSlabs / (spanMinutes / 60)) * 10) / 10;
}
