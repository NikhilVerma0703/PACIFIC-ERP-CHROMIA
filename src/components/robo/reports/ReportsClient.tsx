"use client";
// Client half of the Robo Reports page: date-filtered KPI cards and downtime
// breakdowns, plus an independently ranged (7/15/30-day) trend section. The
// server page owns the shell and header; everything data-driven lives here.
import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui";
import { fmtDurationLong, formatDate, todayStr } from "@/lib/robo/utils";
import { reportQuery, type ReportMode } from "@/lib/robo/reportQuery";
import { RoboReportFilters, useRoboBatchOptions } from "@/components/robo/RoboReportFilters";
import { DelayAnalysis } from "@/components/robo/reports/DelayAnalysis";
import type { HourBucket } from "@/lib/robo/hourlyProduction";
import type { DelaySlice, TrendPoint } from "@/components/robo/reports/chart-tokens";

/* A grey block the exact height of the figure it stands in for, so nothing
   shifts when the chart arrives. */
function ChartSkeleton({ height }: { height: number }) {
  return <div className="animate-pulse rounded bg-slate-100" style={{ height }} />;
}

/* Recharts is ~5 MB of module graph — kept out of the first load and pulled in
   after the frame paints. Only the Trend Analysis figures use it now; the Delay
   Analysis chart is plain CSS (see DelayAnalysis) and renders immediately.
   next/dynamic is compiled by SWC, which requires the import call and the
   options object inline at each call site — a shared helper fails the build.
   All three still resolve to one shared chunk. */
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
const HourlyProductionLine = dynamic(
  () => import("@/components/robo/reports/report-charts").then(m => m.HourlyProductionLine),
  { ssr: false, loading: () => <ChartSkeleton height={340} /> },
);

