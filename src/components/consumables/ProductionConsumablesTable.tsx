"use client";

import { useState, useEffect } from "react";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";

interface ProductionConsumable {
  id: string;
  name: string;
  unit: string;
  dailyConsumption: number;
  currentStock: number;
  minStock: number;
  department: { id: string; name: string };
}

type StockStatus = "Healthy" | "Low" | "Out of Stock";

function deriveStatus(item: ProductionConsumable): StockStatus {
  if (item.currentStock === 0) return "Out of Stock";
  if (item.minStock > 0 && item.currentStock <= item.minStock) return "Low";
  return "Healthy";
}

// Days of stock remaining based on daily consumption
function daysRemaining(item: ProductionConsumable): number | null {
  if (item.dailyConsumption <= 0) return null;
  return Math.floor(item.currentStock / item.dailyConsumption);
}

const STATUS_STYLE: Record<StockStatus, string> = {
  "Healthy":      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "Low":          "bg-red-50 text-red-700 border border-red-200",
  "Out of Stock": "bg-gray-100 text-gray-600 border border-gray-300",
};
const STATUS_DOT: Record<StockStatus, string> = {
  "Healthy":      "bg-emerald-500",
  "Low":          "bg-red-500",
  "Out of Stock": "bg-gray-400",
};

const DEPT_COLORS: Record<string, string> = {
  Production: "bg-blue-50 text-blue-700",
  Mixer:      "bg-violet-50 text-violet-700",
  Polishing:  "bg-pink-50 text-pink-700",
  Press:      "bg-amber-50 text-amber-700",
  "LB Line":  "bg-cyan-50 text-cyan-700",
  Distributor:"bg-orange-50 text-orange-700",
};

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[140, 100, 60, 100, 90, 80, 90].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

interface Props { filters: Filters; }

export default function ProductionConsumablesTable({ filters }: Props) {
  const [items, setItems]     = useState<ProductionConsumable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/consumables/production-consumables")
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false); })
      .catch(console.error);
  }, []);

  const filtered = items.filter((item) => {
    if (filters.search && !item.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.department !== "All" && item.department.name !== filters.department) return false;
    return true;
  });

  const healthyCount = filtered.filter((i) => deriveStatus(i) === "Healthy").length;
  const lowCount     = filtered.filter((i) => deriveStatus(i) === "Low").length;
  const outCount     = filtered.filter((i) => deriveStatus(i) === "Out of Stock").length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Accent bar — purple gradient */}
      <div className="h-1 w-full"
        style={{ background: lowCount + outCount > 0
          ? "linear-gradient(to right, #ef4444, #f97316)"
          : "linear-gradient(to right, #8b5cf6, #6366f1)" }} />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Consumables</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Production Consumables</h2>
          {!loading && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {healthyCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {healthyCount} Healthy
                </span>
              )}
              {lowCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {lowCount} Low
                </span>
              )}
              {outCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 border border-gray-300 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  {outCount} Out of Stock
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-sm font-medium text-gray-400 shrink-0">
          {loading ? "Loading..." : `${filtered.length} of ${items.length} items`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {["Item", "Department", "Unit", "Daily Consumption", "Current Stock", "Min Stock", "Status"].map((col) => (
                <th key={col} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm">No items match the current filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const status = deriveStatus(item);
                const days   = daysRemaining(item);
                const isLow  = status === "Low" || status === "Out of Stock";

                return (
                  <tr key={item.id}
                    className={`transition-colors duration-100 ${
                      status === "Out of Stock" ? "bg-gray-50/50 hover:bg-gray-100/60" :
                      status === "Low"          ? "bg-red-50/30 hover:bg-red-50/60" :
                                                  "hover:bg-gray-50"
                    }`}>

                    {/* Item name */}
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-900">{item.name}</span>
                    </td>

                    {/* Department */}
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${
                        DEPT_COLORS[item.department.name] ?? "bg-gray-100 text-gray-600"
                      }`}>
                        {item.department.name}
                      </span>
                    </td>

                    {/* Unit */}
                    <td className="px-4 py-3.5 text-gray-500 font-medium">{item.unit}</td>

                    {/* Daily Consumption */}
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-700 tabular-nums">
                        {item.dailyConsumption}
                        <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}/day</span>
                      </span>
                    </td>

                    {/* Current Stock */}
                    <td className="px-4 py-3.5">
                      <div>
                        <span className={`font-bold tabular-nums ${
                          status === "Healthy"      ? "text-emerald-700" :
                          status === "Low"          ? "text-red-600" :
                                                      "text-gray-400"
                        }`}>
                          {item.currentStock.toLocaleString("en-IN")}
                        </span>
                        {days !== null && (
                          <p className={`text-xs mt-0.5 ${isLow ? "text-red-400" : "text-gray-400"}`}>
                            ~{days}d left
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Min Stock */}
                    <td className="px-4 py-3.5 text-gray-600 tabular-nums">{item.minStock}</td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[status]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
