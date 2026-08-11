"use client";
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui";
import { fmtDurationLong, formatDate, todayStr } from "@/lib/robo/utils";

type Mode = "ALL" | "DATE";

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
  const [mode, setMode] = useState<Mode>("ALL");
  const [date, setDate] = useState<string>(todayStr());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPreview = useCallback(async (m: Mode, d: string) => {
    setLoading(true);
    const qs = m === "DATE" && d ? `?date=${encodeURIComponent(d)}` : "";
    const res = await fetch(`/api/robo/reports/summary${qs}`);
    const data: Preview | null = res.ok ? await res.json() : null;
    setPreview(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadPreview(mode, date); }, [mode, date, loadPreview]);

  const query = mode === "DATE" && date ? `?date=${encodeURIComponent(date)}` : "";
  const scopeLabel = mode === "ALL" ? "All production records to date" : `Records for ${formatDate(date)}`;
  const select = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  const hasProduction = (preview?.totalSlabs ?? 0) > 0;
  const hasDelays = (preview?.delayEvents ?? 0) > 0;

  return (
    <div className="max-w-3xl space-y-6">
      {/* ── Date filter ── */}
      <Card>
        <h2 className="mb-4 font-semibold text-gray-800">Date Filter</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select value={mode} onChange={e => setMode(e.target.value as Mode)} className={select}>
            <option value="ALL">All</option>
            <option value="DATE">Random Date</option>
          </select>
          {mode === "DATE" && (
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={select} />
          )}
          <span className="text-xs text-gray-500">{scopeLabel}</span>
        </div>

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
