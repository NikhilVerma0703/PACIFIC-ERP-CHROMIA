"use client";

import { useState, useEffect } from "react";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";
import { useToast } from "@/components/consumables/toast-context";

interface InventoryItem {
  id: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  status: "Healthy" | "Low";
}

interface EditValues {
  currentStock: string;
  minStock: string;
  maxStock: string;
}

type DerivedStatus = "Healthy" | "Low" | "Out of Stock";

// Compute status client-side — more accurate than what the API returns
function deriveStatus(item: InventoryItem): DerivedStatus {
  if (item.currentStock === 0) return "Out of Stock";
  if (item.minStock > 0 && item.currentStock <= item.minStock) return "Low";
  return "Healthy";
}

const STATUS_STYLE: Record<DerivedStatus, string> = {
  "Healthy":      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "Low":          "bg-red-50 text-red-700 border border-red-200",
  "Out of Stock": "bg-gray-100 text-gray-600 border border-gray-300",
};

const STATUS_DOT: Record<DerivedStatus, string> = {
  "Healthy":      "bg-emerald-500",
  "Low":          "bg-red-500",
  "Out of Stock": "bg-gray-400",
};

const ROW_BG: Record<DerivedStatus, string> = {
  "Healthy":      "hover:bg-gray-50",
  "Low":          "bg-red-50/30 hover:bg-red-50/60",
  "Out of Stock": "bg-gray-50/50 hover:bg-gray-100/60",
};

const CATEGORY_MAP: Record<string, string> = {
  "Direct Materials": "DIRECT_MATERIAL",
  "Production Consumables": "PRODUCTION_CONSUMABLE",
  "Polishing Consumables": "POLISHING_CONSUMABLE",
};

const CATEGORY_BADGE: Record<string, string> = {
  DIRECT_MATERIAL:        "bg-indigo-50 text-indigo-700",
  PRODUCTION_CONSUMABLE:  "bg-blue-50 text-blue-700",
  POLISHING_CONSUMABLE:   "bg-pink-50 text-pink-700",
};

function formatCategory(cat: string) {
  return cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Display-only capitalize: "mask" → "Mask", "Mask N95" stays "Mask N95"
function displayName(name: string) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Skeleton row for loading state
function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[160, 140, 60, 80, 80, 80, 80, 80].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

interface Props { filters: Filters; }

export default function InventoryStockTable({ filters }: Props) {
  const { showToast } = useToast();
  const [items, setItems]       = useState<InventoryItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({ currentStock: "", minStock: "", maxStock: "" });
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    fetch("/api/consumables/inventory")
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false); })
      .catch(console.error);
  }, []);

  const filtered = items.filter((item) => {
    if (filters.search && !item.itemName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.category !== "All" && item.category !== CATEGORY_MAP[filters.category]) return false;
    return true;
  });

  // Status counts for header badges
  const healthyCount = filtered.filter((i) => deriveStatus(i) === "Healthy").length;
  const lowCount     = filtered.filter((i) => deriveStatus(i) === "Low").length;
  const outCount     = filtered.filter((i) => deriveStatus(i) === "Out of Stock").length;

  const startEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setEditValues({
      currentStock: String(item.currentStock),
      minStock: String(item.minStock),
      maxStock: String(item.maxStock ?? 0),
    });
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/consumables/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentStock: parseFloat(editValues.currentStock) || 0,
          minStock:     parseFloat(editValues.minStock)     || 0,
          maxStock:     parseFloat(editValues.maxStock)     || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setEditingId(null);
      showToast("Stock levels updated successfully!", "success");
    } catch (e) {
      console.error(e);
      showToast("Failed to save changes. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-24 bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 tabular-nums";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Accent bar */}
      <div className="h-1 w-full"
        style={{ background: lowCount + outCount > 0
          ? "linear-gradient(to right, #ef4444, #f97316)"
          : "linear-gradient(to right, #10b981, #34d399)" }} />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Inventory</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Inventory Stock</h2>
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
              {["Item Name", "Category", "Unit", "Current Stock", "Min Stock", "Max Stock", "Status", "Actions"].map((col) => (
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
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <span className="text-sm">No items match the current filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const isEditing = editingId === item.id;
                const status    = deriveStatus(item);
                return (
                  <tr
                    key={item.id}
                    className={`transition-colors duration-100 ${
                      isEditing ? "bg-blue-50 border-l-2 border-l-blue-400" : ROW_BG[status]
                    }`}
                  >
                    {/* Item Name */}
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-900">{displayName(item.itemName)}</span>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${CATEGORY_BADGE[item.category] ?? "bg-gray-100 text-gray-600"}`}>
                        {formatCategory(item.category)}
                      </span>
                    </td>

                    {/* Unit */}
                    <td className="px-4 py-3.5 text-gray-500 font-medium">{item.unit}</td>

                    {/* Current Stock */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input type="number" value={editValues.currentStock} min="0" step="0.01"
                          onChange={(e) => setEditValues((v) => ({ ...v, currentStock: e.target.value }))}
                          className={inputCls} />
                      ) : (
                        <span className={`font-bold tabular-nums ${
                          status === "Healthy" ? "text-emerald-700" :
                          status === "Low"     ? "text-red-600" : "text-gray-400"
                        }`}>
                          {item.currentStock.toLocaleString("en-IN")}
                        </span>
                      )}
                    </td>

                    {/* Min Stock */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input type="number" value={editValues.minStock} min="0" step="0.01"
                          onChange={(e) => setEditValues((v) => ({ ...v, minStock: e.target.value }))}
                          className={inputCls} />
                      ) : (
                        <span className="text-gray-600 tabular-nums">{item.minStock}</span>
                      )}
                    </td>

                    {/* Max Stock */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input type="number" value={editValues.maxStock} min="0" step="0.01"
                          onChange={(e) => setEditValues((v) => ({ ...v, maxStock: e.target.value }))}
                          className={inputCls} />
                      ) : (
                        <span className="text-gray-400 tabular-nums">{item.maxStock || "—"}</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[status]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
                        {status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(item.id)} disabled={saving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            {saving ? (
                              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={cancelEdit} disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all duration-150">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                      )}
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
