"use client";
/**
 * Delay Analysis — every delay type, by total duration.
 *
 * A horizontal bar chart (one bar per delay code, longest first) above a
 * summary table, both driven by the SAME `data`/`total` so a code's colour,
 * minutes and share read identically in the bar, its end label, and its table
 * row. Plain CSS, not Recharts: it is the main content of the page now, so it
 * paints immediately, and a horizontal bar with an end label and a long
 * "Code — Description" axis label is cleaner drawn directly than bent out of a
 * chart library.
 *
 * `total` is the WHOLE period's delay minutes (every code summed), so the
 * percentages are a share of all downtime and add to 100% — the table's total
 * row states it. The reference mock's own numbers don't add up; the maths here
 * does.
 */
import { niceDelayScale } from "@/lib/robo/delayAxis";
import { DELAY_SERIES, pct as pctOf } from "./chart-tokens";
import type { DelaySlice } from "./chart-tokens";

export function DelayAnalysis({ data, total }: { data: DelaySlice[]; total: number }) {
  const max = data.reduce((m, d) => Math.max(m, d.minutes), 0);
  const { axisMax, ticks } = niceDelayScale(max);
  const color = (i: number) => DELAY_SERIES[i % DELAY_SERIES.length];

  return (
    <div className="space-y-6">
      {/* ── Horizontal bar chart ── */}
      <div className="overflow-x-auto">
        <div className="flex min-w-[560px]">
          {/* Y-axis: Delay Code + Description */}
          <div className="w-44 shrink-0 pr-3 sm:w-64">
            {data.map((d) => (
              <div key={d.code} className="flex h-9 items-center justify-end">
                <span className="truncate text-right text-xs text-gray-600" title={`${d.code} — ${d.description}`}>
                  <span className="font-semibold text-gray-900">{d.code}</span> — {d.description}
                </span>
              </div>
            ))}
            <div className="h-6" /> {/* aligns the label column with the axis row */}
          </div>

          {/* Plot: gridlines behind, bars, x-axis below */}
          <div className="relative min-w-0 flex-1">
            {/* vertical gridlines, spanning the bars but not the axis labels */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 border-l border-gray-100" style={{ left: `${(t / axisMax) * 100}%` }} />
              ))}
            </div>

            {/* one bar per delay type, with its exact minutes and % at the end */}
            {data.map((d, i) => {
              const w = axisMax > 0 ? (d.minutes / axisMax) * 100 : 0;
              return (
                <div key={d.code} className="relative flex h-9 items-center">
                  <div
                    className="h-5 rounded-r-sm"
                    style={{ width: `${w}%`, minWidth: d.minutes > 0 ? 3 : 0, backgroundColor: color(i) }}
                  />
                  <span className="whitespace-nowrap pl-2 text-xs font-semibold tabular-nums text-gray-800">
                    {d.minutes} min <span className="font-normal text-gray-400">({pctOf(d.minutes, total)})</span>
                  </span>
                </div>
              );
            })}

            {/* x-axis: Total Delay Duration (min) */}
            <div className="relative h-6">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-1 -translate-x-1/2 text-[10px] tabular-nums text-gray-400"
                  style={{ left: `${(t / axisMax) * 100}%` }}
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-1 text-center text-[11px] text-gray-400">Total Delay Duration (min)</p>
          </div>
        </div>
      </div>

      {/* ── Summary table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Delay Code</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Delay Type</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Total Duration (min)</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.code} className="border-b border-gray-50">
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2 font-semibold text-gray-900">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color(i) }} />
                    {d.code}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-600">{d.description}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{d.minutes} min</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-700">{pctOf(d.minutes, total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-slate-50">
              <td className="px-4 py-3 font-semibold text-gray-700" colSpan={2}>Total Delay Duration</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand">{total} min</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-700">{total > 0 ? "100%" : "0%"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
