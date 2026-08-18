"use client";
import { useState, useEffect } from "react";
import { Empty } from "@/components/ui";

interface Design { id: string; name: string; seriesName: string | null; programs: { id: string; name: string }[]; }

const inp = "border border-gray-300 bg-white rounded-lg px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function DesignsMaster() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [form, setForm] = useState({ name: "", seriesName: "" });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => fetch("/api/robo/designs").then(r => r.json()).then((d: Design[]) => setDesigns(d));
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true); setError("");
    await fetch("/api/robo/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ name: "", seriesName: "" }); setSaving(false); load();
  };

  const del = async (d: Design) => {
    if (!confirm(`Delete design "${d.name}"?`)) return;
    setError("");
    const res = await fetch(`/api/robo/designs/${d.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      setError(data.error || "Could not delete this design.");
      return;
    }
    load();
  };

  return (
    <div className="max-w-2xl">
      <form onSubmit={add} className="mb-4 flex flex-wrap gap-2">
        <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Design name"
          className={`min-w-[10rem] flex-1 ${inp}`} required />
        <input value={form.seriesName} onChange={e => setForm(p => ({ ...p, seriesName: e.target.value }))} placeholder="Series (optional)"
          className={`w-36 ${inp}`} />
        <button type="submit" disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60">+ Add</button>
      </form>

      {error && <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="space-y-2">
        {designs.length === 0 && <Empty>No designs yet.</Empty>}
        {designs.map(d => (
          <div key={d.id} className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-stretch">
              <button onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                className="flex flex-1 items-center justify-between px-4 py-3 text-left">
                <div>
                  <span className="font-medium text-gray-800">{d.name}</span>
                  {d.seriesName && <span className="ml-2 text-xs text-gray-400">{d.seriesName}</span>}
                </div>
                <span className="text-xs text-gray-400">{d.programs.length} programs {expanded === d.id ? "▲" : "▼"}</span>
              </button>
              <button onClick={() => del(d)}
                className="border-l border-gray-100 px-4 text-xs font-medium text-red-400 hover:text-red-600 active:text-red-700">
                Delete
              </button>
            </div>
            {expanded === d.id && d.programs.length > 0 && (
              <div className="border-t border-gray-100 px-4 pb-3">
                {d.programs.map(p => <div key={p.id} className="border-b border-gray-50 py-1 text-sm text-gray-600 last:border-0">{p.name}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
