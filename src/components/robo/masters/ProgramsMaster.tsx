"use client";
import { useState, useEffect } from "react";

interface Design { id: string; name: string; }
interface Program { id: string; name: string; design: { name: string }; }

const inp = "border border-gray-300 bg-white rounded-lg px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function ProgramsMaster() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [form, setForm] = useState({ name: "", designId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => fetch("/api/robo/programs").then(r => r.json()).then((d: Program[]) => setPrograms(d));
  useEffect(() => {
    load();
    fetch("/api/robo/designs").then(r => r.json()).then((d: Design[]) => setDesigns(d));
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.designId) return;
    setSaving(true); setError("");
    await fetch("/api/robo/programs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ name: "", designId: "" }); setSaving(false); load();
  };

  const del = async (p: Program) => {
    if (!confirm(`Delete program "${p.name}"?`)) return;
    setError("");
    const res = await fetch(`/api/robo/programs/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      setError(data.error || "Could not delete this program.");
      return;
    }
    load();
  };

  return (
    <div className="max-w-2xl">
      <form onSubmit={add} className="mb-4 flex flex-wrap gap-2">
        <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Program name"
          className={`min-w-[10rem] flex-1 ${inp}`} required />
        <select value={form.designId} onChange={e => setForm(p => ({ ...p, designId: e.target.value }))}
          className={`w-40 ${inp}`} required>
          <option value="">Design...</option>
          {designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="submit" disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60">+ Add</button>
      </form>

      {error && <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            {["Program Name", "Design", ""].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{h}</th>)}
          </tr></thead>
          <tbody>
            {programs.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No programs yet.</td></tr>
            )}
            {programs.map(p => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-gray-500">{p.design.name}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => del(p)} className="text-xs font-medium text-red-400 hover:text-red-600 active:text-red-700">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
