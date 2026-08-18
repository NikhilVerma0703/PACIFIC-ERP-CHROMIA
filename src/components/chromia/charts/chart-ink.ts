/**
 * Chart series identity — the colour each measure wears.
 *
 * Four of the six series on the Production Trend are outcomes, and they wear
 * the module's reserved outcome colours: a line and a badge can never disagree
 * about what green means. The other two — Received and Processing Done — are
 * not outcomes at all. They are the envelope and the throughput, so they are
 * drawn in neutral ink rather than competing for a sixth hue.
 *
 * That is a deliberate choice, not a shortage of colours. Two neutrals
 * separated by lightness stay separated for every kind of colour blindness,
 * because deficient vision alters hue and leaves lightness alone. Adding two
 * more saturated hues to the four reserved ones was measured and fails: no pair
 * in a forty-colour search clears the separation floor against all four.
 *
 * The reserved palette itself has one weak pair — Stock blue against
 * Recalibration violet, which deuteranopes see as close. It is used by every
 * badge and the pie, so it is not ours to re-pick here. Both charts are grouped
 * bars instead, where each series holds a fixed position inside its group: a
 * bar is identified by where it sits before its colour is read. The exact
 * numbers sit in the table directly beneath each chart.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** A hex from the reserved outcome palette, or a neutral ink token. */
  color: string;
}

/** Neutral ink, as CSS custom properties so dark mode adapts with the app. */
export const CHART_INK = {
  strong: 'var(--chart-ink-strong)',
  soft: 'var(--chart-ink-soft)',
} as const;

/** Reserved outcome colours — the same values the badges and the pie use. */
export const OUTCOME_COLORS = {
  dispatched: '#16a34a',
  stock: '#327dff',
  sampleCutting: '#d97706',
  recalibration: '#9333ea',
} as const;

/**
 * Axis ticks a person would choose: 0, 5, 10 — never 0, 3.33, 6.67.
 * Returns the rounded ceiling and the tick values, always including zero.
 */
export function niceScale(max: number, targetTicks = 4): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 1, ticks: [0, 1] };

  const rough = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;

  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }

  return { max: top, ticks };
}

/**
 * A category label, wrapped onto at most two lines.
 *
 * "Bianco crisstallo 2cm" and "Bianco crisstallo 3cm" truncated to one line are
 * the same string — two different materials that read as one. Wrapping keeps
 * the part that tells them apart, and only the overflow past two lines is cut.
 */
export function wrapLabel(name: string, maxChars = 15, maxLines = 2): string[] {
  const words = name.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || line === '') {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }

  if (lines.length < maxLines && line) lines.push(line);

  return lines.map((text, index) =>
    text.length > maxChars && (index === maxLines - 1 || lines.length === 1)
      ? `${text.slice(0, maxChars - 1)}…`
      : text,
  );
}

/**
 * How many x labels to skip so they never collide.
 *
 * A month of days at tablet width cannot carry thirty-one legible dates, and a
 * clipped or overlapping axis is worse than a sparse one.
 */
export function labelStride(count: number, slotWidth: number, labelWidth = 62): number {
  if (count <= 1) return 1;
  return Math.max(1, Math.ceil(labelWidth / Math.max(slotWidth, 1)));
}
