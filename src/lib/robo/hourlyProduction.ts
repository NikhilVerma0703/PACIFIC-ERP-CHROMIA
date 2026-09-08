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
 * In/Out are bare HH:MM with no day of their own. The day is taken from the
 * production SEQUENCE, not from trusting each slab's stored date:
 *
 *   • The FIRST slab in register order — the batch's start — anchors the start
 *     day.
 *
 *   • The day then advances ONLY when the times wrap past midnight: walking the
 *     slabs in register order (serialNumber, then createdAt), a slab whose IN
 *     time falls far BEFORE the run's latest IN so far (more than 12h) has
 *     crossed into the next day. Continuity is measured IN-to-IN, not off the
 *     previous slab's Out — a slab held open for hours has a late Out that would
 *     otherwise make the next normal slab look like a backward midnight jump and
 *     fabricate an empty extra day. This fires for a real crossing whether or not
 *     the post-midnight slabs were re-dated, so a cross-midnight batch never
 *     loses its second half.
 *
 * A later slab's own stored date is deliberately NOT allowed to advance the day.
 * A date that jumps forward mid-run while the time barely moved — a late slab
 * wrongly carrying tomorrow's date — is a data-entry slip, and trusting it is
 * exactly what threw a batch's last slabs ~24h ahead and drew an empty extra day
 * (batch 1432: six 22:xx slabs, two of them shifted a day forward). Anchoring on
 * the start and advancing only on a real time wrap keeps every slab in the hour
 * it was actually produced, exactly once.
 *
 * Only a large backward jump counts as a crossing, so slabs logged a little out
 * of order never trip it. No wall clock is ever read — the timeline is built
 * entirely from the stored In/Out and the sequence — so the same records always
 * produce the same chart, and a historical hour never changes because time
 * passed.
 */

export interface HourlySlab {
  /** yyyy-mm-dd — the slab's effective production date (productionDateOf). */
  productionDate: string | null;
  inTime: string | null; // HH:MM
  outTime: string | null; // HH:MM
  /** Register order — the production sequence, used to reconstruct a continuous
   *  timeline across midnight. Optional: with neither hint present the caller's
   *  array order is taken as the sequence (a stable sort preserves it). */
  serialNumber?: number | null;
  createdAt?: string | number | Date | null;
}

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

/** The yyyy-mm-dd for a whole-days-since-epoch number — the inverse of dayNum,
 *  in UTC, so the date a bucket is labelled with never drifts with a timezone. */
function dateFromDayNum(dn: number): string | null {
  if (!Number.isFinite(dn)) return null;
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

/** A comparable number for a createdAt (Date, epoch ms, or ISO string); 0 when
 *  absent or unparseable, so it never reorders ahead of a real timestamp. */
function createdAtValue(v: string | number | Date | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:00–HH:00" for an absolute hour index, wrapping the labels at midnight. */
function hourLabel(absHour: number): string {
  const a = ((absHour % 24) + 24) % 24;
  const b = (a + 1) % 24;
  return `${pad(a)}:00–${pad(b)}:00`;
}

/** A time jumping back more than this against the run so far is a midnight
 *  crossing, not a slab logged slightly out of order. */
const WRAP_GUARD_MIN = 12 * 60;

/** A run this long is a data error (a stray date), not a real batch — cap the
 *  timeline so one bad row can't ask for thousands of empty hours. */
const MAX_HOURS = 48;

export function hourlyProduction(slabs: readonly HourlySlab[]): HourBucket[] {
  // Register order = production order. Stable, so with no serial/createdAt hints
  // the caller's own order stands as the sequence.
  const ordered = slabs
    .map((slab, i) => ({ slab, i }))
    .sort((a, b) => {
      const sa = a.slab.serialNumber, sb = b.slab.serialNumber;
      if (sa != null && sb != null && sa !== sb) return sa - sb;
      if (sa != null && sb == null) return -1;
      if (sa == null && sb != null) return 1;
      const ca = createdAtValue(a.slab.createdAt), cb = createdAtValue(b.slab.createdAt);
      if (ca !== cb) return ca - cb;
      return a.i - b.i;
    });

  let dayBase: number | null = null; // absolute minute of the current day's midnight
  let prevRef = -Infinity;           // the previous slab's last placed minute
  let winStart = Infinity;           // absolute minute the batch first started
  let winEnd = -Infinity;            // absolute minute of its last completion
  const completions: number[] = [];  // absolute minute of each Out Time

  for (const { slab } of ordered) {
    const inM = toMins(slab.inTime);
    const outM = toMins(slab.outTime);
    const startM = inM ?? outM;
    if (startM === null) continue; // no time at all → cannot place it

    // The date anchors the START day, once, from the first dated slab (register
    // order → the batch's first slab). It never advances the day again: a later
    // slab's date that jumps forward is the mis-dating that shifted a batch's
    // last slabs ~24h ahead (batch 1432). The day advances only on a real time
    // wrap, below — so a genuine crossing is still caught, from the times.
    const day = dayNum(slab.productionDate);
    if (day !== null && dayBase === null) dayBase = day * 1440;
    if (dayBase === null) continue; // no date yet → nothing to place it on

    let inAbs = inM !== null ? dayBase + inM : null;
    let outAbs = outM !== null ? dayBase + outM : null;
    // A slab whose own Out precedes its In crossed midnight by itself.
    if (inAbs !== null && outAbs !== null && (outM as number) < (inM as number)) outAbs += 1440;

    // Signal 2 — the sequence. If this slab starts far before the previous slab
    // ended, the run crossed midnight without the date catching it: push it (and
    // the day cursor) forward a day at a time until it sits after the run so far.
    let refAbs = inAbs ?? (outAbs as number);
    let guard = 0;
    while (prevRef !== -Infinity && refAbs + WRAP_GUARD_MIN < prevRef && guard < MAX_HOURS) {
      dayBase += 1440;
      if (inAbs !== null) inAbs += 1440;
      if (outAbs !== null) outAbs += 1440;
      refAbs += 1440;
      guard++;
    }

    const startAbs = inAbs ?? (outAbs as number);
    winStart = Math.min(winStart, startAbs);
    if (outAbs !== null) {
      winEnd = Math.max(winEnd, outAbs);
      completions.push(outAbs);
    }
    // Continuity is carried on the IN time, never the Out. A slab held open for
    // many hours (a long delay, or a hold across a shift) finishes with a late
    // Out; keying the next slab's wrap check off that late Out made a perfectly
    // normal following slab look more than 12h "earlier" than the run so far — a
    // FALSE midnight crossing that fabricated an empty extra day (a single-day
    // batch spilling into the next date; a genuine two-day batch — e.g. 1386,
    // 20 Jul 12:12 → 21 Jul 17:12 — drawing a phantom third day). The In times
    // move forward across a real run, so the only >12h backstep they carry is a
    // TRUE crossing (…23:55 → 00:04…), which still wraps exactly as before.
    prevRef = inAbs ?? startAbs;
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
