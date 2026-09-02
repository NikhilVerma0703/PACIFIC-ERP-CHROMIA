"use client";
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui";
import { fmtDurationLong, formatDate, todayStr } from "@/lib/robo/utils";
import { reportQuery, type ReportMode } from "@/lib/robo/reportQuery";
import { RoboReportFilters, useRoboBatchOptions } from "@/components/robo/RoboReportFilters";

interface Preview {
  totalSlabs: number;
  totalDelayMins: number;
  delayEvents: number;
}

function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}

export function DownloadsClient() {
  const [mode, setMode] = useState<ReportMode>("ALL");
  const [date, setDate] = useState<string>(todayStr());
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [batch, setBatch] = useState<string>("");
  // Batch dropdown options; also defaults `batch` to the latest batch on open.
  const batchOptions = useRoboBatchOptions(setBatch);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPreview = useCallback(async (qs: string) => {
    setLoading(true);
    const res = await fetch(`/api/robo/reports/summary${qs}`);
    const data: Preview | null = res.ok ? await res.json() : null;
    setPreview(data);
    setLoading(false);
  }, []);

  // The one query string for BOTH the preview and the two downloads, built in
  // the shared module the Reports screen uses, so the counts shown and the file
  // saved can never be a different filter. See lib/robo/reportQuery.ts.
  const query = reportQuery({ mode, date, from, to, batch });
  // Debounced, because the Batch box fires per keystroke — one request for a
  // burst of typing rather than one per character.
  useEffect(() => {
    const t = setTimeout(() => loadPreview(query), 250);
    return () => clearTimeout(t);
  }, [query, loadPreview]);

  const dateScope =
    mode === "ALL" ? "All production records to date"
    : mode === "DATE" ? `Records for ${formatDate(date)}`
    : `Records from ${from ? formatDate(from) : "the start"} to ${to ? formatDate(to) : "now"}`;
  const scopeLabel = batch.trim() ? `${dateScope} · Batch ${batch.trim()}` : dateScope;

  const hasProduction = (preview?.totalSlabs ?? 0) > 0;
  const hasDelays = (preview?.delayEvents ?? 0) > 0;

  return (
    <div className="max-w-3xl space-y-6">
      {/* ── Filters: Batch Number, then Production Date ── */}
      <Card>
        <h2 className="mb-4 font-semibold text-gray-800">Filters</h2>
        <RoboReportFilters
          mode={mode} setMode={setMode}
          date={date} setDate={setDate}
          from={from} setFrom={setFrom}
          to={to} setTo={setTo}
          batch={batch} setBatch={setBatch}
          batchOptions={batchOptions}
        />
        <p className="mt-2 text-xs text-gray-500">{scopeLabel}</p>

        {/* What the current filter covers */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Production Records", value: loading ? "…" : String(preview?.totalSlabs ?? 0) },
            { label: "Delay Records", value: loading ? "…" : String(preview?.delayEvents ?? 0) },
            { label: "Total Delay Duration", value: loading ? "…" : fmtDurationLong(preview?.totalDelayMins ?? 0) },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-gray-100 bg-slate-50 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-gray-500">{s.label}</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-800">{s.value}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Download options ── */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Complete Production */}
        <Card className="flex flex-col">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xl">📄</span>
            <h2 className="font-semibold text-gray-800">Complete Production</h2>
          </div>
          <button
            onClick={() => download(`/api/robo/exports/production${query}`)}
            disabled={loading || !hasProduction}
            className="mt-4 w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold tracking-wide text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
            📥 DOWNLOAD EXCEL
          </button>
          {!loading && !hasProduction && (
            <p className="mt-2 text-center text-xs text-gray-400">No production records for this filter</p>
          )}
        </Card>

        {/* Delay List */}
        <Card className="flex flex-col">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xl">⏱</span>
            <h2 className="font-semibold text-gray-800">Delay List</h2>
          </div>
          <button
            onClick={() => download(`/api/robo/exports/delays${query}`)}
            disabled={loading || !hasDelays}
            className="mt-4 w-full rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold tracking-wide text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50">
            📥 DOWNLOAD EXCEL
          </button>
          {!loading && !hasDelays && (
            <p className="mt-2 text-center text-xs text-gray-400">No delay records for this filter</p>
          )}
        </Card>
      </div>
    </div>
  );
}
