"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, Cell,
} from "recharts";

interface TopItem {
  itemName: string;
  total: number;
  unit: string;
}

const COLORS = [
  "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd",
  "#bfdbfe", "#1d4ed8", "#1e40af", "#1e3a8a",
  "#172554", "#dbeafe",
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: TopItem = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 text-sm min-w-40">
      <p className="font-bold text-gray-900 mb-2 pb-2 border-b border-gray-100">{d.itemName}</p>
      <div className="flex justify-between gap-6 text-xs">
        <span className="text-gray-400">Total Consumed</span>
        <span className="font-bold text-blue-600">
          {d.total.toLocaleString("en-IN")} {d.unit}
        </span>
      </div>
    </div>
  );
}

export default function TopConsumedItemsChart() {
  const [data, setData]       = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/consumables/charts/top-items")
      .then((r) => r.json())
      .then((d: TopItem[]) => { setData(d); setLoading(false); })
      .catch(console.error);
  }, []);

  const chartData = data.map((item) => ({
    ...item,
    label: item.itemName.length > 18 ? item.itemName.slice(0, 18) + "…" : item.itemName,
  }));

  const topItem = data[0];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-blue-600 to-blue-400" />

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Analytics</p>
            <h2 className="text-xl font-bold text-gray-800 mt-0.5">Top 10 Most Consumed</h2>
            <p className="text-sm text-gray-400 mt-1">By total quantity — all time</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            Procurement
          </span>
        </div>

        {/* Highest item callout */}
        {!loading && topItem && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 mb-4 flex items-center justify-between">
            <span className="text-xs font-medium text-blue-700">
              🏆 Highest: <span className="font-bold">{topItem.itemName}</span>
            </span>
            <span className="text-xs font-bold text-blue-800">
              {topItem.total >= 1000
                ? `${(topItem.total / 1000).toFixed(1)}k`
                : topItem.total} {topItem.unit}
            </span>
          </div>
        )}

        {/* Chart — same internals as the original working version */}
        <div className="h-80">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading data...</p>
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No consumption data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 80, left: 130, bottom: 5 }}
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 13, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
                  }
                />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  width={130}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
                <Bar
                  dataKey="total"
                  radius={[0, 6, 6, 0]}
                  maxBarSize={24}
                  label={{
                    position: "right",
                    fontSize: 13,
                    fill: "#6b7280",
                  formatter: (label: unknown) => {
                           const v = Number(label);

                            return v >= 1000
                           ? `${(v / 1000).toFixed(1)}k`
                           : v.toFixed(0);
                     },
                  }}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
