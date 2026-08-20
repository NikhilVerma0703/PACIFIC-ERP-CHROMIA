/**
 * Date-wise totals for the Delay List download — the pure half of
 * /api/robo/exports/delays.
 *
 * In lib rather than in the route so `node --test` can reach it, the same
 * split the rest of this module uses.
 *
 * WHY. The sheet only ever gave one pair of numbers: total delay duration and
 * total delay events, for whatever was downloaded. That is the right answer
 * for a single day and useless for "All", which is the download anyone
 * reviewing a month actually takes — one number for thirty days says nothing
 * about which day went wrong.
 *
 * The overall totals are kept exactly as they were. These are in addition.
 */

/** One delay, as far as totalling is concerned. */
export interface DelayForTotals {
  /** Production date, already resolved — see productionDate.ts. */
  date: string;
  durationMinutes: number;
}

export interface DayTotal {
  date: string;
  events: number;
  minutes: number;
}

/**
 * Totals per production date, oldest first.
 *
 * Sorted as text, which is the same as chronologically for yyyy-mm-dd and is
 * why the whole module stores dates that way. Rows with no date land under ""
 * and sort to the top rather than being dropped: a delay whose date could not
 * be worked out is worth seeing, and silently leaving it out of the breakdown
 * while it still counts in the overall total is how two totals stop agreeing.
 *
 * Minutes are summed as they are stored. A non-finite duration contributes
 * nothing rather than turning a whole day's total into NaN.
 */
export function delayTotalsByDate(delays: readonly DelayForTotals[]): DayTotal[] {
  const byDate = new Map<string, DayTotal>();
  for (const d of delays) {
    const key = (d.date ?? "").trim();
    const row = byDate.get(key) ?? { date: key, events: 0, minutes: 0 };
    row.events += 1;
    row.minutes += Number.isFinite(d.durationMinutes) ? d.durationMinutes : 0;
    byDate.set(key, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The overall totals, computed from the SAME rows the breakdown is, so the two
 * can never disagree — the one property a reader will actually check.
 */
export function delayGrandTotal(days: readonly DayTotal[]): { events: number; minutes: number } {
  return days.reduce(
    (acc, d) => ({ events: acc.events + d.events, minutes: acc.minutes + d.minutes }),
    { events: 0, minutes: 0 },
  );
}
