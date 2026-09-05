/**
 * The Y-axis for the "Production Rate per Hour" chart — slabs completed per hour.
 *
 * Pure and alias-free so `node --test` can reach it, and kept out of the client
 * chart component so the scale can be pinned by tests.
 *
 * A fixed, readable 0, 2, 4, 6, 8, 10, 12 by default — the scale the shop floor
 * expects — extended in steps of 2 (14, 16, 18, …) ONLY when some hour actually
 * produced more than 12 slabs. A quiet run never draws a needlessly tall axis,
 * and a busy one is never clipped.
 */
export function hourlyYAxis(maxSlabs: number): { max: number; ticks: number[] } {
  const peak = Number.isFinite(maxSlabs) && maxSlabs > 0 ? Math.ceil(maxSlabs) : 0;
  // Round the busiest hour up to an even number, but never below the default 12.
  const max = Math.max(12, peak + (peak % 2));
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += 2) ticks.push(t);
  return { max, ticks };
}
