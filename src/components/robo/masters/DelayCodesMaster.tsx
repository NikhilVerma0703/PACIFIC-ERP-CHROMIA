"use client";
import { useState, useEffect } from "react";

interface DelayCode {
  id: string; code: string; description: string;
  category: string; isRobotSpecific: boolean;
}

// Matches the official DELAYS LIST sheet exactly
const CATEGORY_CONFIG: {
  key: string; letter: string; title: string; codeHeader: string;
  color: string; headerBg: string; isRobotSpecific: boolean;
}[] = [
  { key: "ROYMIX",      letter: "A", title: "ROY MIXER DELAYS",  codeHeader: "CODE",                        color: "bg-emerald-100 text-emerald-700", headerBg: "bg-emerald-600", isRobotSpecific: false },
  { key: "LINE",        letter: "B", title: "LINE STOPPAGE",     codeHeader: "CODE",                        color: "bg-slate-100 text-slate-700",     headerBg: "bg-slate-600",   isRobotSpecific: false },
  { key: "DISTRIBUTOR", letter: "C", title: "DISTRIBUTOR",       codeHeader: "CODE",                        color: "bg-purple-100 text-purple-700",   headerBg: "bg-purple-600",  isRobotSpecific: false },
  { key: "LINE_START",  letter: "D", title: "LINE START",        codeHeader: "CODE",                        color: "bg-teal-100 text-teal-700",       headerBg: "bg-teal-600",    isRobotSpecific: false },
  { key: "PRESS",       letter: "E", title: "PRESS DELAY",       codeHeader: "CODE",                        color: "bg-rose-100 text-rose-700",       headerBg: "bg-rose-600",    isRobotSpecific: false },
  { key: "MAINTENANCE", letter: "F", title: "MAINTENANCE DELAY", codeHeader: "ROBO NOS - CODE (e.g. R1M1)", color: "bg-orange-100 text-orange-700",   headerBg: "bg-orange-600",  isRobotSpecific: true },
  { key: "ROBOT",       letter: "G", title: "ROBOT DELAYS",      codeHeader: "ROBO NOS - CODE (e.g. R1C1)", color: "bg-blue-100 text-blue-700",       headerBg: "bg-blue-600",    isRobotSpecific: true },
  { key: "GENERAL",     letter: "H", title: "GENERAL DELAYS",    codeHeader: "ROBO NOS - CODE (e.g. R1G1)", color: "bg-gray-100 text-gray-700",       headerBg: "bg-gray-600",    isRobotSpecific: true },
  { key: "POWERCUT",    letter: "J", title: "POWERCUT",          codeHeader: "CODE",                        color: "bg-red-100 text-red-700",         headerBg: "bg-red-600",     isRobotSpecific: false },
];

// Natural sort: RM1, RM2, ... RM10, RM11 (not RM1, RM10, RM11, RM2)
function naturalSort(a: DelayCode, b: DelayCode) {
  const re = /^([A-Za-z]+)(\d+)$/;
  const ma = a.code.match(re);
  const mb = b.code.match(re);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
    return parseInt(ma[2]) - parseInt(mb[2]);
  }
  return a.code.localeCompare(b.code);
}

