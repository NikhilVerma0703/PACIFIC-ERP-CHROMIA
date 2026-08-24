"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";
import { useToast } from "@/components/consumables/toast-context";
import { useCanWrite } from "@/components/consumables/write-access";

interface PolishingConsumable {
  id: string;
  name: string;
  unit: string;
  dailyConsumption: number;
  currentStock: number;
  minStock: number;
  department: { id: string; name: string };
}

interface EditValues {
  name: string;
  unit: string;
  dailyConsumption: string;
  currentStock: string;
  minStock: string;
}

type StockStatus = "Healthy" | "Low" | "Out of Stock";

function deriveStatus(item: PolishingConsumable): StockStatus {
  if (item.currentStock === 0) return "Out of Stock";
  if (item.minStock > 0 && item.currentStock <= item.minStock) return "Low";
  return "Healthy";
}

function daysRemaining(item: PolishingConsumable): number | null {
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

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[140, 80, 60, 110, 90, 80, 90, 80].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

interface Props { filters: Filters; }

export default function PolishingConsumablesTable({ filters }: Props) {
  const { showToast }             = useToast();
  const [items, setItems]         = useState<PolishingConsumable[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Presentation only - every mutating route re-checks with consumablesGate("WRITE").
  const canWrite = useCanWrite();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({
    name: "", unit: "", dailyConsumption: "", currentStock: "", minStock: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/consumables/polishing-consumables")
      .then(jsonOrThrow)
      .then((d) => { setItems(d); setLoading(false); })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  }, []);

  const filtered = items.filter((item) => {
    if (filters.search && !item.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.department !== "All" && item.department.name !== filters.department) return false;
    return true;
  });

  const healthyCount = filtered.filter((i) => deriveStatus(i) === "Healthy").length;
  const lowCount     = filtered.filter((i) => deriveStatus(i) === "Low").length;
  const outCount     = filtered.filter((i) => deriveStatus(i) === "Out of Stock").length;

  const startEdit = (item: PolishingConsumable) => {
    if (!canWrite) return;
    setEditingId(item.id);
    setEditValues({
      name:             item.name,
      unit:             item.unit,
      dailyConsumption: String(item.dailyConsumption),
      currentStock:     String(item.currentStock),
      minStock:         String(item.minStock),
    });
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: string) => {
    if (!editValues.name || !editValues.unit) {
      showToast("Name and unit are required.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/consumables/polishing-consumables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             editValues.name,
          unit:             editValues.unit,
          dailyConsumption: parseFloat(editValues.dailyConsumption) || 0,
          currentStock:     parseFloat(editValues.currentStock)     || 0,
          minStock:         parseFloat(editValues.minStock)         || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setEditingId(null);
      showToast(`"${editValues.name}" updated successfully!`, "success");
    } catch {
      showToast("Failed to save changes.", "error");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-sm w-full " +
    "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
      {/* Accent bar — pink/rose for polishing */}
      <div className="h-1 w-full"
        style={{ background: lowCount + outCount > 0
          ? "linear-gradient(to right, #ef4444, #f97316)"
          : "linear-gradient(to right, #ec4899, #f43f5e)" }} />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Consumables</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Polishing Consumables</h2>
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
              {["Item", "Department", "Unit", "Daily Consumption", "Current Stock", "Min Stock", "Status", "Actions"].map((col) => (
                <th key={col} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span className="text-sm">No items match the current filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const isEditing = editingId === item.id;
                const status    = deriveStatus(item);
                const days      = daysRemaining(item);

                return (
                  <tr key={item.id}
                    className={`transition-colors duration-100 ${
                      isEditing
                        ? "bg-blue-50 border-l-2 border-l-blue-400"
                        : status === "Out of Stock" ? "bg-gray-50/50 hover:bg-gray-100/60"
                        : status === "Low"          ? "bg-red-50/30 hover:bg-red-50/60"
                                                    : "hover:bg-gray-50"
                    }`}>

                    {/* Name */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input value={editValues.name}
                          onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                          className={inputCls} style={{ minWidth: 130 }} placeholder="Item name" />
                      ) : (
                        <span className="font-semibold text-gray-900">{item.name}</span>
                      )}
                    </td>

                    {/* Department */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-pink-50 text-pink-700">
                        {item.department.name}
                      </span>
                    </td>

                    {/* Unit */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input value={editValues.unit}
                          onChange={(e) => setEditValues((v) => ({ ...v, unit: e.target.value }))}
                          className={inputCls} style={{ minWidth: 70 }} placeholder="PCS" />
                      ) : (
                        <span className="text-gray-500 font-medium">{item.unit}</span>
                      )}
                    </td>

                    {/* Daily Consumption */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input type="number" value={editValues.dailyConsumption} min="0" step="0.01"
                          onChange={(e) => setEditValues((v) => ({ ...v, dailyConsumption: e.target.value }))}
                          className={inputCls} style={{ minWidth: 90 }} />
                      ) : (
                        <span className="font-semibold text-gray-700 tabular-nums">
                          {item.dailyConsumption}
                          <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}/day</span>
                        </span>
                      )}
                    </td>

                    {/* Current Stock */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input type="number" value={editValues.currentStock} min="0" step="0.01"
                          onChange={(e) => setEditValues((v) => ({ ...v, currentStock: e.target.value }))}
                          className={inputCls} style={{ minWidth: 90 }} />
                      ) : (
                        <div>
                          <span className={`font-bold tabular-nums ${
                            status === "Healthy"      ? "text-emerald-700" :
                            status === "Low"          ? "text-red-600"     : "text-gray-400"
                          }`}>
                            {item.currentStock.toLocaleString("en-IN")}
                          </span>
                          {days !== null && (
                            <p className={`text-xs mt-0.5 ${status !== "Healthy" ? "text-red-400" : "text-gray-400"}`}>
                              ~{days}d left
                            </p>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Min Stock */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input type="number" value={editValues.minStock} min="0" step="0.01"
                          onChange={(e) => setEditValues((v) => ({ ...v, minStock: e.target.value }))}
                          className={inputCls} style={{ minWidth: 80 }} />
                      ) : (
                        <span className="text-gray-600 tabular-nums">{item.minStock}</span>
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
                      {!canWrite ? (
                          <span className="text-gray-300">&mdash;</span>
                        ) : isEditing ? (
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(item.id)} disabled={saving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            {saving ? (
                              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                              </svg>
                            )}
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={cancelEdit} disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all duration-150">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
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
