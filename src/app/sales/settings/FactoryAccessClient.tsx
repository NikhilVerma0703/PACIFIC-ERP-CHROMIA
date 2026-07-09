"use client";
/**
 * FactoryAccessClient
 * Admin sets which factory (Quartz / Granite / Both) a Commercial or Accounts user can see.
 */
import { useState } from "react";

export type FactoryUser = {
  id:           string;
  name:         string | null;
  email:        string;
  salesRole:    string | null;
  salesFactory: string | null;
};

const FACTORY_OPTIONS = [
  { value: "",        label: "Both (All)",  color: "bg-slate-100 text-slate-700" },
  { value: "QUARTZ",  label: "Quartz Only", color: "bg-sky-100 text-sky-700"    },
  { value: "GRANITE", label: "Granite Only", color: "bg-stone-100 text-stone-700" },
];

export default function FactoryAccessClient({ users }: { users: FactoryUser[] }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [local,  setLocal]  = useState<Record<string, string>>(
    Object.fromEntries(users.map(u => [u.id, u.salesFactory ?? ""]))
  );
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  async function save(userId: string) {
    setSaving(userId);
    setMsg(null);
    const factory = local[userId] || null;
    const r = await fetch("/api/sales/settings/factory", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userId, factory }),
    });
    setSaving(null);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setMsg({ id: userId, ok: false, text: d.error ?? "Failed to save" });
    } else {
      setMsg({ id: userId, ok: true, text: "Saved" });
    }
  }

  if (users.length === 0) {
    return <p className="text-xs text-slate-400">No Commercial or Accounts users found.</p>;
  }

  return (
    <div className="space-y-3">
      {users.map(u => (
        <div key={u.id} className="flex items-center gap-3 flex-wrap py-2 border-b border-slate-50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{u.name ?? u.email}</p>
            <p className="text-[11px] text-slate-400">{u.email} · <span className="font-medium text-slate-500">{u.salesRole}</span></p>
          </div>
          <select
            value={local[u.id] ?? ""}
            onChange={e => setLocal(prev => ({ ...prev, [u.id]: e.target.value }))}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-300"
          >
            {FACTORY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => save(u.id)}
            disabled={saving === u.id}
            className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
          >
            {saving === u.id ? "Saving…" : "Save"}
          </button>
          {msg?.id === u.id && (
            <span className={`text-xs font-medium ${msg.ok ? "text-green-600" : "text-red-500"}`}>
              {msg.text}
            </span>
          )}
        </div>
      ))}
      <p className="text-[10px] text-slate-400 pt-1">
        Commercial and Accounts users set to a specific factory will only see orders and PIs for that factory.
        SP and RM are not restricted — they use the All / Quartz / Granite tabs to filter.
      </p>
    </div>
  );
}
