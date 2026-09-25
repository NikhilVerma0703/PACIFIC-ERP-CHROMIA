"use client";
/**
 * The Reference Sheet's Robot Delay pie — how a batch's robot delay time splits
 * between its delay types: 1 type → 1 slice, 2 → 2, 3 → 3, more → the three
 * longest (robotDelayPie in lib/robo/referenceSheet.ts decides which). The table
 * above it still lists every robot delay; this is only the at-a-glance share.
 *
 * Its own module so the Downloads page pulls Recharts in only when a result
 * actually has robot delays — next/dynamic, the same pattern the Reports charts
 * use to keep the charting library out of the first load.
 *
 * Reading aids, because colour must never be the only way to tell slices apart:
 * each slice carries a direct label (its share), a legend beside the pie spells
 * out the code, its description, duration and that same share, the Robot Delays
 * table above is the full table view, and a 2px white gap separates the slices. The
 * colours are the Reports charts' own categorical slots (SERIES), checked for
 * colour-blind separation; the third one is low-contrast on white, which the
 * labels and the table cover. Text stays in the ink colours, never slice colour.
 */
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { fmtDurationLong } from "@/lib/robo/utils";
import { SERIES, AXIS, TOOLTIP_STYLE } from "@/components/robo/reports/chart-tokens";
import type { RobotDelayPie as PieData, PieSlice } from "@/lib/robo/referenceSheet";

const RAD = Math.PI / 180;
/** Ink for chart text — the same gray-600 the page's secondary text uses. */
const INK = "#4b5563";
/** Below this share a slice gets no direct label (the legend still names it),
 *  so a sliver's label cannot sit on top of its neighbour's. */
const MIN_LABEL_PCT = 4;

interface SliceLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  index: number;
}

export function RobotDelayPie({ pie }: { pie: PieData }) {
  const { slices, totalTypes, coveragePct } = pie;
  if (slices.length === 0) return null;
  const cut = totalTypes > slices.length;
  // One slice is a whole circle: no gap to draw (its start and end edges meet,
  // so a stroke would show as a seam from the centre) and no label to add —
  // the legend beside it already says "… 100%".
  const single = slices.length === 1;

  // The direct label is the share alone. "C5 · 54.5%" does not fit beside a
  // pie that also has to fit a phone screen and was clipped at the edges; the
  // legend next to it names each code against the SAME percentage, so a slice
  // is identified by its number, not by colour alone.
  const label = ({ cx, cy, midAngle, outerRadius, index }: SliceLabelProps) => {
    const s = slices[index];
    if (single || !s || s.pct < MIN_LABEL_PCT) return null;
    const r = outerRadius + 14;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text x={x} y={y} fill={INK} fontSize={12} fontWeight={600}
        textAnchor={x >= cx ? "start" : "end"} dominantBaseline="central">
        {`${s.pct}%`}
      </text>
    );
  };

  const summary = slices.map((s) => `${s.code} ${s.pct}%`).join(", ");

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div
        role="img"
        aria-label={`Robot delay share: ${summary}${cut ? `; top ${slices.length} of ${totalTypes} types` : ""}`}
        className="shrink-0"
      >
        <PieChart width={280} height={210}>
          <Pie
            data={slices}
            dataKey="minutes"
            nameKey="code"
            cx="50%"
            cy="50%"
            outerRadius={72}
            startAngle={90}
            endAngle={-270}
            stroke="#ffffff"
            strokeWidth={single ? 0 : 2}
            isAnimationActive={false}
            label={label}
            labelLine={single ? false : { stroke: AXIS, strokeWidth: 1 }}
          >
            {slices.map((s, i) => (
              <Cell key={s.code} fill={SERIES[i % SERIES.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(_v: unknown, _n: unknown, item: { payload?: PieSlice }) => {
              const s = item?.payload;
              return s ? [`${fmtDurationLong(s.minutes)} · ${s.pct}%`, `${s.code} — ${s.description}`] : ["", ""];
            }}
          />
        </PieChart>
      </div>

      <div className="w-full min-w-0 space-y-2">
        <ul className="space-y-1.5">
          {slices.map((s, i) => (
            <li key={s.code} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: SERIES[i % SERIES.length] }}
              />
              <span className="min-w-0 flex-1 text-gray-700">
                <span className="font-semibold text-gray-800">{s.code}</span> — {s.description}
              </span>
              <span className="shrink-0 text-right tabular-nums text-gray-600">
                {fmtDurationLong(s.minutes)} · <span className="font-semibold text-gray-800">{s.pct}%</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">
          {cut
            ? `Top ${slices.length} of ${totalTypes} robot delay types by duration — together ${coveragePct}% of all robot delay time in this batch. Percentages are shares of these ${slices.length}.`
            : "Share of this batch's robot delay time."}
        </p>
      </div>
    </div>
  );
}
