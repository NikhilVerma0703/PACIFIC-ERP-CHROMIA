import { CHART_INK, niceScale, OUTCOME_COLORS, wrapLabel, type ChartSeries } from './chart-ink';

/**
 * Base Material Performance.
 *
 * One group of five bars per material, read straight off the By base material
 * table underneath — the same rows, the same arithmetic, no second source.
 *
 * Grouped rather than stacked on purpose: the question here is "which material
 * gets recalibrated more than the others", and that is a comparison between
 * bars, which stacking makes impossible for every segment except the bottom
 * one. Position inside the group is fixed and always in legend order, so each
 * bar has an identity even before its colour is read.
 */

export interface MaterialBar {
  name: string;
  received: number;
  dispatched: number;
  stocked: number;
  sampleCut: number;
  recalibrated: number;
}

const SERIES: (ChartSeries & { pick: (row: MaterialBar) => number })[] = [
  { key: 'received', label: 'Received', color: CHART_INK.strong, pick: (row) => row.received },
  {
    key: 'dispatched',
    label: 'Dispatched',
    color: OUTCOME_COLORS.dispatched,
    pick: (row) => row.dispatched,
  },
  { key: 'stocked', label: 'Stocked', color: OUTCOME_COLORS.stock, pick: (row) => row.stocked },
  {
    key: 'sampleCut',
    label: 'Sample cut',
    color: OUTCOME_COLORS.sampleCutting,
    pick: (row) => row.sampleCut,
  },
  {
    key: 'recalibrated',
    label: 'Recalibrated',
    color: OUTCOME_COLORS.recalibration,
    pick: (row) => row.recalibrated,
  },
];

const HEIGHT = 330;
const PAD = { top: 16, right: 20, bottom: 76, left: 48 };
/** Bars are capped rather than filling the slot; the leftover is air. */
const BAR = 16;
const BAR_GAP = 2;
const GROUP_GAP = 34;
const GROUP = SERIES.length * BAR + (SERIES.length - 1) * BAR_GAP;
/** Matches the trend chart, so the two read as one pair on the page. */
const BASE_WIDTH = 1080;

export function GroupedBars({ materials }: { materials: readonly MaterialBar[] }) {
  if (materials.length === 0) return null;

  const needed = PAD.left + PAD.right + materials.length * (GROUP + GROUP_GAP) + GROUP_GAP;
  const width = Math.max(BASE_WIDTH, needed);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const highest = Math.max(
    1,
    ...materials.flatMap((row) => SERIES.map((series) => series.pick(row))),
  );
  const scale = niceScale(highest);

  const y = (value: number) => PAD.top + plotHeight - (plotHeight * value) / scale.max;

  // Spread the groups across whatever width we ended up with, so a short list
  // fills its card rather than bunching against the y-axis.
  const lane = (width - PAD.left - PAD.right) / materials.length;
  const groupX = (index: number) => PAD.left + lane * index + (lane - GROUP) / 2;

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <div style={width > BASE_WIDTH ? { minWidth: width } : undefined}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label="Base material performance: received, dispatched, stocked, sample cut and recalibrated, by base material."
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

            {materials.map((row, index) => (
              <g key={row.name}>
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
                      // A zero still gets a hairline, so an empty column is
                      // visibly zero rather than a bar somebody forgot to draw.
                      height={height === 0 ? 1 : height}
                      rx={4}
                      fill={series.color}
                    >
                      <title>{`${row.name} — ${series.label}: ${value}`}</title>
                    </rect>
                  );
                })}

                <text
                  x={groupX(index) + GROUP / 2}
                  y={HEIGHT - PAD.bottom + 20}
                  textAnchor="middle"
                  className="fill-[var(--muted)] text-[11px]"
                >
                  {wrapLabel(row.name).map((piece, line) => (
                    <tspan key={piece} x={groupX(index) + GROUP / 2} dy={line === 0 ? 0 : 14}>
                      {piece}
                    </tspan>
                  ))}
                  <title>{row.name}</title>
                </text>
              </g>
            ))}

            <text
              x={PAD.left}
              y={HEIGHT - 8}
              textAnchor="start"
              className="fill-[var(--muted)] text-[10px] font-semibold tracking-[0.12em] uppercase"
            >
              Base Material / Slab Name
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
