/**
 * A "nice" axis for the Delay Analysis bar chart: a round maximum at or above
 * the data, with evenly spaced ticks and a little headroom so the longest bar's
 * end label ("2003 min (62.3%)") clears its bar.
 *
 * Pure and alias-free so `node --test` can reach it, kept out of the client
 * component for the same reason.
 *
 * e.g. a max of 2003 → axisMax 2500, ticks 0,500,…,2500 — five clean intervals,
 * the way the reference layout reads.
 */
export function niceDelayScale(max: number, target = 5): { axisMax: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { axisMax: 1, ticks: [0, 1] };

  const rawStep = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  // Snap the step to a 1/2/2.5/5/10 × 10^k grid — the steps that read cleanly.
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

  let axisMax = Math.ceil(max / step) * step;
  // Headroom: when the data reaches the top tick the end label has nowhere to
  // go, so lift the axis one more step.
  if (max > 0.92 * axisMax) axisMax += step;

  const ticks: number[] = [];
  for (let t = 0; t <= axisMax + 1e-9; t += step) ticks.push(Math.round(t));
  return { axisMax, ticks };
}
