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
 * ── THE SAME RULE AS THE CHART, AND IT CHANGED ON 2026-09-16 ───────────────
 * Each slab is placed by hourlyProduction.placeByStoredDate — the SAME single
 * function the "Production Rate per Hour" chart uses, so this KPI and the chart
 * under it can never describe one batch differently.
 *
 * Until that date both used slabPlacement.ts, which rebuilt each slab's day
 * from serialNumber order plus time-wrap detection. serialNumber turned out to
 * be unreliable on real runs — mistyped, restarted, duplicated — so the walk
 * ran out of order, every out-of-order step read as a midnight crossing, and
 * whole batches drifted forward: 1440 (8–10 Sep) charted as 23–25 Sep, 1445
 * (15–16 Sep) as 18–20 Sep. The cure was to stop reconstructing and trust the
 * production date the operator actually recorded, and the KPI moved with the
 * chart rather than being left on the old rule — a headline number that
 * disagrees with the graph beneath it is worse than either being wrong alone.
 *
 * A genuinely wrong stored date is corrected on the slab (Slab Records → Edit),
 * not reconstructed away here.
 *
 * NO RUN GROUPING ANY MORE. The old rule needed it: a run's first slab anchored
 * the day for the rest, so slabs of different batches could not be placed in
 * one sequence. Placement is now per-slab and independent, so `runKey` no
 * longer affects the answer — it is kept on the type because callers pass it
 * and removing it would be a churn of its own.
 *
 * No timezone enters, matching the rest of the Robo module: the date anchors an
 * absolute-minutes value only so two of them can be subtracted, and the anchor
 * cancels in the difference. The clock is never consulted — an open run that has
 * never completed a slab has no Out Time, so no span, by design (not "up to now").
 */

import { dayNum, toMins } from "./slabPlacement.ts";
import { placeByStoredDate } from "./hourlyProduction.ts";

/** A slab reduced to what the span needs: the day it was produced (already
 *  resolved through productionDateOf — a yyyy-mm-dd, or "" when unknown), its
 *  clock In / Out, each nullable, its register order, and the run (batch) it
 *  belongs to. */
export interface SpanSlab {
  productionDate: string;
  inTime: string | null;
  outTime: string | null;
  /** Which run this slab is part of (the batch setup id). Slabs sharing a key
   *  are placed as one sequence; absent, every slab is one run. */
  runKey?: string | null;
}

/**
 * Absolute minutes for a yyyy-mm-dd date + "HH:MM" time, the date treated as a
 * UTC-midnight anchor. Used only for DIFFERENCES between two of these, so the
 * anchor and any timezone cancel. Null when either part is missing or
 * unparseable, so a slab with no date or no time is skipped rather than counted
 * as midnight.
 *
 * Built on the shared helpers rather than parsing the strings again: the delay
 * anchoring in referenceData.ts and the placement the chart and the KPIs share
 * must agree about what a date and a clock time mean.
 */
export function stampMinutes(date: string, time: string | null | undefined): number | null {
  const dn = dayNum(date);
  const m = toMins(time);
  if (dn === null || m === null) return null;
  return dn * 1440 + m;
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
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  for (const slab of slabs) {
    // ONE rule, shared with the chart — see the header.
    const { inAbs, outAbs } = placeByStoredDate(slab);
    if (inAbs !== null && (firstIn === null || inAbs < firstIn)) firstIn = inAbs;
    if (outAbs !== null && (lastOut === null || outAbs > lastOut)) lastOut = outAbs;
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
