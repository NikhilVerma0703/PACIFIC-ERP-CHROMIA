"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";
import { useToast } from "@/components/consumables/toast-context";
import { useCanWrite } from "@/components/consumables/write-access";
import AddFilmRollModal from "./AddFilmRollModal";

interface FilmRoll {
  id: string;
  rollNumber: string;
  filmType: string;
  machine: string;
  initialWeight: number;
  layersUsed: number;
  weightPerLayer: number;
  consumedWeight: number;
  balanceWeight: number;
  isActive: boolean;
}

interface Props { filters: Filters; }

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[80, 120, 140, 70, 60, 80, 90, 160, 90, 110].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export default function FilmRollTrackingTable({ filters }: Props) {
  const { showToast }             = useToast();
  const [rolls, setRolls]         = useState<FilmRoll[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Presentation only - every mutating route re-checks with consumablesGate("WRITE").
  const canWrite = useCanWrite();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLayers, setEditLayers] = useState("");
  const [saving, setSaving]       = useState(false);

  const fetchRolls = () => {
    fetch("/api/consumables/film-rolls")
      .then(jsonOrThrow)
      .then((data) => { setRolls(data); setLoading(false); })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  };

  useEffect(() => { fetchRolls(); }, []);

  const getUsagePct = (consumed: number, initial: number) =>
    initial > 0 ? Math.min(100, (consumed / initial) * 100) : 0;

  const filtered = rolls.filter((roll) => {
    if (!filters.search) return true;
    const q = filters.search.toLowerCase();
    return (
      roll.rollNumber.toLowerCase().includes(q) ||
      roll.filmType.toLowerCase().includes(q) ||
      roll.machine.toLowerCase().includes(q)
    );
  });

  const activeCount   = filtered.filter((r) => r.isActive).length;
  const finishedCount = filtered.filter((r) => !r.isActive).length;
  const highUsageCount = filtered.filter((r) => getUsagePct(r.consumedWeight, r.initialWeight) >= 80).length;

  const startEdit  = (roll: FilmRoll) => { if (!canWrite) return; setEditingId(roll.id); setEditLayers(String(roll.layersUsed)); };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (roll: FilmRoll) => {
    const newLayers = parseInt(editLayers);
    if (isNaN(newLayers) || newLayers < 0) {
      showToast("Layers used must be a positive number.", "error"); return;
    }
    const maxLayers = Math.floor(roll.initialWeight / roll.weightPerLayer);
    if (newLayers > maxLayers) {
      showToast(`Cannot exceed max layers (${maxLayers}) for this roll.`, "warning"); return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/consumables/film-rolls/${roll.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layersUsed: newLayers }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setRolls((prev) => prev.map((r) => (r.id === roll.id ? updated : r)));
      setEditingId(null);
      showToast(`Roll ${roll.rollNumber} updated — ${newLayers} layers used.`, "success");
    } catch {
      showToast("Failed to update film roll.", "error");
    } finally {
      setSaving(false);
    }
  };

  const markInactive = async (roll: FilmRoll) => {
    try {
      const res = await fetch(`/api/consumables/film-rolls/${roll.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setRolls((prev) => prev.map((r) => (r.id === roll.id ? updated : r)));
      showToast(`Roll ${roll.rollNumber} marked as finished.`, "info");
    } catch {
      showToast("Failed to update roll status.", "error");
    }
  };

  const inputCls =
    "bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-sm w-20 " +
    "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400";

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
        {/* Accent bar — amber/orange for film tracking, distinct from all other sections */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-orange-400" />

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tracking</p>
            <h2 className="text-xl font-bold text-gray-800 mt-0.5">Film Roll Tracking</h2>
            {!loading && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {activeCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    {activeCount} Active
                  </span>
                )}
                {finishedCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                    {finishedCount} Finished
                  </span>
                )}
                {highUsageCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {highUsageCount} High Usage
                  </span>
                )}
              </div>
            )}
          </div>
          {canWrite && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors shrink-0 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Film Roll
          </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {["Roll Number", "Film Type", "Machine", "Initial Weight", "Layers Used", "Weight / Layer", "Consumed Weight", "Usage Progress", "Balance Weight", "Actions"].map((col) => (
                  <th key={col} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                      </svg>
                      <span className="text-sm">
                        {rolls.length === 0 ? "No film rolls yet. Add one above." : "No rolls match the search."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((roll) => {
                  const isEditing = editingId === roll.id;
                  const pct       = getUsagePct(roll.consumedWeight, roll.initialWeight);
                  const isHigh    = pct >= 80;
                  const isMid     = pct >= 60 && pct < 80;

                  return (
                    <tr key={roll.id}
                      className={`transition-colors duration-100 ${
                        isEditing     ? "bg-blue-50 border-l-2 border-l-blue-400" :
                        !roll.isActive ? "bg-gray-50/60" :
                                         "hover:bg-amber-50/20"
                      }`}>

                      {/* Roll Number */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">{roll.rollNumber}</span>
                          {!roll.isActive && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-medium rounded-md border border-gray-200">
                              Finished
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Film Type */}
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium rounded-md">
                          {roll.filmType}
                        </span>
                      </td>

                      {/* Machine */}
                      <td className="px-4 py-3.5">
                        <span className="text-gray-600 font-medium">{roll.machine}</span>
                      </td>

                      {/* Initial Weight */}
                      <td className="px-4 py-3.5">
                        <span className="tabular-nums text-gray-700 font-medium">{roll.initialWeight} KG</span>
                      </td>

                      {/* Layers Used */}
                      <td className="px-4 py-3.5">
                        {isEditing ? (
                          <input
                            type="number" value={editLayers} min="0"
                            onChange={(e) => setEditLayers(e.target.value)}
                            className={inputCls}
                          />
                        ) : (
                          <span className="tabular-nums font-bold text-gray-800">{roll.layersUsed}</span>
                        )}
                      </td>

                      {/* Weight per Layer */}
                      <td className="px-4 py-3.5">
                        <span className="tabular-nums text-gray-500">{roll.weightPerLayer} KG</span>
                      </td>

                      {/* Consumed Weight */}
                      <td className="px-4 py-3.5">
                        <span className="tabular-nums font-bold text-amber-600">
                          {roll.consumedWeight.toFixed(2)} KG
                        </span>
                      </td>

                      {/* Usage Progress */}
                      <td className="px-4 py-3.5 min-w-40">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                            <div
                              className={`h-2.5 rounded-full transition-all ${
                                isHigh ? "bg-red-500" : isMid ? "bg-amber-400" : "bg-blue-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold tabular-nums shrink-0 w-10 text-right ${
                            isHigh ? "text-red-600" : isMid ? "text-amber-600" : "text-gray-500"
                          }`}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>

                      {/* Balance Weight */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${
                          isHigh
                            ? "bg-red-50 text-red-700 border-red-200"
                            : isMid
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-green-50 text-green-700 border-green-200"
                        }`}>
                          {roll.balanceWeight.toFixed(2)} KG
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        {!canWrite ? (
                          <span className="text-gray-300">&mdash;</span>
                        ) : isEditing ? (
                          <div className="flex gap-2">
                            <button onClick={() => saveEdit(roll)} disabled={saving}
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
                          <div className="flex gap-2 flex-wrap">
                            <button onClick={() => startEdit(roll)} disabled={!roll.isActive}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                              </svg>
                              Edit Layers
                            </button>
                            {roll.isActive && (
                              <button onClick={() => markInactive(roll)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all duration-150">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                                </svg>
                                Finish
                              </button>
                            )}
                          </div>
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

      {canWrite && (
        <AddFilmRollModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => { setIsModalOpen(false); fetchRolls(); }}
        />
      )}
    </>
  );
}
