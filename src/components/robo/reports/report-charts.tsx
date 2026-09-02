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
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area,
} from "recharts";
import { fmtDurationLong } from "@/lib/robo/utils";
import type { HourBucket } from "@/lib/robo/hourlyProduction";
import {
  DELAY_HUE, PRODUCTION_HUE, GRID, AXIS, MUTED, TOOLTIP_STYLE,
  type TrendPoint,
} from "./chart-tokens";

/**
 * Production Rate per Hour — slabs completed in each hour of the selected
 * batch's run. One point per hour across the batch's own timeline (see
 * hourlyProduction.ts), the exact count printed above each point, and the
 * 24-hour interval on the x-axis. Angled x-labels so a full run's worth of
 * hours stays readable.
 */
export function HourlyProductionLine({ data }: { data: HourBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart data={data} margin={{ top: 24, right: 20, left: -6, bottom: 44 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false}
          interval={0} angle={-40} textAnchor="end" height={62} />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
          formatter={(v: number) => [`${v} slab${v === 1 ? "" : "s"}`, "Completed"]} />
        <Line type="monotone" dataKey="slabs" stroke={PRODUCTION_HUE} strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: PRODUCTION_HUE }} activeDot={{ r: 5 }} name="Slabs">
          <LabelList dataKey="slabs" position="top" style={{ fontSize: 10, fontWeight: 600, fill: "#555" }} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
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