interface Summary {
  date: string | null;
  totalSlabs: number;
  /** First In Time → last Out Time across the filtered slabs, in minutes; null
   *  when nothing has completed. */
  productionTimeMinutes: number | null;
  /** Total Slabs ÷ that span in hours (delays included), 1 dp; null when there
   *  is no completed span. Built only from recorded times — no wall clock — so
   *  it is stable, unlike the old shift-open-time figure. See the summary route. */
  avgSlabsPerHour: number | null;
  totalDelayMins: number;
  delayEvents: number;
  /** Every delay type, highest duration first — see the summary route. */
  delayTypes: DelaySlice[];
}

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
  const [mode, setMode] = useState<ReportMode>("ALL");
  const [date, setDate] = useState<string>(todayStr());
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [batch, setBatch] = useState<string>("");
  // Every batch on record for the dropdown; also defaults `batch` to the latest
  // one on first open (change 4), which the operator can clear or change.
  const batchOptions = useRoboBatchOptions(setBatch);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Production Rate per Hour — driven by the BATCH alone (its own run's hours),
  // not the date filter, so a batch that ran past midnight keeps its full
  // timeline. See /api/robo/reports/hourly.
  const [hourly, setHourly] = useState<HourBucket[]>([]);
  const [loadingHourly, setLoadingHourly] = useState(true);

  const [rangeDays, setRangeDays] = useState<number>(7);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loadingTrends, setLoadingTrends] = useState(true);

  const loadSummary = useCallback(async (qs: string) => {
    setLoadingSummary(true);
    const res = await fetch(`/api/robo/reports/summary${qs}`);
    setSummary(res.ok ? await res.json() : null);
    setLoadingSummary(false);
  }, []);

  const loadHourly = useCallback(async (b: string) => {
    setLoadingHourly(true);
    const qs = b.trim() ? `?batch=${encodeURIComponent(b.trim())}` : "";
    const res = await fetch(`/api/robo/reports/hourly${qs}`);
    const data = res.ok ? await res.json() : { series: [] };
    setHourly(data.series ?? []);
    setLoadingHourly(false);
  }, []);

  const loadTrends = useCallback(async (days: number) => {
    setLoadingTrends(true);
    const res = await fetch(`/api/robo/reports/trends?days=${days}`);
    const data = res.ok ? await res.json() : { series: [] };
    setTrends(data.series ?? []);
    setLoadingTrends(false);
  }, []);

  // Built once, in the shared module the Downloads screen uses, so preview and
  // download can never send a different filter — and depended on as a string so
  // this only refetches when the effective query changes.
  const query = reportQuery({ mode, date, from, to, batch });
  // Debounced: the Batch box fires on every keystroke, so coalesce a burst of
  // typing into one request rather than one per character. Date/mode changes
  // are single events and this 250ms is imperceptible on them.
  useEffect(() => {
    const t = setTimeout(() => loadSummary(query), 250);
    return () => clearTimeout(t);
  }, [query, loadSummary]);
  // Only the batch drives the hourly chart, and it is debounced against typing.
  useEffect(() => {
    const t = setTimeout(() => loadHourly(batch), 250);
    return () => clearTimeout(t);
  }, [batch, loadHourly]);
  useEffect(() => { loadTrends(rangeDays); }, [rangeDays, loadTrends]);

  // Every delay type, and the whole period's delay minutes as the % base — so
  // each type's share is of ALL downtime and the shares add to 100%.
  const delayData = summary?.delayTypes ?? [];
  const delayTotal = summary?.totalDelayMins ?? 0;

  const dateScope =
    mode === "ALL" ? "All production records to date"
    : mode === "DATE" ? `Production on ${formatDate(date)}`
    : `Production from ${from ? formatDate(from) : "the start"} to ${to ? formatDate(to) : "now"}`;
  const scopeLabel = batch.trim() ? `${dateScope} · Batch ${batch.trim()}` : dateScope;
  const select = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="space-y-8">
      {/* ── Filters: Batch Number, then Production Date ── */}
      <div className="flex flex-col gap-2">
        <RoboReportFilters
          mode={mode} setMode={setMode}
          date={date} setDate={setDate}
          from={from} setFrom={setFrom}
          to={to} setTo={setTo}
          batch={batch} setBatch={setBatch}
          batchOptions={batchOptions}
        />
        <p className="text-xs text-gray-500">{scopeLabel}</p>
      </div>

      {/* ── KPIs (driven by the date filter) ── */}
      {loadingSummary ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <Card key={i}>
                <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
                <div className="mt-2 h-7 w-20 animate-pulse rounded bg-slate-100" />
              </Card>
            ))}
          </div>
          <Card>
            <div className="h-4 w-52 animate-pulse rounded bg-slate-100" />
            <div className="mt-4"><ChartSkeleton height={320} /></div>
          </Card>
        </div>
      ) : (
        <>
          {/* Order fixed by request: Total Slabs, Total Production Time, Total
              Delays, Slabs/Hour. Total Production Time uses the same long
              duration format as Total Delays so the two read alike; "—" when no
              slab in the selection has completed yet. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Slabs Produced" value={String(summary?.totalSlabs ?? 0)} />
            <StatCard label="Total Production Time" value={summary?.productionTimeMinutes != null ? fmtDurationLong(summary.productionTimeMinutes) : "—"} />
            <StatCard label="Total Delays" value={fmtDurationLong(summary?.totalDelayMins ?? 0)} tone="red" />
            <StatCard label="Avg Slabs/hour" value={summary?.avgSlabsPerHour != null ? String(summary.avgSlabsPerHour) : "—"} tone="brand" />
          </div>

          {/* ── Delay Analysis — every delay type, full width ── */}
          <ChartCard title="Delay Analysis — All Delay Types" subtitle="Every delay type by total duration, longest first">
            {delayData.length === 0 || delayTotal <= 0 ? (
              <EmptyFigure>No delays recorded for this selection</EmptyFigure>
            ) : (
              <DelayAnalysis data={delayData} total={delayTotal} />
            )}
          </ChartCard>
        </>
      )}

      {/* ── Production Rate per Hour (the selected batch's own run) ── */}
      <ChartCard
        title="Production Rate per Hour"
        subtitle={batch.trim()
          ? `Batch ${batch.trim()} — slabs completed each hour, by Out Time, across the batch's run`
          : "Slabs completed each hour, by Out Time"}
      >
        {!batch.trim() ? (
          <EmptyFigure>Select a batch number above to see its hourly production rate.</EmptyFigure>
        ) : loadingHourly ? (
          <ChartSkeleton height={340} />
        ) : hourly.length === 0 ? (
          <EmptyFigure>No completed slabs with times for this batch.</EmptyFigure>
        ) : (
          <HourlyProductionLine data={hourly} />
        )}
      </ChartCard>

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
