"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, Cell,
} from "recharts";

interface DeptData { department: string; total: number; }

// One distinct color per department slot
const DEPT_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#6366f1", // indigo
  "#f97316", // orange
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { department, total } = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm min-w-40">
      <p className="font-semibold text-gray-800 mb-1">{department}</p>
      <p className="text-gray-500 text-xs">
        Entries logged:{" "}
        <span className="font-bold text-gray-800">
          {Number(total).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
        </span>
      </p>
    </div>
  );
}

export default function DepartmentConsumptionChart() {
  const [data, setData] = useState<DeptData[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/consumables/charts/department-consumption")
      .then(jsonOrThrow)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  }, []);

  // Dynamic height: 52px per bar, min 200
  const chartH = Math.max(200, data.length * 52);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
      {/* Top accent */}
      <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-400" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Analytics</p>
            <h2 className="text-lg font-bold text-gray-800 mt-0.5">Department Consumption</h2>
            {!loading && data.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {data.length} departments · All time
              </p>
            )}
          </div>
          <span className="text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-lg">
            All time
          </span>
        </div>

        <div style={{ height: chartH }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading data...</p>
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
                barCategoryGap="28%"
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                />
                <YAxis
                  dataKey="department"
                  type="category"
                  tick={{ fontSize: 11, fill: "#374151", fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="total" radius={[0, 6, 6, 0]} maxBarSize={28}
                  label={{
                    position: "right",
                    formatter: (label: unknown) => {
  const v = Number(label);

  return v >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : v.toFixed(0);
},
                    fontSize: 10,
                    fill: "#6b7280",
                  }}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Color legend */}
        {!loading && data.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-gray-100">
            {data.map((d, i) => (
              <div key={d.department} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                <span className="text-xs text-gray-600">{d.department}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
