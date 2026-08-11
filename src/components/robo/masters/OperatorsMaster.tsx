"use client";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui";

interface Operator { id: string; name: string; isActive: boolean; }

const inp = "border border-gray-300 bg-white rounded-lg px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function OperatorsMaster() {
  const [ops, setOps] = useState<Operator[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => fetch("/api/robo/operators").then(r => r.json()).then((d: Operator[]) => setOps(d));
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError("");
    const res = await fetch("/api/robo/operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const data: { error?: string } = await res.json();
      setError(data.error || "Failed to add operator");
    } else {
      setName("");
    }
    setSaving(false);
    load();
  };

  const toggle = async (op: Operator) => {
    await fetch(`/api/robo/operators/${op.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !op.isActive }),
    });
    load();
  };

  const activeOps = ops.filter(o => o.isActive);
  const inactiveOps = ops.filter(o => !o.isActive);

  return (
    <div className="max-w-2xl">
      <form onSubmit={add} className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Enter operator name"
          className={`flex-1 ${inp}`}
          required
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60"
        >
          + Add
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["Name", "Status", ""].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No operators yet. Add one above.</td></tr>
            )}
            {[...activeOps, ...inactiveOps].map(o => (
              <tr key={o.id} className="border-t border-gray-100">
                <td className="px-4 py-3 font-medium text-gray-800">{o.name}</td>
                <td className="px-4 py-3">
                  {o.isActive ? (
                    <Badge tone="green">Active</Badge>
                  ) : (
                    <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggle(o)}
                    className={`text-xs ${o.isActive ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}
                  >
                    {o.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Operators appear in the shift start dropdown. Deactivated operators are hidden from the dropdown but preserved in history.
      </p>
    </div>
  );
}
