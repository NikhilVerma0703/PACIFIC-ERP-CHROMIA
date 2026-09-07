"use client";
/**
 * Every Recharts-backed figure on the Robo Reports page.
 *
 * Kept in its own module so the page can pull it in with next/dynamic — the
 * charting library is by far the heaviest thing on this route, and loading it
 * after the page frame has painted is what makes Reports open immediately.
 */
import {
  Tooltip, ResponsiveContainer, LabelList,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area, ReferenceLine,
} from "recharts";
import { fmtDurationLong } from "@/lib/robo/utils";
import type { HourBucket } from "@/lib/robo/hourlyProduction";
import { hourlyYAxis } from "@/lib/robo/hourlyAxis";
import {
  DELAY_HUE, PRODUCTION_HUE, GRID, AXIS, MUTED, TOOLTIP_STYLE,
  type TrendPoint,
} from "./chart-tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "21 Aug" from a yyyy-mm-dd, parsed as text so no timezone shifts the day. */
function shortDate(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]}` : "";
}

/* Layout for Production Rate per Hour. Taller than before, with a readable
   minimum WIDTH PER HOUR so a long run (e.g. a 40-hour batch) scrolls sideways
   instead of squashing every hour into a sliver. The Y-axis is pinned on the
   left while the plot scrolls under it. */
const HP_HEIGHT = 380;   // chart height (was 340)
const HP_AXIS_W = 46;    // Y-axis gutter — also the width of the pinned overlay
const HP_XAXIS_H = 74;   // bottom room for the angled time labels
const HP_TOP = 24;       // top room for the per-point value labels and date markers
const HP_HOUR_PX = 52;   // readable width per hour before horizontal scroll kicks in

/**
 * Production Rate per Hour — slabs completed in each hour of the selected
 * batch's run. One point per hour across the batch's own timeline (see
 * hourlyProduction.ts), the exact count printed above each point.
 *
 * READABILITY: every hour gets a fixed minimum width, so a long run does not
 * shrink to fit — it becomes horizontally scrollable inside the card (never the
 * page), and the Y-axis stays pinned on the left as an opaque, tick-aligned copy
 * so the scale is always readable while scrolling. The Y-axis is 0…12 by default
 * and extends in 2s only when an hour tops 12 (hourlyYAxis). When the run crosses
 * midnight the hours flow straight across the boundary (…23:00–00:00, 00:00–01:00…)
 * with no gap, and a dated marker is drawn where the day changes; the first date
 * is named in the card subtitle.
 */
export function HourlyProductionLine({ data }: { data: HourBucket[] }) {
  const { max: yMax, ticks } = hourlyYAxis(data.reduce((m, b) => Math.max(m, b.slabs), 0));
  // The X-axis is keyed by position, not by the hour label: past 24 buckets a
  // label repeats ("06:00–07:00" on both days), and Recharts then swaps the
  // category domain for indices — the midnight ReferenceLine positioned by
  // label silently vanished, and two midnights gave duplicate React keys.
  const points = data.map((b, i) => ({ ...b, x: i }));
  const hourLabel = (x: number) => data[x]?.label ?? "";
  const boundaries = points.filter((b, i) => i > 0 && b.date && b.date !== data[i - 1].date);
  const plotWidth = data.length * HP_HOUR_PX;

  return (
    <div className="relative">
      {/* The plot. Scrolls horizontally when the run is wider than the card;
          minWidth gives each hour a readable slice, and when the hours are few
          it simply fills the card. The scroll lives here, so the page never
          overflows sideways. */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: plotWidth }}>
          <ResponsiveContainer width="100%" height={HP_HEIGHT}>
            <LineChart data={points} margin={{ top: HP_TOP, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              {/* Left padding keeps the first hour's angled label clear of the
                  pinned Y-axis instead of tucked behind it. */}
              <XAxis dataKey="x" tickFormatter={hourLabel} height={HP_XAXIS_H} interval={0} angle={-45} textAnchor="end"
                padding={{ left: 30, right: 20 }}
                tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} />
              <YAxis width={HP_AXIS_W} domain={[0, yMax]} ticks={ticks} allowDecimals={false}
                tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
                labelFormatter={(x: number) => hourLabel(x)}
                formatter={(v: number) => [`${v} slab${v === 1 ? "" : "s"}`, "Completed"]} />
              {/* Date markers at each midnight the run crossed — drawn behind the line. */}
              {boundaries.map((b) => (
                <ReferenceLine key={b.x} x={b.x} stroke={AXIS} strokeDasharray="4 3"
                  label={{ value: shortDate(b.date), position: "top", fontSize: 11, fontWeight: 600, fill: MUTED }} />
              ))}
              <Line type="monotone" dataKey="slabs" stroke={PRODUCTION_HUE} strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 0, fill: PRODUCTION_HUE }} activeDot={{ r: 6 }} name="Slabs">
                <LabelList dataKey="slabs" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "#555" }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pinned Y-axis: an opaque, clipped copy of the same axis — identical
          height, margins and domain, so its ticks line up exactly with the
          plot's gridlines — held over the left edge so the scale stays readable
          while the plot scrolls under it. */}
      <div className="pointer-events-none absolute left-0 top-0 overflow-hidden bg-white"
        style={{ width: HP_AXIS_W, height: HP_HEIGHT }}>
        <div style={{ width: 200, height: HP_HEIGHT }}>
          <ResponsiveContainer width="100%" height={HP_HEIGHT}>
            <LineChart data={points} margin={{ top: HP_TOP, right: 24, left: 0, bottom: 0 }}>
              <XAxis dataKey="x" height={HP_XAXIS_H} tick={false} axisLine={false} tickLine={false} />
              <YAxis width={HP_AXIS_W} domain={[0, yMax]} ticks={ticks} allowDecimals={false}
                tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// The Machine Performance and Delay Analysis pies were removed: Machine
// Performance is gone from the page, and Delay Analysis is now the all-types
// horizontal bar chart in DelayAnalysis.tsx (plain CSS). Only the Trend
// Analysis figures below still use Recharts.

export function DelayByDayBar({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(11,11,11,0.04)" }}
          formatter={(v: number) => [fmtDurationLong(v), "Delay"]} />
        <Bar dataKey="delayMins" fill={DELAY_HUE} radius={[4, 4, 0, 0]} maxBarSize={38} name="Delay" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SlabsPerHourLine({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} slabs/hr`, "Rate"]} />
        <Line type="monotone" dataKey="slabsPerHour" stroke={PRODUCTION_HUE} strokeWidth={2}
          dot={{ r: 4, strokeWidth: 0, fill: PRODUCTION_HUE }} activeDot={{ r: 5 }} name="Slabs / Hour" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DailyProductionArea({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="slabFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRODUCTION_HUE} stopOpacity={0.28} />
            <stop offset="100%" stopColor={PRODUCTION_HUE} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} slabs`, "Produced"]} />
        <Area type="monotone" dataKey="slabs" stroke={PRODUCTION_HUE} strokeWidth={2} fill="url(#slabFill)" name="Slabs" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
