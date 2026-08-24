"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, Cell, CartesianGrid,
} from "recharts";

interface StockItem { itemName: string; currentStock: number; minStock: number; }

interface ChartRow {
  name: string;
  fullName: string;
  Current: number;
  MinStock: number;
  isLow: boolean;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row: ChartRow = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm min-w-[180px]">
      <p className="font-semibold text-gray-800 mb-2 border-b pb-1.5">{row.fullName}</p>
      <div className="space-y-1.5">
        <div className="flex justify-between gap-8">
          <span className="text-gray-400 text-xs">Current Stock</span>
          <span className={`font-bold text-xs ${row.isLow ? "text-red-600" : "text-blue-600"}`}>
            {row.Current.toLocaleString("en-IN")}
          </span>
        </div>
        <div className="flex justify-between gap-8">
          <span className="text-gray-400 text-xs">Min Stock</span>
          <span className="font-semibold text-xs text-amber-500">
            {row.MinStock.toLocaleString("en-IN")}
          </span>
        </div>
        <div className="flex justify-between gap-8 pt-1 border-t border-gray-100">
          <span className="text-gray-400 text-xs">Status</span>
          <span className={`font-bold text-xs ${row.isLow ? "text-red-600" : "text-emerald-600"}`}>
            {row.isLow ? "⚠ LOW STOCK" : "✓ Healthy"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function InventoryHealthChart() {
  const [data, setData]       = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/consumables/charts/inventory-health")
      .then(jsonOrThrow)
      .then((items: StockItem[]) => {
        const rows: ChartRow[] = items.map((item) => ({
          fullName: item.itemName,
          name: item.itemName.length > 12 ? item.itemName.slice(0, 12) + "…" : item.itemName,
          Current:  item.currentStock,
          MinStock: item.minStock,
          isLow:    item.currentStock <= item.minStock && item.minStock > 0,
        }));
        setData(rows);
        setLoading(false);
      })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  }, []);

  const lowCount     = data.filter((d) => d.isLow).length;
  const healthyCount = data.length - lowCount;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
      {/* Accent bar — red if any low, green if all healthy */}
      <div
        className="h-1 w-full"
        style={{
          background: lowCount > 0
            ? "linear-gradient(to right, #ef4444, #f97316)"
            : "linear-gradient(to right, #10b981, #34d399)",
        }}
      />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Inventory</p>
            <h2 className="text-lg font-bold text-gray-800 mt-0.5">Stock Levels</h2>
            {!loading && data.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {healthyCount} Healthy
                </span>
                {lowCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {lowCount} Low
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-1.5 text-xs text-gray-500 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm inline-block bg-blue-500" />
              <span>Current</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm inline-block bg-amber-400" />
              <span>Minimum</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm inline-block bg-red-500" />
              <span>Low Stock</span>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-72">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: lowCount > 0 ? "#ef4444" : "#10b981", borderTopColor: "transparent" }} />
              <p className="text-xs text-gray-400">Loading data...</p>
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No stock data configured yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 5, right: 24, left: 10, bottom: 5 }}
                barCategoryGap="30%"
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 12, fill: "#374151", fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />

                {/* Current stock — blue (healthy) or red (low) */}
                <Bar dataKey="Current" name="Current Stock" radius={[0, 4, 4, 0]} maxBarSize={18} minPointSize={3}>
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.isLow ? "#ef4444" : "#3b82f6"} />
                  ))}
                </Bar>

                {/* Min stock — amber */}
                <Bar dataKey="MinStock" name="Min Stock" fill="#fbbf24" radius={[0, 4, 4, 0]} maxBarSize={18} minPointSize={3} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
