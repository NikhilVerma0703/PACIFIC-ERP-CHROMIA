"use client";

import { useState, useEffect } from "react";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";

interface InventoryItem {
  id: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  minStock: number;
  status: "Healthy" | "Low";
}

type AlertStatus = "Out of Stock" | "Low";

function deriveAlertStatus(item: InventoryItem): AlertStatus | null {
  if (item.currentStock === 0) return "Out of Stock";
  if (item.minStock > 0 && item.currentStock <= item.minStock) return "Low";
  return null; // Healthy — don't show in alerts
}

function formatCategory(cat: string) {
  return cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props { filters: Filters; }

export default function LowStockAlerts({ filters }: Props) {
  const [items, setItems]     = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/consumables/inventory")
      .then((r) => r.json())
      .then((data: InventoryItem[]) => { setItems(data); setLoading(false); })
      .catch(console.error);
  }, []);

  // Only items that need attention
  const alertItems = items
    .map((item) => ({ ...item, alertStatus: deriveAlertStatus(item) }))
    .filter((item) => item.alertStatus !== null)
    .filter((item) =>
      !filters.search ||
      item.itemName.toLowerCase().includes(filters.search.toLowerCase())
    ) as (InventoryItem & { alertStatus: AlertStatus })[];

  const outOfStockItems = alertItems.filter((i) => i.alertStatus === "Out of Stock");
  const lowStockItems   = alertItems.filter((i) => i.alertStatus === "Low");

  // Skeleton cards for loading
  function SkeletonCard() {
    return (
      <div className="border border-gray-100 rounded-xl p-4 animate-pulse bg-gray-50">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-32" />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
          <div className="h-6 bg-gray-200 rounded-full w-20" />
        </div>
      </div>
    );
  }

  function AlertCard({ item }: { item: InventoryItem & { alertStatus: AlertStatus } }) {
    const isOut      = item.alertStatus === "Out of Stock";
    const shortfall  = item.minStock - item.currentStock;
    const pct        = item.minStock > 0 ? Math.min((item.currentStock / item.minStock) * 100, 100) : 0;

    return (
      <div className={`relative rounded-xl p-4 border transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
        isOut
          ? "bg-gray-50 border-gray-200"
          : "bg-amber-50/60 border-amber-200"
      }`}>
        {/* Left accent strip */}
        <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${
          isOut ? "bg-gray-400" : "bg-red-500"
        }`} />

        <div className="pl-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left: name + category + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-gray-900">{item.itemName}</h3>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                isOut
                  ? "bg-gray-200 text-gray-600"
                  : "bg-red-100 text-red-700"
              }`}>
                {item.alertStatus}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{formatCategory(item.category)}</p>

            {/* Progress bar — only for Low (not Out of Stock) */}
            {!isOut && item.minStock > 0 && (
              <div className="mt-2.5">
                <div className="h-1.5 w-full bg-red-100 rounded-full overflow-hidden max-w-[180px]">
                  <div
                    className="h-full bg-red-400 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {pct.toFixed(0)}% of minimum · need {shortfall > 0 ? `+${shortfall.toLocaleString("en-IN")}` : "0"} {item.unit}
                </p>
              </div>
            )}
            {isOut && (
              <p className="text-xs text-gray-400 mt-1">
                Needs immediate restocking
              </p>
            )}
          </div>

          {/* Right: stock values */}
          <div className={`text-right shrink-0 text-sm rounded-lg px-3 py-2 ${
            isOut ? "bg-white border border-gray-200" : "bg-white border border-amber-200"
          }`}>
            <div className="flex items-center justify-end gap-2 mb-1">
              <span className="text-gray-400 text-xs">Current</span>
              <span className={`font-bold tabular-nums text-base ${isOut ? "text-gray-500" : "text-red-600"}`}>
                {item.currentStock.toLocaleString("en-IN")}
                <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}</span>
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className="text-gray-400 text-xs">Minimum</span>
              <span className="font-semibold text-gray-700 tabular-nums">
                {item.minStock.toLocaleString("en-IN")}
                <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-red-500 to-orange-400" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Alerts</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Low Stock Alerts</h2>
          {!loading && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {outOfStockItems.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 border border-gray-300 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  {outOfStockItems.length} Out of Stock
                </span>
              )}
              {lowStockItems.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {lowStockItems.length} Below Minimum
                </span>
              )}
              {alertItems.length === 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  All stock healthy
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-sm text-gray-400 shrink-0 mt-1">Items requiring attention</span>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : alertItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <svg className="w-7 h-7 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-gray-800">All Stock Levels Healthy</p>
              <p className="text-sm text-gray-400 mt-0.5">No items require immediate attention.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Out of Stock section */}
            {outOfStockItems.length > 0 && (
              <div>
                {lowStockItems.length > 0 && (
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                    Out of Stock ({outOfStockItems.length})
                  </p>
                )}
                <div className="space-y-2">
                  {outOfStockItems.map((item) => (
                    <AlertCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Low Stock section */}
            {lowStockItems.length > 0 && (
              <div className={outOfStockItems.length > 0 ? "mt-4" : ""}>
                {outOfStockItems.length > 0 && (
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 mt-4">
                    Below Minimum ({lowStockItems.length})
                  </p>
                )}
                <div className="space-y-2">
                  {lowStockItems.map((item) => (
                    <AlertCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
