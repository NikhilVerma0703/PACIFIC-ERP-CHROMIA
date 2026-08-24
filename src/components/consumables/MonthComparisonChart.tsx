"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";

interface ComparisonRow {
  department: string;
  thisMonth: number;
  lastMonth: number;
}

interface ApiResponse {
  data: ComparisonRow[];
  thisMonthName: string;
  lastMonthName: string;
}

function CustomTooltip({ active, payload, label, lastMonthName, thisMonthName }: any) {
  if (!active || !payload?.length) return null;
  const last = payload.find((p: any) => p.dataKey === "lastMonth");
  const curr = payload.find((p: any) => p.dataKey === "thisMonth");
  const diff = curr && last ? curr.value - last.value : null;
  const pct = last?.value > 0 && diff !== null
    ? ((diff / last.value) * 100).toFixed(1) : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 text-sm min-w-[200px]">
      <p className="font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{label}</p>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between gap-8">
          <span className="flex items-center gap-1.5 text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block" />
            {lastMonthName}
          </span>
          <span className="font-semibold text-gray-700">
            {(last?.value ?? 0).toLocaleString("en-IN")}
          </span>
        </div>
        <div className="flex justify-between gap-8">
          <span className="flex items-center gap-1.5 text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />
            {thisMonthName}
          </span>
          <span className="font-bold text-blue-600">
            {(curr?.value ?? 0).toLocaleString("en-IN")}
          </span>
        </div>
        {pct !== null && (
          <div className="flex justify-between gap-8 pt-1.5 border-t border-gray-100">
            <span className="text-gray-400">Change</span>
            <span className={`font-bold ${Number(pct) > 0 ? "text-green-600" : Number(pct) < 0 ? "text-red-600" : "text-gray-500"}`}>
              {Number(pct) > 0 ? "+" : ""}{pct}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MonthComparisonChart() {
  const [data, setData]     = useState<ComparisonRow[]>([]);
  const [labels, setLabels] = useState({ thisMonth: "This Month", lastMonth: "Last Month" });
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/consumables/charts/month-comparison")
      .then(jsonOrThrow)
      .then((res: ApiResponse) => {
        setData(res.data);
        setLabels({ thisMonth: res.thisMonthName, lastMonth: res.lastMonthName });
        setLoading(false);
      })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  }, []);

  const totalThis = data.reduce((s, d) => s + d.thisMonth, 0);
  const totalLast = data.reduce((s, d) => s + d.lastMonth, 0);
  const pctChange = totalLast > 0
    ? (((totalThis - totalLast) / totalLast) * 100).toFixed(1)
    : null;
  const isUp   = pctChange !== null && Number(pctChange) > 0;
  const isDown = pctChange !== null && Number(pctChange) < 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
      {/* Accent bar — green if up, red if down, gray if flat */}
      <div className="h-1 w-full"
        style={{ background: isUp
          ? "linear-gradient(to right, #10b981, #34d399)"
          : isDown
          ? "linear-gradient(to right, #ef4444, #f97316)"
          : "linear-gradient(to right, #64748b, #94a3b8)" }} />

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Comparison</p>
            <h2 className="text-xl font-bold text-gray-800 mt-0.5">Month-over-Month</h2>
            <p className="text-sm text-gray-400 mt-1">
              {labels.lastMonth} vs {labels.thisMonth} · by department
            </p>
          </div>

          {pctChange !== null && !loading && (
            <div className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-2 rounded-xl shrink-0 ${
              isUp   ? "bg-green-50 text-green-700 border border-green-200" :
              isDown ? "bg-red-50 text-red-700 border border-red-200" :
                       "bg-gray-100 text-gray-600 border border-gray-200"
            }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isUp ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                ) : isDown ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 12H7" />
                )}
              </svg>
              {isUp ? "+" : ""}{pctChange}% overall
            </div>
          )}
        </div>

        {/* Summary totals */}
        {!loading && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-slate-500" />
                <span className="text-xs text-gray-400 font-medium">{labels.lastMonth}</span>
              </div>
              <p className="text-xl font-bold text-gray-700 tabular-nums">
                {totalLast.toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">entries</p>
            </div>
            <div className="bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
                <span className="text-xs text-blue-500 font-medium">{labels.thisMonth}</span>
              </div>
              <p className="text-xl font-bold text-blue-700 tabular-nums">
                {totalThis.toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-blue-400 mt-0.5">entries</p>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-5 mb-4 pb-3 border-b border-gray-100 text-sm text-gray-500">
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 rounded-sm bg-slate-500" />
            {labels.lastMonth}
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 rounded-sm bg-blue-500" />
            {labels.thisMonth}
          </span>
        </div>

        {/* Chart */}
        <div className="h-72">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading data...</p>
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No comparison data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 32 }}
                barCategoryGap="30%"
                barGap={2}
              >
                <CartesianGrid strokeDasharray="0" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="department"
                  tick={{ fontSize: 12, fill: "#374151", fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-20}
                  textAnchor="end"
                  interval={0}
                  height={48}
                />
                <YAxis
                  tick={{ fontSize: 13, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                />
                <Tooltip
                  content={
                    <CustomTooltip
                      lastMonthName={labels.lastMonth}
                      thisMonthName={labels.thisMonth}
                    />
                  }
                  cursor={{ fill: "#f8fafc" }}
                />
                <Bar dataKey="lastMonth" fill="#64748b" radius={[4, 4, 0, 0]} maxBarSize={28} minPointSize={6} />
                <Bar dataKey="thisMonth" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} minPointSize={6} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
