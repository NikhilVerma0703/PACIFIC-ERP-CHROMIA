"use client";
/**
 * Every Recharts-backed figure on the Robo Reports page.
 *
 * Kept in its own module so the page can pull it in with next/dynamic — the
 * charting library is by far the heaviest thing on this route, and loading it
 * after the page frame has painted is what makes Reports open immediately.
 */
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area,
} from "recharts";
import { fmtDurationLong } from "@/lib/robo/utils";
import {
  SERIES, ROBOT_INDEX, DELAY_HUE, PRODUCTION_HUE, GRID, AXIS, MUTED, TOOLTIP_STYLE, pct,
  type MachineSlice, type DelaySlice, type TrendPoint,
} from "./chart-tokens";

const sliceLabel = ({ name, percent }: { name?: string; percent?: number }) =>
  `${name} ${Math.round((percent ?? 0) * 1000) / 10}%`;

export function MachinePie({ data, total }: { data: MachineSlice[]; total: number }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <PieChart>
        <Pie data={data} dataKey="minutes" nameKey="short"
          cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={2}
          stroke="#ffffff" strokeWidth={2} label={sliceLabel} labelLine={false}>
          {data.map((m, i) => <Cell key={m.short} fill={SERIES[ROBOT_INDEX[m.short] ?? i]} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE}
          formatter={(v: number) => [`${v} min · ${pct(v, total)}`, "Downtime"]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DelayPie({ data, total }: { data: DelaySlice[]; total: number }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <PieChart>
        <Pie data={data} dataKey="minutes" nameKey="code"
          cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={2}
          stroke="#ffffff" strokeWidth={2} label={sliceLabel} labelLine={false}>
          {data.map((d, i) => <Cell key={d.code} fill={SERIES[i % SERIES.length]} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE}
          formatter={(v: number, _n: string, p: { payload?: DelaySlice }) =>
            [`${v} min · ${pct(v, total)}`, p?.payload?.description ?? "Delay"]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

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
