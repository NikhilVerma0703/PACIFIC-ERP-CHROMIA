"use client";
import { useState, useEffect } from "react";
import { Empty } from "@/components/ui";

interface Item { id: string; name: string; }

const inp = "border border-gray-300 bg-white rounded-lg px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/** Shared add/list/delete UI for the simple name-only masters (tools, liquids, powders). */
export function SimpleListMaster({ endpoint, emptyText }: { endpoint: "tools" | "liquids" | "powders"; emptyText: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => fetch(`/api/robo/${endpoint}`).then(r => r.json()).then((d: Item[]) => setItems(d));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await fetch(`/api/robo/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setName(""); setSaving(false); load();
  };

  const del = async (item: Item) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    setError("");
    const res = await fetch(`/api/robo/${endpoint}/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      setError(data.error || "Could not delete this record.");
      return;
    }
    load();
  };

  return (
    <div className="max-w-xl">
      <form onSubmit={add} className="mb-6 flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name"
          className={`flex-1 ${inp}`} required />
        <button type="submit" disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60">+ Add</button>
      </form>
      {error && <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {items.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          {items.map((item, i) => (
            <div key={item.id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <span className="text-sm font-medium text-gray-800">{item.name}</span>
              <button onClick={() => del(item)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
