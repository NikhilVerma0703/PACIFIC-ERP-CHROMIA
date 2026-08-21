"use client";

import { useState, useEffect } from "react";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";
import { useToast } from "@/components/consumables/toast-context";
import { useCanWrite } from "@/components/consumables/write-access";

interface DirectMaterial {
  id: string;
  name: string;
  variant: string | null;
  unit: string;
  dailyConsumption: number;
  status: "ACTIVE" | "INACTIVE";
}

interface EditValues {
  name: string;
  variant: string;
  unit: string;
  dailyConsumption: string;
  status: "ACTIVE" | "INACTIVE";
}

interface Props { filters: Filters; }

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[140, 180, 60, 100, 80, 80].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export default function DirectMaterialsTable({ filters }: Props) {
  const { showToast } = useToast();
  // Presentation only - every mutating route re-checks with consumablesGate("WRITE").
  const canWrite = useCanWrite();
  const [materials, setMaterials] = useState<DirectMaterial[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({
    name: "", variant: "", unit: "", dailyConsumption: "", status: "ACTIVE",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/consumables/direct-materials")
      .then((r) => r.json())
      .then((d) => { setMaterials(d); setLoading(false); })
      .catch(console.error);
  }, []);

  const filtered = materials.filter((m) => {
    if (
      filters.search &&
      !m.name.toLowerCase().includes(filters.search.toLowerCase()) &&
      !(m.variant ?? "").toLowerCase().includes(filters.search.toLowerCase())
    ) return false;
    return true;
  });

  const activeCount   = filtered.filter((m) => m.status === "ACTIVE").length;
  const inactiveCount = filtered.filter((m) => m.status === "INACTIVE").length;

  const startEdit = (m: DirectMaterial) => {
    if (!canWrite) return;
    setEditingId(m.id);
    setEditValues({
      name: m.name,
      variant: m.variant ?? "",
      unit: m.unit,
      dailyConsumption: String(m.dailyConsumption),
      status: m.status,
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
      const res = await fetch(`/api/consumables/direct-materials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editValues.name,
          variant: editValues.variant || null,
          unit: editValues.unit,
          dailyConsumption: parseFloat(editValues.dailyConsumption) || 0,
          status: editValues.status,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setMaterials((prev) => prev.map((m) => (m.id === id ? updated : m)));
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
      {/* Accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-blue-400" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Materials</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Direct Materials</h2>
          {!loading && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {activeCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {activeCount} Active
                </span>
              )}
              {inactiveCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  {inactiveCount} Inactive
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-sm font-medium text-gray-400 shrink-0">
          {loading ? "Loading..." : `${filtered.length} of ${materials.length} items`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {["Material", "Variant", "Unit", "Daily Consumption", "Status", "Actions"].map((col) => (
                <th key={col} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <span className="text-sm">No materials match the current filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((material) => {
                const isEditing  = editingId === material.id;
                const isInactive = material.status === "INACTIVE";

                return (
                  <tr
                    key={material.id}
                    className={`transition-colors duration-100 ${
                      isEditing
                        ? "bg-blue-50 border-l-2 border-l-blue-400"
                        : isInactive
                        ? "bg-gray-50/60 hover:bg-gray-100/60"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    {/* Name */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input
                          value={editValues.name}
                          onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                          className={inputCls}
                          style={{ minWidth: 120 }}
                          placeholder="Material name"
                        />
                      ) : (
                        <span className={`font-semibold ${isInactive ? "text-gray-400" : "text-gray-900"}`}>
                          {material.name}
                        </span>
                      )}
                    </td>

                    {/* Variant */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input
                          value={editValues.variant}
                          onChange={(e) => setEditValues((v) => ({ ...v, variant: e.target.value }))}
                          placeholder="—"
                          className={inputCls}
                          style={{ minWidth: 140 }}
                        />
                      ) : (
                        <span className={`${isInactive ? "text-gray-400" : "text-gray-700"}`}>
                          {material.variant || <span className="text-gray-300">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Unit */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input
                          value={editValues.unit}
                          onChange={(e) => setEditValues((v) => ({ ...v, unit: e.target.value }))}
                          className={inputCls}
                          style={{ minWidth: 70 }}
                          placeholder="KG"
                        />
                      ) : (
                        <span className="text-gray-500 font-medium">{material.unit}</span>
                      )}
                    </td>

                    {/* Daily Consumption */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValues.dailyConsumption}
                          onChange={(e) => setEditValues((v) => ({ ...v, dailyConsumption: e.target.value }))}
                          min="0"
                          step="0.01"
                          className={inputCls}
                          style={{ minWidth: 90 }}
                        />
                      ) : (
                        <span className={`font-semibold tabular-nums ${
                          isInactive ? "text-gray-400" :
                          material.dailyConsumption === 0 ? "text-gray-400" : "text-gray-800"
                        }`}>
                          {material.dailyConsumption}
                          <span className="text-xs font-normal text-gray-400 ml-1">
                            {material.unit}/day
                          </span>
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      {isEditing ? (
                        <div className="relative">
                          <select
                            value={editValues.status}
                            onChange={(e) => setEditValues((v) => ({ ...v, status: e.target.value as "ACTIVE" | "INACTIVE" }))}
                            className="appearance-none bg-white border border-blue-200 rounded-lg pl-3 pr-8 py-1.5 text-sm
                              focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 cursor-pointer"
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </select>
                          <svg className="pointer-events-none absolute right-2 top-2.5 w-4 h-4 text-gray-400"
                            fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          material.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-gray-100 text-gray-500 border border-gray-200"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            material.status === "ACTIVE" ? "bg-emerald-500" : "bg-gray-400"
                          }`} />
                          {material.status === "ACTIVE" ? "Active" : "Inactive"}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      {!canWrite ? (
                          <span className="text-gray-300">&mdash;</span>
                        ) : isEditing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(material.id)}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
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
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(material)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all duration-150"
                        >
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
