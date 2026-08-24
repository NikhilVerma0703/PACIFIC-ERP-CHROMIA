import { CHART_INK, labelStride, niceScale, OUTCOME_COLORS, type ChartSeries } from './chart-ink';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';

/**
 * Production Trend.
 *
 * Six measures over the selected period, read straight off the Day by day
 * table sitting underneath — the same rows, the same arithmetic, no second
 * source. The chart is the shape of the month; the table is the numbers, and
 * anyone who needs an exact figure reads it there rather than squinting at a
 * bar.
 *
 * Grouped bars rather than lines. A line implies a continuous quantity moving
 * between its points, and these are six independent daily counts: nothing
 * happened "between" Monday and Tuesday. Bars also give each measure a fixed
 * position inside its day, so a series has an identity before its colour is
 * read — which matters for the one weak pair in the reserved palette.
 *
 * Rendered as plain SVG on the server, like the pie: no chart library, no
 * client JavaScript, nothing extra to download on a shop-floor tablet.
 */

export interface TrendDay {
  day: string;
  received: number;
  processingDone: number;
  dispatched: number;
  stocked: number;
  sampleCut: number;
  recalibration: number;
}

/** Series order is the order the operators asked for, and the legend order. */
const SERIES: (ChartSeries & { pick: (row: TrendDay) => number })[] = [
  { key: 'received', label: 'Received', color: CHART_INK.strong, pick: (row) => row.received },
  {
    key: 'processingDone',
    label: 'Processing done',
    color: CHART_INK.soft,
    pick: (row) => row.processingDone,
  },
  {
    key: 'dispatched',
    label: 'Dispatched',
    color: OUTCOME_COLORS.dispatched,
    pick: (row) => row.dispatched,
  },
  { key: 'stocked', label: 'Stock', color: OUTCOME_COLORS.stock, pick: (row) => row.stocked },
  {
    key: 'sampleCut',
    label: 'Sample cutting',
    color: OUTCOME_COLORS.sampleCutting,
    pick: (row) => row.sampleCut,
  },
  {
    key: 'recalibration',
    label: 'Recalibration',
    color: OUTCOME_COLORS.recalibration,
    pick: (row) => row.recalibration,
  },
];

const HEIGHT = 320;
const PAD = { top: 16, right: 20, bottom: 56, left: 48 };
/** Six bars to a day, so each is thin; the leftover in the lane is air. */
const BAR = 8;
const BAR_GAP = 2;
const GROUP_GAP = 14;
const GROUP = SERIES.length * BAR + (SERIES.length - 1) * BAR_GAP;
/**
 * The drawing width when the period is short.
 *
 * Roughly the width of a section card on a tablet, so a fortnight fills its
 * card instead of huddling in the left third of it. A longer period grows past
 * this and the strip scrolls sideways rather than squeezing the days together.
 */
const BASE_WIDTH = 1080;

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: PLANT_TIME_ZONE });

function shortDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? day : dayFmt.format(parsed);
}

export function TrendBars({ days }: { days: readonly TrendDay[] }) {
  if (days.length === 0) return null;

  // The table below is a diary and reads newest first. An axis of time cannot:
  // it runs left to right, always, so the drawing order is its own.
  const rows = [...days].sort((a, b) => a.day.localeCompare(b.day));

  const needed = PAD.left + PAD.right + rows.length * (GROUP + GROUP_GAP) + GROUP_GAP;
  const width = Math.max(BASE_WIDTH, needed);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const highest = Math.max(1, ...rows.flatMap((row) => SERIES.map((series) => series.pick(row))));
  const scale = niceScale(highest);

  const y = (value: number) => PAD.top + plotHeight - (plotHeight * value) / scale.max;

  // Spread the days across whatever width we ended up with, so a short period
  // fills its card rather than bunching against the y-axis.
  const lane = (width - PAD.left - PAD.right) / rows.length;
  const groupX = (index: number) => PAD.left + lane * index + (lane - GROUP) / 2;
  const stride = labelStride(rows.length, lane);

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <div style={width > BASE_WIDTH ? { minWidth: width } : undefined}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label="Production trend: received, processing done, dispatched, stock, sample cutting and recalibration, by day."
            className="block h-auto w-full"
          >
            {scale.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 10}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="fill-[var(--muted)] text-[11px] tabular-nums"
                >
                  {tick}
                </text>
              </g>
            ))}

            {rows.map((row, index) => (
              <g key={row.day}>
                {SERIES.map((series, position) => {
                  const value = series.pick(row);
                  const top = y(value);
                  const height = PAD.top + plotHeight - top;
                  const x = groupX(index) + position * (BAR + BAR_GAP);

                  return (
                    <rect
                      key={series.key}
                      x={x}
                      y={height === 0 ? top - 1 : top}
                      width={BAR}
                      // A zero still gets a hairline, so a quiet day reads as
                      // zero rather than as a bar somebody forgot to draw.
                      height={height === 0 ? 1 : height}
                      rx={3}
                      fill={series.color}
                    >
                      <title>{`${shortDay(row.day)} — ${series.label}: ${value}`}</title>
                    </rect>
                  );
                })}

                {index % stride === 0 ? (
                  <text
                    x={groupX(index) + GROUP / 2}
                    y={HEIGHT - PAD.bottom + 20}
                    textAnchor="middle"
                    className="fill-[var(--muted)] text-[11px]"
                  >
                    {shortDay(row.day)}
                  </text>
                ) : null}
              </g>
            ))}

            <text
              x={PAD.left}
              y={HEIGHT - 8}
              textAnchor="start"
              className="fill-[var(--muted)] text-[10px] font-semibold tracking-[0.12em] uppercase"
            >
              Date
            </text>

            <text
              transform={`translate(14 ${PAD.top + plotHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-[var(--muted)] text-[10px] font-semibold tracking-[0.12em] uppercase"
            >
              Number of slabs
            </text>
          </svg>
        </div>
      </div>

      <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-2.5">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="inline-block size-3 shrink-0 rounded-[3px]"
              style={{ background: series.color }}
            />
            <span className="text-muted">{series.label}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
