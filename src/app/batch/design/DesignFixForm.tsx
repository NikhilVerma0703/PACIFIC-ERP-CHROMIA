"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyBatchDesign } from "./actions";
import { undoLast } from "../undo";

const base = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function DesignFixForm({
  batch, designs, primary, bySource,
}: {
  batch: string;
  designs: string[];
  primary: string | null;
  bySource: Record<string, string[]>;
}) {
  const [picked, setPicked] = useState<string>(primary ?? designs[0] ?? "");
  const [custom, setCustom] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [undone, setUndone] = useState(false);
  const router = useRouter();

  const chosen = custom.trim() || picked;

  function apply() {
    if (!chosen) return;
    if (!window.confirm(`Set design to “${chosen}” on every record in batch ${batch} that currently has a different design?`)) return;
    start(async () => {
      const r = await applyBatchDesign(batch, chosen);
      setMsg(r.message);
      if (r.ok && r.changed > 0) { setApplied(true); setUndone(false); }
      router.refresh();
    });
  }

  function undo() {
    start(async () => {
      const r = await undoLast(batch);
      setMsg(r.message);
      if (r.ok) setUndone(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-medium text-gray-700">Designs currently on this batch</div>
        <table className="w-full max-w-lg text-sm">
          <tbody>
            {Object.entries(bySource).map(([src, ds]) => (
              <tr key={src} className="border-t border-gray-100">
                <td className="w-32 py-2 font-medium text-gray-600">{src}</td>
                <td className="py-2 text-gray-900">{ds.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Correct design (pick one)</span>
          <select value={picked} onChange={(e) => setPicked(e.target.value)} className={base}>
            {designs.map((dz) => <option key={dz} value={dz}>{dz}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">…or type a different design (overrides)</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom design name" className={base} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
        <button onClick={apply} disabled={pending || !chosen}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">
          {pending ? "Applying…" : `Apply “${chosen || "—"}” to whole batch`}
        </button>
        {applied && !undone && (
          <button onClick={undo} disabled={pending}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
            Undo this change
          </button>
        )}
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
      </div>
    </div>
  );
}