const inp = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function DelayCodesMaster() {
  const [codes, setCodes] = useState<DelayCode[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-category add form state
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newRobotSpecific, setNewRobotSpecific] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const load = () => {
    fetch("/api/robo/delay-codes").then(r => r.json()).then((data: DelayCode[]) => {
      setCodes(data);
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  // Group by category
  const grouped: Record<string, DelayCode[]> = {};
  for (const c of codes) {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  }
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort(naturalSort);
  }

  const startAdd = (category: string) => {
    const cfg = CATEGORY_CONFIG.find(c => c.key === category);
    setAddingCategory(category);
    setNewCode("");
    setNewDesc("");
    setNewRobotSpecific(cfg?.isRobotSpecific ?? false);
    setError("");
  };

  const cancelAdd = () => {
    setAddingCategory(null);
    setNewCode("");
    setNewDesc("");
    setError("");
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newDesc.trim() || !addingCategory) return;
    setSaving(true); setError("");
    const res = await fetch("/api/robo/delay-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: newCode.trim(),
        description: newDesc.trim(),
        category: addingCategory,
        isRobotSpecific: newRobotSpecific,
      }),
    });
    if (!res.ok) {
      const data: { error?: string } = await res.json();
      setError(data.error || "Failed to add");
    } else {
      cancelAdd();
      load();
    }
    setSaving(false);
  };

  const del = async (c: DelayCode) => {
    if (!confirm(`Delete delay code ${c.code} — ${c.description}?`)) return;
    setDeleteError("");
    const res = await fetch(`/api/robo/delay-codes/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      setDeleteError(data.error || "Could not delete this delay code.");
      return;
    }
    load();
  };

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-brand" />
    </div>
  );

  return (
    <div className="max-w-4xl">
      <p className="mb-4 text-sm text-gray-500">
        {codes.length} delay codes across {CATEGORY_CONFIG.filter(c => grouped[c.key]?.length).length} categories
      </p>

      {deleteError && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{deleteError}</div>
      )}

      <div className="space-y-5">
        {CATEGORY_CONFIG.map(cfg => {
          const items = grouped[cfg.key] || [];
          // Show section even if empty (allows adding)
          return (
            <div key={cfg.key} className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              {/* Section header — matches sheet style */}
              <div className={`${cfg.headerBg} flex items-center gap-3 px-5 py-3 text-white`}>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-lg font-bold">
                  {cfg.letter}
                </span>
                <div className="flex-1">
                  <h2 className="text-sm font-bold tracking-wide">{cfg.title}</h2>
                </div>
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs">
                  {items.length} {items.length === 1 ? "code" : "codes"}
                </span>
                <button
                  onClick={() => startAdd(cfg.key)}
                  className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium transition hover:bg-white/30"
                >
                  + Add
                </button>
              </div>

              {/* Add form for this category */}
              {addingCategory === cfg.key && (
                <form onSubmit={submitAdd} className="border-b border-brand/10 bg-brand/5 px-5 py-3">
                  <div className="flex items-end gap-2">
                    <div className="w-24">
                      <label className="mb-1 block text-xs text-gray-600">Code</label>
                      <input value={newCode} onChange={e => setNewCode(e.target.value)}
                        placeholder={`e.g. ${items.length > 0 ? items[items.length - 1].code.replace(/\d+$/, (n) => String(Number(n) + 1)) : cfg.key[0] + "1"}`}
                        className={inp}
                        required autoFocus />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600">Description</label>
                      <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                        placeholder="Describe the delay..."
                        className={inp}
                        required />
                    </div>
                    {cfg.isRobotSpecific && (
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-600">
                        <input type="checkbox" checked={newRobotSpecific} onChange={e => setNewRobotSpecific(e.target.checked)}
                          className="rounded border-gray-300" />
                        Robot-specific
                      </label>
                    )}
                    <button type="submit" disabled={saving}
                      className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60">
                      {saving ? "..." : "Add"}
                    </button>
                    <button type="button" onClick={cancelAdd}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                      Cancel
                    </button>
                  </div>
                  {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
                </form>
              )}

              {items.length === 0 ? (
                <p className="px-5 py-4 text-sm text-gray-400">No delay codes yet. Click &quot;+ Add&quot; to create one.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="w-12 px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500">#</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500">Description</th>
                      <th className="w-40 px-4 py-2 text-left text-xs font-semibold uppercase text-gray-500">{cfg.codeHeader}</th>
                      <th className="w-24 px-4 py-2 text-right text-xs font-semibold uppercase text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c, i) => (
                      <tr key={c.id} className="border-t border-gray-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2.5 text-gray-700">{c.description}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded px-2.5 py-0.5 font-mono text-xs font-bold ${cfg.color}`}>
                            {c.code}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => del(c)}
                            className="text-xs font-medium text-red-400 hover:text-red-600 active:text-red-700">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
