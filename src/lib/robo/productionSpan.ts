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
 * nonsense span (an 08:00 the next morning reads as "earlier" than 11:30).
 *
 * ── THE CHART'S OWN PLACEMENT — ONE FUNCTION, NOT TWO ─────────────────────
 * The two instants are hourlyProduction.runBounds: the SAME placeSlabs the
 * "Production Rate per Hour" chart draws with and its "first In → last Out"
 * subtitle names. So this KPI and the chart beneath it can never describe one
 * batch differently — a headline number that disagrees with the graph under it
 * is worse than either being wrong alone.
 *
 * The rule has moved twice, and moved with the chart each time:
 *   · until 2026-09-16, slabPlacement.ts rebuilt each slab's day from
 *     serialNumber order. serialNumber is mistyped and restarted on real runs,
 *     so whole batches drifted forward (1440 charted as 23–25 Sep, 1445 as
 *     18–20 Sep);
 *   · from 2026-09-16, each slab's OWN stored production date, as recorded;
 *   · from 2026-09-25, still the stored date — except for the two recording
 *     slips hourlyProduction.ts describes (a production date one day off; an
 *     Out the midnight rule pushed a day on), which read D-1432's run of
 *     31 Aug 11:20 → 22:31 (11h 11m) as 34h 40m and 3.6 slabs/hour. Such a
 *     slab is placed where the slabs made around it show it was made — at most
 *     one day from its stored date, checked within its own run.
 *
 * RUNS. `runKey` groups the slabs into runs (batches): a slab is only checked
 * against slabs of its own run, so on a filter spanning several batches one
 * batch's slabs never judge another's. Absent, the slabs are one run — right
 * for a single batch.
 *
 * No timezone enters, matching the rest of the Robo module: the date anchors an
 * absolute-minutes value only so two of them can be subtracted, and the anchor
 * cancels in the difference. The clock is never consulted — an open run that has
 * never completed a slab has no Out Time, so no span, by design (not "up to now").
 */

import { runBounds } from "./hourlyProduction.ts";

/** A slab reduced to what the span needs: the day it was produced (already
 *  resolved through productionDateOf — a yyyy-mm-dd, or "" when unknown), its
 *  clock In / Out, each nullable, its production order and the run (batch) it
 *  belongs to. */
export interface SpanSlab {
  productionDate: string;
  inTime: string | null;
  outTime: string | null;
  /** Production order — the plant's physical slab number, then entry time, then
   *  id (slabSequence.compareSlabOrder). Absent, the array order is the order. */
  slabNumber?: string | null;
  createdAtMs?: number | null;
  id?: string | null;
  /** Which run (batch) this slab is part of. Absent, every slab is one run. */
  runKey?: string | null;
}

/**
 * Minutes from the earliest In Time to the latest Out Time across `slabs`, each
 * slab placed exactly as the hourly chart places it.
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
  // ONE rule, shared with the chart — see the header.
  const { firstIn, lastOut } = runBounds(slabs);
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
