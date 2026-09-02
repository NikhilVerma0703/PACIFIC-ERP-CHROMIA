/**
 * "Production Rate per Hour" — slabs completed each hour across a batch's own
 * run, for the Reports line chart.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * ── WHAT IT COUNTS ─────────────────────────────────────────────────────────
 * A slab is counted in the hour its Out Time falls in — the hour it left the
 * line. The timeline runs from the hour the batch STARTED (its first slab's In
 * Time, or Out Time if it has no In Time) to the hour it COMPLETED (its last
 * Out Time), one bucket per hour, and every hour in between shows even when no
 * slab finished in it. Nothing before the start or after the end is shown.
 *
 * ── CROSSING MIDNIGHT ──────────────────────────────────────────────────────
 * Times are HH:MM with no date, so a bare "00:30" cannot say which day it is on.
 * The slab's production date does (that is the whole point of the per-slab date
 * — a batch past midnight has its later slabs on the next day). So each slab is
 * placed on an absolute timeline of `productionDate × 24h + time`, and a run
 * that starts at 22:00 and ends at 03:00 the next morning reads
 * 22:00–23:00 → 23:00–00:00 → 00:00–01:00 → … in order, its labels wrapping
 * past midnight. One further guard, independent of the date: a single slab whose
 * Out Time is before its In Time crossed midnight on its own, so its completion
 * is the next day.
 */

export interface HourlySlab {
  /** yyyy-mm-dd — the slab's effective production date (productionDateOf). */
  productionDate: string | null;
  inTime: string | null;  // HH:MM
  outTime: string | null; // HH:MM
}

export interface HourBucket {
  /** "11:00–12:00", "23:00–00:00" — the interval, 24-hour. */
  label: string;
  /** Hour of day 0-23, for anyone who needs the number rather than the label. */
  hour: number;
  /** Slabs whose Out Time fell in this hour. */
  slabs: number;
}

/** Minutes since midnight for an HH:MM string, or null if unusable. */
function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Whole days since the epoch for a yyyy-mm-dd string, or null. UTC, so no
 *  timezone shifts the day. */
function dayNum(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((d ?? "").trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
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
const MAX_HOURS = 48;

export function hourlyProduction(slabs: readonly HourlySlab[]): HourBucket[] {
  let winStart = Infinity; // absolute minute the batch first started
  let winEnd = -Infinity;  // absolute minute of its last completion
  const completions: number[] = []; // absolute minute of each Out Time

  for (const s of slabs) {
    const day = dayNum(s.productionDate);
    if (day === null) continue; // no day → cannot place it on the timeline
    const base = day * 1440;
    const inM = toMins(s.inTime);
    const outM = toMins(s.outTime);

    // The batch's start is the earliest slab activity — In Time, else Out Time.
    const startBase = inM ?? outM;
    if (startBase !== null) winStart = Math.min(winStart, base + startBase);

    if (outM !== null) {
      let endAbs = base + outM;
      if (inM !== null && outM < inM) endAbs += 1440; // slab crossed midnight itself
      winEnd = Math.max(winEnd, endAbs);
      completions.push(endAbs);
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
    out.push({ label: hourLabel(h), hour: ((h % 24) + 24) % 24, slabs: counts.get(h) ?? 0 });
  }
  return out;
}
