"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area,
  CartesianGrid, XAxis, YAxis, Tooltip,
} from "recharts";

interface TrendPoint { date: string; total: number; }

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className="font-bold text-blue-600 text-base">
        {Number(payload[0].value).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
        <span className="text-gray-400 font-normal text-xs ml-1">entries</span>
      </p>
    </div>
  );
}

export default function ConsumptionTrendChart() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/consumables/charts/consumption-trend?days=${days}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(console.error);
  }, [days]);

  const total = data.reduce((s, d) => s + d.total, 0);
  const peak  = data.reduce((m, d) => d.total > m ? d.total : m, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Top accent */}
      <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-blue-400" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Analytics</p>
            <h2 className="text-lg font-bold text-gray-800 mt-0.5">Consumption Trend</h2>
            {!loading && data.length > 0 && (
              <div className="flex items-center gap-4 mt-1.5">
                <span className="text-xs text-gray-500">
                  Total: <span className="font-semibold text-gray-700">
                    {total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </span>
                </span>
                <span className="text-xs text-gray-500">
                  Peak: <span className="font-semibold text-blue-600">
                    {peak.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </span>
                </span>
              </div>
            )}
          </div>
          {/* Period toggle */}
          <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all duration-150 ${
                  days === d
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="h-64">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading data...</p>
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                  width={38}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3b82f6", strokeWidth: 1, strokeDasharray: "4 4" }} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fill="url(#blueGrad)"
                  dot={false}
                  activeDot={{ r: 5, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
