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
 * nonsense span (an 08:00 the next morning reads as "earlier" than 11:30). So
 * each time is paired with the slab's production date (productionDateOf, resolved
 * by the caller) into an absolute minute count, and the span is the real
 * distance between the earliest In and the latest Out.
 *
 * No timezone enters, matching the rest of the Robo module: the date anchors an
 * absolute-minutes value only so two of them can be subtracted, and the anchor
 * cancels in the difference. The clock is never consulted — an open run that has
 * never completed a slab has no Out Time, so no span, by design (not "up to now").
 */

/** A slab reduced to what the span needs: the day it was produced (already
 *  resolved through productionDateOf — a yyyy-mm-dd, or "" when unknown) and its
 *  clock In / Out, each nullable. */
export interface SpanSlab {
  productionDate: string;
  inTime: string | null | undefined;
  outTime: string | null | undefined;
}

/**
 * Absolute minutes for a yyyy-mm-dd date + "HH:MM" time, with the date treated as
 * a UTC-midnight anchor. Used only for DIFFERENCES between two of these, so the
 * anchor and any timezone cancel. Returns null when either part is missing or
 * unparseable, so a slab with no date, or no In (or no Out) time, is simply
 * skipped rather than counted as midnight.
 */
export function stampMinutes(date: string, time: string | null | undefined): number | null {
  const d = (date ?? "").trim();
  const t = (time ?? "").trim();
  if (!d || !t) return null;
  const dayMs = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(dayMs)) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return dayMs / 60000 + h * 60 + m;
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
  for (const s of slabs) {
    const inAt = stampMinutes(s.productionDate, s.inTime);
    if (inAt !== null && (firstIn === null || inAt < firstIn)) firstIn = inAt;
    const outAt = stampMinutes(s.productionDate, s.outTime);
    if (outAt !== null && (lastOut === null || outAt > lastOut)) lastOut = outAt;
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
