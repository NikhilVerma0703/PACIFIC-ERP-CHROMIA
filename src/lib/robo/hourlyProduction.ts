/**
 * "Production Rate per Hour" — slabs completed each hour across ONE batch's own
 * run, for the Reports line chart.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * ── THE TIMELINE ───────────────────────────────────────────────────────────
 * Dynamic, never a fixed 00:00–24:00. It runs from the hour the batch STARTED
 * (its first slab's In Time, or Out Time if it has none) to the hour it
 * COMPLETED (its last Out Time), one bucket per hour, every hour in between
 * shown even when nothing completed in it — nothing before the start or after
 * the end. A slab is counted in the hour its Out Time falls in. Each bucket
 * carries the calendar DATE its hour belongs to, so a run that crosses midnight
 * is marked with both dates on the axis and there is no gap at the boundary:
 * 23:00–00:00 is immediately followed by 00:00–01:00 of the next date.
 *
 * ── WHICH DAY EACH HOUR IS ON ──────────────────────────────────────────────
 * In/Out are bare HH:MM with no day of their own. Where each slab sits on the
 * absolute timeline is decided by slabPlacement.ts — the SAME rule the Total
 * Production Time KPI uses, so the KPI and this chart can never disagree about
 * one batch. In short: the first slab anchors the day; a later slab's forward
 * date is trusted only when its clock went backwards against the run (an
 * overnight pause), never when the time barely moved (batch 1432's mis-dated
 * last slabs); and a clock more than 12h behind the run has wrapped past
 * midnight whether or not the slab was re-dated.
 *
 *   • The day advances only when the clock WRAPS past midnight, and continuity
 *     is measured IN-to-IN, never off the previous slab's Out. A slab held
 *     open for hours has a late Out; keying the next slab's wrap check off it
 *     made a perfectly normal following slab look more than 12h earlier than
 *     the run so far — a false crossing that fabricated an empty extra day (a
 *     single-day batch spilling into the next date; batch 1386, 20 Jul 12:12 →
 *     21 Jul 17:12, drawing a phantom third day). A slab whose own Out precedes
 *     its In still crosses midnight, so an overnight 00:09 Out is the next day.
 *
 * No wall clock is ever read — the timeline is built entirely from the stored
 * In/Out and the sequence — so the same records always produce the same chart,
 * and a historical hour never changes because time passed.
 */

import { type PlaceableSlab, dateFromDayNum, placeSlabs, registerOrder, MAX_RUN_HOURS } from "./slabPlacement.ts";

export type HourlySlab = PlaceableSlab;

export interface HourBucket {
  /** "11:00–12:00", "23:00–00:00" — the interval, 24-hour. */
  label: string;
  /** Hour of day 0-23, for anyone who needs the number rather than the label. */
  hour: number;
  /** Slabs whose Out Time fell in this hour. */
  slabs: number;
  /** The calendar date (yyyy-mm-dd) this hour belongs to — the X-axis date
   *  marker. null only when no slab carried a resolvable production date. */
  date: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:00–HH:00" for an absolute hour index, wrapping the labels at midnight. */
function hourLabel(absHour: number): string {
  const a = ((absHour % 24) + 24) % 24;
  const b = (a + 1) % 24;
  return `${pad(a)}:00–${pad(b)}:00`;
}

/** A run this long is a data error (a stray date), not a real batch — cap the
 *  timeline so one bad row can't ask for thousands of empty hours. */
const MAX_HOURS = MAX_RUN_HOURS;

export function hourlyProduction(slabs: readonly HourlySlab[]): HourBucket[] {
  let winStart = Infinity;           // absolute minute the batch first started
  let winEnd = -Infinity;            // absolute minute of its last completion
  const completions: number[] = [];  // absolute minute of each Out Time

  for (const { inAbs, outAbs } of placeSlabs(registerOrder(slabs))) {
    const startAbs = inAbs ?? (outAbs as number);
    winStart = Math.min(winStart, startAbs);
    if (outAbs !== null) {
      winEnd = Math.max(winEnd, outAbs);
      completions.push(outAbs);
    }
  }

  if (!Number.isFinite(winStart) && !Number.isFinite(winEnd)) return [];
  if (!Number.isFinite(winStart)) winStart = winEnd; // nothing started, only completions
  if (!Number.isFinite(winEnd)) winEnd = winStart;   // started but nothing completed yet

  let startHour = Math.floor(winStart / 60);
  const endHour = Math.floor(winEnd / 60);
  if (endHour - startHour > MAX_HOURS - 1) startHour = endHour - (MAX_HOURS - 1);

  const counts = new Map<number, number>();
  for (const c of completions) {
    const h = Math.floor(c / 60);
    if (h >= startHour && h <= endHour) counts.set(h, (counts.get(h) ?? 0) + 1);
  }

  const out: HourBucket[] = [];
  for (let h = startHour; h <= endHour; h++) {
    out.push({
      label: hourLabel(h),
      hour: ((h % 24) + 24) % 24,
      slabs: counts.get(h) ?? 0,
      // The day-number of an absolute hour is floor(h / 24); its calendar date is
      // the axis marker for this hour.
      date: dateFromDayNum(Math.floor(h / 24)),
    });
  }
  return out;
}
