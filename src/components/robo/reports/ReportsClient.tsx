"use client";
// Client half of the Robo Reports page: date-filtered KPI cards and downtime
// breakdowns, plus an independently ranged (7/15/30-day) trend section. The
// server page owns the shell and header; everything data-driven lives here.
import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui";
import { fmtDurationLong, formatDate, todayStr } from "@/lib/robo/utils";
import {
  SERIES, ROBOT_INDEX, pct,
  type MachineSlice, type DelaySlice, type TrendPoint,
} from "@/components/robo/reports/chart-tokens";

/* A grey block the exact height of the figure it stands in for, so nothing
   shifts when the chart arrives. */
function ChartSkeleton({ height }: { height: number }) {
  return <div className="animate-pulse rounded bg-slate-100" style={{ height }} />;
}

/* Recharts is ~5 MB of module graph. Loading it after the page frame has
   painted is what stops Reports hanging on a blank screen when it opens.
   All five figures share one chunk, so it is fetched once. */
/* next/dynamic is compiled by SWC, which requires the import call and the
   options object to be written out inline at each call site — a shared helper
   fails the build. All five still resolve to one shared chunk. */
const MachinePie = dynamic(
  () => import("@/components/robo/reports/report-charts").then(m => m.MachinePie),
  { ssr: false, loading: () => <ChartSkeleton height={230} /> },
);
const DelayPie = dynamic(
  () => import("@/components/robo/reports/report-charts").then(m => m.DelayPie),
  { ssr: false, loading: () => <ChartSkeleton height={230} /> },
);
const DelayByDayBar = dynamic(
  () => import("@/components/robo/reports/report-charts").then(m => m.DelayByDayBar),
  { ssr: false, loading: () => <ChartSkeleton height={260} /> },
);
const SlabsPerHourLine = dynamic(
  () => import("@/components/robo/reports/report-charts").then(m => m.SlabsPerHourLine),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);
const DailyProductionArea = dynamic(
  () => import("@/components/robo/reports/report-charts").then(m => m.DailyProductionArea),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);

interface Summary {
  date: string | null;
  totalSlabs: number;
  productionMinutes: number;
  slabsPerHour: number | null;
  totalDelayMins: number;
  delayEvents: number;
  machinePerformance: MachineSlice[];
  topDelayTypes: DelaySlice[];
}
type Mode = "ALL" | "DATE";

