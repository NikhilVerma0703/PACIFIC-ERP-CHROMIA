"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson, patchJson } from "@/lib/fab/postJson";

interface Worker { id: string; name: string; active: boolean }

export default function FabPeoplePage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/fab/workers?all=1");
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? `Could not load (error ${res.status}).`);
      return;
    }
    setWorkers(Array.isArray(data) ? data : []);
    setError(null);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    setSaving(true); setError(null);
    const r = await postJson("/api/fab/workers", { name });
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    setName("");
    await load();
  }

  async function setActive(id: string, active: boolean) {
    const r = await patchJson("/api/fab/workers", { id, active });
    if (!r.ok) { setError(r.error); return; }
    await load();
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900">People</h1>
      <p className="text-sm text-gray-500 mt-1">
        Names on the operator dropdown. The floor uses one login; these are who
        actually started the Cutting / Polishing / … session.
      </p>

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <form className="mt-6 flex gap-2" onSubmit={e => { e.preventDefault(); add(); }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New operator name"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <button type="submit" disabled={!name.trim() || saving}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
          {saving ? "Adding…" : "Add"}
        </button>
      </form>

      <ul className="mt-6 bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {workers.length === 0 && (
          <li className="px-4 py-8 text-sm text-gray-400 text-center">No names yet.</li>
        )}
        {workers.map(w => (
          <li key={w.id} className="flex items-center justify-between px-4 py-3">
            <span className={`text-sm ${w.active ? "text-gray-900" : "text-gray-400 line-through"}`}>{w.name}</span>
            <button
              type="button"
              onClick={() => setActive(w.id, !w.active)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              {w.active ? "Deactivate" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
