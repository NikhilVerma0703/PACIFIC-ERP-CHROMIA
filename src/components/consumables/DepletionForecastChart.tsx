"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, Cell,
} from "recharts";

interface ForecastItem {
  itemName: string;
  unit: string;
  currentStock: number;
  avgDailyConsumption: number;
  daysRemaining: number;
  forecastDate: string;
  status: "critical" | "warning" | "ok" | "out";
}

interface ChartItem extends ForecastItem {
  label: string;
  displayDays: number; // min 1.2 so zero-stock bars are still visible
}

const STATUS_COLOR: Record<ForecastItem["status"], string> = {
  out:      "#6b7280",
  critical: "#ef4444",
  warning:  "#f59e0b",
  ok:       "#22c55e",
};

const STATUS_LABEL: Record<ForecastItem["status"], string> = {
  out:      "Out of Stock",
  critical: "Critical (≤7 days)",
  warning:  "Warning (≤14 days)",
  ok:       "OK (>14 days)",
};

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: ForecastItem = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 text-sm min-w-[200px]">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[d.status] }} />
        <p className="font-bold text-gray-900">{d.itemName}</p>
      </div>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-8">
          <span className="text-gray-400">Current Stock</span>
          <span className="font-semibold text-gray-800">{d.currentStock} {d.unit}</span>
        </div>
        <div className="flex justify-between gap-8">
          <span className="text-gray-400">Avg. Daily Use</span>
          <span className="font-semibold text-gray-800">{d.avgDailyConsumption} {d.unit}/day</span>
        </div>
        <div className="flex justify-between gap-8 pt-1.5 border-t border-gray-100">
          <span className="text-gray-400">Days Remaining</span>
          <span className="font-bold" style={{ color: STATUS_COLOR[d.status] }}>
            {d.daysRemaining === 0 ? "Out of stock" : `~${d.daysRemaining} days`}
          </span>
        </div>
        {d.status !== "out" && (
          <div className="flex justify-between gap-8">
            <span className="text-gray-400">Est. Stockout</span>
            <span className="font-semibold text-gray-800">{d.forecastDate}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Custom bar label: shows "OUT" for zero-stock, shows day count for others
// Recharts Bar label spreads data row fields directly as props
function BarLabel({ x, y, width, height, daysRemaining }: any) {
  const isOut = daysRemaining === 0;
  if (isOut) {
    return (
      <text x={Number(x) + Number(width) + 8} y={Number(y) + Number(height) / 2 + 5}
        fontSize={12} fill="#dc2626" fontWeight={700} letterSpacing="0.05em">
        RESTOCK
      </text>
    );
  }
  if (Number(width) < 20) return null;
  return (
    <text x={Number(x) + Number(width) + 8} y={Number(y) + Number(height) / 2 + 5}
      fontSize={13} fill="#6b7280" fontWeight={500}>
      {daysRemaining}d
    </text>
  );
}

export default function DepletionForecastChart() {
  const [data, setData]       = useState<ChartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/consumables/charts/depletion-forecast")
      .then(jsonOrThrow)
      .then((raw: ForecastItem[]) => {
        const mapped: ChartItem[] = raw.map((item) => ({
          ...item,
          label: item.itemName.length > 16 ? item.itemName.slice(0, 16) + "…" : item.itemName,
          // Give 0-stock items a small minimum bar so they're visible
          displayDays: item.daysRemaining === 0 ? 5.0 : item.daysRemaining,
        }));
        setData(mapped);
        setLoading(false);
      })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  }, []);

  const outCount      = data.filter((d) => d.status === "out").length;
  const criticalCount = data.filter((d) => d.status === "critical").length;
  const warningCount  = data.filter((d) => d.status === "warning").length;
  const okCount       = data.filter((d) => d.status === "ok").length;
  const chartH        = Math.max(380, data.length * 48);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
      {/* Accent bar */}
      <div className="h-1 w-full"
        style={{ background: criticalCount + outCount > 0
          ? "linear-gradient(to right, #ef4444, #f97316)"
          : warningCount > 0
          ? "linear-gradient(to right, #f59e0b, #fbbf24)"
          : "linear-gradient(to right, #22c55e, #34d399)" }} />

      <div className="p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Forecasting</p>
            <h2 className="text-2xl font-bold text-gray-800 mt-0.5">Stock Depletion Forecast</h2>
            <p className="text-sm text-gray-400 mt-1">
              Based on average daily consumption from real data
            </p>
          </div>

          {/* Status badges */}
          {!loading && (
            <div className="flex items-center gap-2 flex-wrap">
              {outCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                  <span className="w-2 h-2 rounded-full bg-gray-500" />
                  {outCount} Out of Stock
                </span>
              )}
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {criticalCount} Critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {warningCount} Warning
                </span>
              )}
              {okCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  {okCount} Healthy
                </span>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-5 mb-5 text-sm text-gray-500 flex-wrap items-center border-b border-gray-100 pb-4">
          {(["out", "critical", "warning", "ok"] as const).map((s) => (
            <span key={s} className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]}
            </span>
          ))}
          <span className="flex items-center gap-2 ml-2">
            <span className="inline-block w-6 border-t-2 border-dashed border-red-400" />
            <span className="text-gray-400">7-day</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-6 border-t-2 border-dashed border-amber-400" />
            <span className="text-gray-400">14-day</span>
          </span>
        </div>

        {/* Crisis banner — shown when majority of items need restocking */}
        {!loading && outCount >= 3 && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-bold text-red-700">
                {outCount} item{outCount > 1 ? "s" : ""} need immediate restocking
              </p>
              <p className="text-xs text-red-500 mt-0.5">
                These items have zero stock remaining. Purchase orders should be raised urgently.
              </p>
            </div>
          </div>
        )}

        {/* Chart */}
        <div style={{ height: chartH }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="w-8 h-8 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Calculating forecast...</p>
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Not enough consumption history to forecast.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 5, right: 64, left: 8, bottom: 24 }}
              >
                <XAxis
                  type="number"
                  domain={[0, 90]}
                  tick={{ fontSize: 14, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v === 90 ? "90+" : String(v)}
                  label={{ value: "Days remaining", position: "insideBottom", offset: -14, fontSize: 14, fill: "#9ca3af" }}
                />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fontSize: 14, fill: "#1f2937", fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  width={140}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />

                {/* Background risk zones */}
                <ReferenceArea x1={0}  x2={7}  fill="#fee2e2" fillOpacity={0.25} />
                <ReferenceArea x1={7}  x2={14} fill="#fef3c7" fillOpacity={0.25} />
                <ReferenceArea x1={14} x2={90} fill="#f0fdf4" fillOpacity={0.20} />

                <ReferenceLine x={7}  stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1.5} />
                <ReferenceLine x={14} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5} />

                <Bar
                  dataKey="displayDays"
                  radius={[0, 5, 5, 0]}
                  maxBarSize={26}
                  label={<BarLabel />}
                >
                  {data.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={STATUS_COLOR[entry.status]}
                      fillOpacity={entry.status === "out" ? 0.9 : 0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer note */}
        {!loading && data.length > 0 && (
          <p className="text-xs text-gray-400 mt-3 text-right border-t border-gray-100 pt-3">
            Capped at 90 days · Hover bars for details · Showing {data.length} items
          </p>
        )}
      </div>
    </div>
  );
}
