/**
 * Delay Analysis — All Delay Types: the aggregation behind the Reports bar chart.
 *
 * Pure and alias-free so `node --test` can reach it. Extracted from the summary
 * route so "the chart aggregation exactly matches the underlying Delay Log data"
 * is a tested guarantee, not an inline loop taken on trust.
 *
 * ── WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────
 * Every delay row is grouped by its delay CODE. Each group carries the sum of
 * that code's `durationMinutes` and a count of its rows (events), and the groups
 * come out longest-duration first. That is all — no clock, no dates, no wall
 * time — so the same set of rows always produces the same chart. Filtering
 * (which rows reach here) and dating are the route's job, by production date;
 * this only totals what it is given.
 *
 * `durationMinutes` is authoritative: it was computed from the delay's own In/Out
 * times when the delay was saved (calcDuration, cross-midnight aware) and stored,
 * so summing it is summing the real delay durations. It is NOT recomputed here
 * from the bare HH:MM start/end, which carry no date and could not tell a
 * midnight-crossing delay from a negative one.
 *
 * ONE delay row is ONE event, whatever it names. A delay held up by several Robos
 * is a single row (its machineName is the Robos comma-joined — see
 * delayMachines.ts), so it counts once here, not once per Robo. Nothing in this
 * function looks at the machine at all, which is exactly why multi-Robo delays
 * cannot inflate the event count.
 */

export interface DelayForTypes {
  durationMinutes: number;
  delayCode: { code: string; description: string; category: string };
}

export interface DelayTypeTotal {
  code: string;
  description: string;
  category: string;
  minutes: number;
  events: number;
}

/**
 * Group delay rows by code, sum minutes and count events, longest first.
 *
 * Ties (equal minutes) keep the order the codes were first seen, so the output is
 * a deterministic function of the input order the route already fixes with its
 * query — the same rows always give the same chart. A row's durationMinutes is
 * summed as-is; a missing/NaN duration contributes 0 to its own code rather than
 * poisoning the total.
 */
export function delayTypesByCode(delays: readonly DelayForTypes[]): DelayTypeTotal[] {
  const byCode = new Map<string, DelayTypeTotal>();
  for (const d of delays) {
    const code = d.delayCode.code;
    let row = byCode.get(code);
    if (!row) {
      row = { code, description: d.delayCode.description, category: d.delayCode.category, minutes: 0, events: 0 };
      byCode.set(code, row);
    }
    row.minutes += Number.isFinite(d.durationMinutes) ? d.durationMinutes : 0;
    row.events += 1;
  }
  // Stable sort by minutes desc: JS Array.prototype.sort is stable, so equal
  // minutes stay in first-seen (insertion) order — no reshuffling between runs.
  return [...byCode.values()].sort((a, b) => b.minutes - a.minutes);
}

/** The grand total of every delay row's minutes — the % base the chart shares,
 *  taken from the SAME rows as the breakdown so the parts sum to the whole. */
export function delayGrandTotalMins(delays: readonly DelayForTypes[]): number {
  return delays.reduce((s, d) => s + (Number.isFinite(d.durationMinutes) ? d.durationMinutes : 0), 0);
}
