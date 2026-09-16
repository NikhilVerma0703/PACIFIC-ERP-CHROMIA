/**
 * Reference Sheet — the pure part.
 *
 * The Downloads "Reference Sheet" section takes ONE Design Name, finds the design's
 * latest production run and hands back a one-page summary to check before running
 * that design again. Three decisions in that flow have to be exactly right and are
 * worth testing on their own, away from Prisma so `node --test` can reach them:
 *
 *   1. WHICH designs count as the same design. Matching is by design name only,
 *      NOT thickness — "Costa 2 cm" and "Costa 3 cm" are one design (Costa), while
 *      "Bellagio Green" and "Bellagio Grey" are two. designMatchKey() strips a
 *      trailing thickness token and normalises, so both sides of the match compare
 *      the same way.
 *
 *   2. The ACTUAL delay time to take off the batch duration for Avg Slabs/hour.
 *      Two delays that overlap in time are one stretch of downtime, not two, so the
 *      same minute must not be subtracted twice — mergedDelayMinutes() unions the
 *      intervals. This is deliberately DIFFERENT from the "Total Delays" figure on
 *      the sheet, which matches Reports by SUMMING every delay's stored duration
 *      (overlaps counted twice, as Reports does); the union is only the denominator
 *      adjustment the operator asked for.
 *
 *   3. Avg Slabs/hour itself — Total Slabs ÷ (Batch Duration − actual delay time),
 *      the operator's approved Reference-Sheet formula (delays SUBTRACTED here,
 *      unlike the Reports KPI which leaves them in). avgSlabsPerHourNet() owns the
 *      divide-by-zero and negative-denominator guards.
 *
 * The route (referenceData.ts) owns the Prisma reads and pairs each delay's clock
 * start with its production date into an absolute minute (stampMinutes) before
 * handing the spans here; this module never touches a database or a wall clock.
 */

/**
 * The design's identity for matching: its name with a trailing thickness removed,
 * lower-cased and whitespace-collapsed. So "Costa 2 cm", "Costa 3cm" and "costa"
 * all key as "costa", while "Bellagio Green" and "Bellagio Grey" stay apart
 * (neither ends in a thickness, so nothing is stripped).
 *
 * Only a thickness token is removed, and only at the END: a number followed by
 * cm or mm (with optional space and an optional trailing dot). A name that merely
 * ends in a number ("Statuario 5") keeps it — that is not a thickness and dropping
 * it would merge two real designs. Matching is case- and space-insensitive because
 * a design typed by hand is not a database key.
 */
export function designMatchKey(name: string | null | undefined): string {
  return (name ?? "")
    // drop a trailing thickness like "2 cm", "3cm", "20 mm", "18mm."
    .replace(/\s*\d+(?:\.\d+)?\s*(?:cm|mm)\.?\s*$/i, "")
    // tidy any separator the strip left dangling ("Costa -" → "Costa")
    .replace(/[\s\-_]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is this a Robot delay code? Robot delays are the "G — Robot Delays" master
 * section, whose codes all run C1…C20. We identify them by the CODE (starts with
 * C followed by a digit), not by the stored `category`: on old/imported rows the
 * category was left blank or inconsistent, which is why the Reference Sheet's
 * Robot Delays row was coming out empty even when C-code delays had occurred.
 * The code is the reliable signal — every non-robot section uses a different
 * letter (RM/L/D/S/P/M/G/T), so a leading "C<digit>" is unambiguous.
 */
export function isRobotDelayCode(code: string | null | undefined): boolean {
  return /^\s*C\d/i.test(code ?? "");
}

/** One delay reduced to what the union needs: its start as an absolute minute
 *  (date already folded in by the caller, null when the delay has no start time)
 *  and its stored duration in minutes. */
export interface DelaySpanInput {
  startAbs: number | null;
  minutes: number;
}

/**
 * The ACTUAL total downtime across a set of delays, counting overlapping delays
 * once. Delays that carry a start time are placed on the timeline as
 * [start, start+duration] and their union is measured; a delay with no start time
 * cannot be placed, so its duration is simply added (nothing to overlap it with —
 * not counting it would understate the downtime).
 *
 * The end is start+duration rather than the stored end time on purpose: the stored
 * durationMinutes was computed cross-midnight-aware when the delay was saved, so
 * adding it steps past midnight correctly without a second date lookup. Absolute
 * minutes are only ever compared to each other here, so the caller's date anchor
 * cancels and no timezone enters. A zero/negative/NaN duration contributes nothing.
 */
export function mergedDelayMinutes(spans: readonly DelaySpanInput[]): number {
  const intervals: [number, number][] = [];
  let loose = 0;
  for (const s of spans) {
    const mins = Number.isFinite(s.minutes) && s.minutes > 0 ? s.minutes : 0;
    if (mins <= 0) continue;
    if (s.startAbs === null || !Number.isFinite(s.startAbs)) {
      loose += mins;
      continue;
    }
    intervals.push([s.startAbs, s.startAbs + mins]);
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let merged = 0;
  let curStart: number | null = null;
  let curEnd: number | null = null;
  for (const [st, en] of intervals) {
    if (curEnd === null) {
      curStart = st;
      curEnd = en;
    } else if (st <= curEnd) {
      // Overlapping or touching — extend the current stretch, do not re-count.
      if (en > curEnd) curEnd = en;
    } else {
      // A gap: close the current stretch and open a new one.
      merged += curEnd - (curStart as number);
      curStart = st;
      curEnd = en;
    }
  }
  if (curEnd !== null) merged += curEnd - (curStart as number);

  return merged + loose;
}

/**
 * Avg Slabs/hour for the Reference Sheet — the operator's approved formula:
 * Total Slabs ÷ (Batch Duration − actual delay time), in slabs per hour, rounded
 * to one decimal.
 *
 * DELAYS ARE SUBTRACTED here, which is the deliberate difference from the Reports
 * KPI (productionSpan.avgSlabsPerHour), where they are left in. `spanMinutes` is
 * the batch duration (first In → last Out); `delayMinutes` is the union from
 * mergedDelayMinutes so the same downtime is not removed twice.
 *
 * Returns null — the sheet shows "-" — when there is no duration to divide by
 * (nothing completed), or when delays meet or exceed the duration so the net
 * running time is zero or negative, rather than dividing by zero or inventing a
 * rate. A negative delay figure is floored at zero so it can never inflate the net.
 */
export function avgSlabsPerHourNet(
  totalSlabs: number,
  spanMinutes: number | null,
  delayMinutes: number,
): number | null {
  if (spanMinutes === null || !Number.isFinite(spanMinutes)) return null;
  const net = spanMinutes - Math.max(0, delayMinutes);
  if (net <= 0) return null;
  return Math.round((totalSlabs / (net / 60)) * 10) / 10;
}
