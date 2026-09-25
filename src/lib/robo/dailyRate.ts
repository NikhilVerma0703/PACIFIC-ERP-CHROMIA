/**
 * "Daily Slabs / Hour Trend" — the Reports' Trend Analysis rate, by DATE.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 *   Daily Slabs/hour = slabs produced on that date ÷ hours the Robo line ran on
 *                      that date.
 *
 * DATE-BASED, like the two charts beside it: no batch enters. The slabs are the
 * ones whose Production Date is that date — the same rows Slab Records lists
 * for that date (productionDateOf, resolved by the caller). A line that ran all
 * 24 hours divides by 24; one that ran 07:00 → 20:00 divides by 13, never by 24.
 *
 * ── HOURS THE LINE RAN ─────────────────────────────────────────────────────
 * Read from the production records themselves: every slab going IN and every
 * slab coming OUT is a moment the line was working. Between two such moments
 * the line counts as running when they are at most QUIET_LIMIT_MINUTES apart —
 * a delay, a changeover, a slab held a while in the line all count, because
 * delays are not subtracted (the owner's rule). A longer stretch with nothing
 * going in or coming out is the line STOPPED — a power cut of hours, the line
 * off overnight — and is not counted. Each stretch is split at midnight, so a
 * date gets exactly the running time that fell on that date: a full day is
 * 24 hours, never more.
 *
 * Moments, not In→Out intervals, on purpose: an Out typed a few minutes before
 * its In reads as "crossed midnight" and lands a day later, and a slab left in
 * the line through a stop spans the stop — as intervals, either would paint a
 * whole idle day as production. As moments they are one isolated instant.
 *
 * ── WHAT IT REPLACED (2026-09-25) ──────────────────────────────────────────
 * The rate used to divide by the open time of the RoboShift rows attributed to
 * the date. A shift row is plumbing the entry form creates silently when the
 * tablet is first used on a day and closes when the next day's first slab is
 * saved — its start and end are tablet times, not production times, and an
 * open one was measured to the wall clock. A date whose shift row happened to
 * span a quarter of an hour read 19/09 as 279.3 slabs/hour.
 */

import { dayNum, toMins, dateFromDayNum } from "./slabPlacement.ts";

/** A slab reduced to what the daily rate reads: its Production Date (yyyy-mm-dd,
 *  productionDateOf) and its clock In / Out. */
export interface DatedSlab {
  productionDate: string | null;
  inTime: string | null;
  outTime: string | null;
}

const DAY = 1440;

/** The longest stretch with nothing going in or coming out that still counts as
 *  the line running. In the real registers of D-1448 and D-1449 the longest such
 *  stretch inside production is 87 minutes (22 Sep: a 30-minute T1 delay while
 *  slabs sat in the line), and the shortest stop is over three hours (the power
 *  cut that day ran 5h 36m). Two hours sits between them. */
export const QUIET_LIMIT_MINUTES = 120;

/** Every moment a slab went in or came out, as absolute minutes (whole days since
 *  the epoch × 1440 + clock) on the slab's own Production Date — an Out before
 *  its In is the next day, the rule every Robo report uses. Sorted. */
function lineMoments(slabs: readonly DatedSlab[]): number[] {
  const moments: number[] = [];
  for (const s of slabs) {
    const day = dayNum(s.productionDate);
    if (day === null) continue;
    const inM = toMins(s.inTime);
    const outM = toMins(s.outTime);
    if (inM !== null) moments.push(day * DAY + inM);
    if (outM !== null) moments.push(day * DAY + outM + (inM !== null && outM < inM ? DAY : 0));
  }
  return moments.sort((a, b) => a - b);
}

/**
 * Minutes the Robo line ran on each calendar date, from the slabs given —
 * yyyy-mm-dd → minutes, at most 1440. Dates the line never ran on are absent.
 *
 * Pass every slab that could have run on the dates wanted, including the day
 * before the first (its overnight slabs come out after midnight, on the first
 * date), and read the dates wanted from the map.
 */
export function lineMinutesByDate(slabs: readonly DatedSlab[]): Map<string, number> {
  const moments = lineMoments(slabs);
  const minutes = new Map<string, number>();
  for (let k = 1; k < moments.length; k++) {
    const end = moments[k];
    let t = moments[k - 1];
    if (end - t > QUIET_LIMIT_MINUTES) continue; // nothing in or out for too long: stopped
    // A running stretch, split at each midnight it crosses.
    while (t < end) {
      const day = Math.floor(t / DAY);
      const upTo = Math.min(end, (day + 1) * DAY);
      const date = dateFromDayNum(day);
      if (date) minutes.set(date, (minutes.get(date) ?? 0) + (upTo - t));
      t = upTo;
    }
  }
  return minutes;
}

/**
 * Daily Slabs/hour: `slabs` ÷ (`lineMinutes` / 60), one decimal. 0 when there is
 * nothing to divide — no slab, or no recorded running time on that date — so a
 * date with no production reads 0, never a divide-by-zero.
 */
export function dailySlabsPerHour(slabs: number, lineMinutes: number): number {
  if (!(slabs > 0) || !(lineMinutes > 0)) return 0;
  return Math.round((slabs / (lineMinutes / 60)) * 10) / 10;
}

/**
 * The chart's Y-axis: 0, 2, 4, 6, 8, 10 — the owner's scale — extended in steps
 * of 2 only when a date's rate really is above 10 (a fast day at 11.3 is drawn
 * at 11.3, not cut off at the top).
 */
export function dailyRateYAxis(maxRate: number): { max: number; ticks: number[] } {
  const peak = Number.isFinite(maxRate) && maxRate > 0 ? Math.ceil(maxRate) : 0;
  const max = Math.max(10, peak + (peak % 2));
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += 2) ticks.push(t);
  return { max, ticks };
}