function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "brand" | "red" }) {
  const valueTone = tone === "brand" ? "text-brand" : tone === "red" ? "text-red-600" : "text-gray-900";
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${valueTone}`}>{value}</p>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="font-semibold text-gray-800">{title}</h3>
      {subtitle && <p className="mb-3 mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </Card>
  );
}

/** Centered placeholder inside a chart card — keeps the figure's footprint. */
function EmptyFigure({ children }: { children: ReactNode }) {
  return <p className="py-16 text-center text-sm text-gray-400">{children}</p>;
}

export function ReportsClient() {
  const [mode, setMode] = useState<Mode>("ALL");
  const [date, setDate] = useState<string>(todayStr());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  const [rangeDays, setRangeDays] = useState<number>(7);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loadingTrends, setLoadingTrends] = useState(true);

  const loadSummary = useCallback(async (m: Mode, d: string) => {
    setLoadingSummary(true);
    const qs = m === "DATE" && d ? `?date=${encodeURIComponent(d)}` : "";
    const res = await fetch(`/api/robo/reports/summary${qs}`);
    setSummary(res.ok ? await res.json() : null);
    setLoadingSummary(false);
  }, []);

  const loadTrends = useCallback(async (days: number) => {
    setLoadingTrends(true);
    const res = await fetch(`/api/robo/reports/trends?days=${days}`);
    const data = res.ok ? await res.json() : { series: [] };
    setTrends(data.series ?? []);
    setLoadingTrends(false);
  }, []);

  useEffect(() => { loadSummary(mode, date); }, [mode, date, loadSummary]);
  useEffect(() => { loadTrends(rangeDays); }, [rangeDays, loadTrends]);

  const machineTotal = (summary?.machinePerformance ?? []).reduce((s, m) => s + m.minutes, 0);
  const machineData = (summary?.machinePerformance ?? []).filter(m => m.minutes > 0);
  const delayTotal = (summary?.topDelayTypes ?? []).reduce((s, d) => s + d.minutes, 0);
  const delayData = summary?.topDelayTypes ?? [];

  const scopeLabel = mode === "ALL" ? "All production records to date" : `Production on ${formatDate(date)}`;
  const select = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="space-y-8">
      {/* ── Top date filter ── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Date Filter</label>
          <select value={mode} onChange={e => setMode(e.target.value as Mode)} className={select}>
            <option value="ALL">All</option>
            <option value="DATE">Random Date</option>
          </select>
          {mode === "DATE" && (
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={select} />
          )}
        </div>
        <p className="text-xs text-gray-500">{scopeLabel}</p>
      </div>

      {/* ── KPIs (driven by the date filter) ── */}
      {loadingSummary ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map(i => (
              <Card key={i}>
                <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
                <div className="mt-2 h-7 w-20 animate-pulse rounded bg-slate-100" />
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {[0, 1].map(i => (
              <Card key={i}>
                <div className="h-4 w-44 animate-pulse rounded bg-slate-100" />
                <div className="mt-4"><ChartSkeleton height={230} /></div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Total Slabs Produced" value={String(summary?.totalSlabs ?? 0)} />
            <StatCard label="Slabs / Hour" value={summary?.slabsPerHour != null ? String(summary.slabsPerHour) : "—"} tone="brand" />
            <StatCard label="Total Delays" value={fmtDurationLong(summary?.totalDelayMins ?? 0)} tone="red" />
          </div>

          {/* ── Filter-based visualizations ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Machine Performance */}
            <ChartCard title="Machine Performance" subtitle="Share of downtime attributed to each robot">
              {machineTotal <= 0 ? (
                <EmptyFigure>No machine-attributed delays for this selection</EmptyFigure>
              ) : (
                <>
                  <MachinePie data={machineData} total={machineTotal} />
                  <div className="mt-3 space-y-1.5">
                    {(summary?.machinePerformance ?? []).map((m, i) => (
                      <div key={m.short} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: SERIES[ROBOT_INDEX[m.short] ?? i] }} />
                        <span className="flex-1 text-gray-600">{m.name}</span>
                        <span className="tabular-nums text-gray-500">{m.minutes} min</span>
                        <span className="w-14 text-right font-semibold tabular-nums text-gray-800">
                          {pct(m.minutes, machineTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>

            {/* Delay Analysis */}
            <ChartCard title="Delay Analysis" subtitle="Top 5 delay types by total duration">
              {delayTotal <= 0 ? (
                <EmptyFigure>No delays recorded for this selection</EmptyFigure>
              ) : (
                <>
                  <DelayPie data={delayData} total={delayTotal} />
                  <div className="mt-3 space-y-1.5">
                    {delayData.map((d, i) => (
                      <div key={d.code} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SERIES[i % SERIES.length] }} />
                        <span className="w-10 shrink-0 font-semibold text-gray-700">{d.code}</span>
                        <span className="flex-1 truncate text-gray-500" title={d.description}>{d.description}</span>
                        <span className="tabular-nums text-gray-500">{d.minutes} min</span>
                        <span className="w-14 text-right font-semibold tabular-nums text-gray-800">
                          {pct(d.minutes, delayTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {/* ── Trend Analysis (independent range filter) ── */}
      <section className="mt-12 space-y-5 border-t-2 border-gray-200 pt-8">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="h-8 w-1.5 rounded-full bg-brand" />
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">Trend Analysis</h2>
          </div>
          <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))} className={select}>
            <option value={7}>Last 7 Days</option>
            <option value={15}>Last 15 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>
        </div>

        {loadingTrends ? (
          <div className="space-y-5">
            <Card>
              <div className="h-4 w-52 animate-pulse rounded bg-slate-100" />
              <div className="mt-4"><ChartSkeleton height={260} /></div>
            </Card>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {[0, 1].map(i => (
                <Card key={i}>
                  <div className="h-4 w-44 animate-pulse rounded bg-slate-100" />
                  <div className="mt-4"><ChartSkeleton height={240} /></div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Day-wise Delay Analysis */}
            <ChartCard title="Day-wise Delay Analysis" subtitle="Total delay duration per day (minutes)">
              <DelayByDayBar data={trends} />
            </ChartCard>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Daily Slabs / Hour Trend */}
              <ChartCard title="Daily Slabs / Hour Trend" subtitle="Production rate per day">
                <SlabsPerHourLine data={trends} />
              </ChartCard>

              {/* Daily Production Trend */}
              <ChartCard title="Daily Production Trend" subtitle="Slabs produced per day">
                <DailyProductionArea data={trends} />
              </ChartCard>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
