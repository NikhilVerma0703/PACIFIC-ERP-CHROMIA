"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSlabAction, removeSlabAction } from "@/app/batch/rangeActions";

const ALL_STATIONS = ["Press", "Distributor", "Kreos", "Oven", "Jot", "Polish Entry", "Polish QC"];

export function RangeRectify({ batch, batchKey, slabs, added, mayEdit }: { batch: string; batchKey: string; slabs: { slab: number; stations: string[]; added: boolean }[]; added: number[]; mayEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newSlab, setNewSlab] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function add() {
    const n = parseFloat(newSlab);
    if (!Number.isFinite(n)) { setMsg({ kind: "err", text: "Enter a valid slab number." }); return; }
    start(async () => { const r = await addSlabAction(batchKey, n); if (r.error) setMsg({ kind: "err", text: r.error }); else { setMsg({ kind: "ok", text: r.message ?? "Added." }); setNewSlab(""); router.refresh(); } });
  }
  function remove(slab: number) {
    start(async () => { const r = await removeSlabAction(batchKey, slab, added); if (r.error) setMsg({ kind: "err", text: r.error }); else { setMsg({ kind: "ok", text: r.message ?? "Removed." }); router.refresh(); } });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand/20 bg-brand/[0.03] p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand/80">Add a slab to batch {batch}</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newSlab} onChange={(e) => setNewSlab(e.target.value)} type="number" step="any" placeholder="slab number" disabled={!mayEdit} className="w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50" />
          <button type="button" onClick={add} disabled={!mayEdit || pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "…" : "Add slab"}</button>
          <span className="text-[11px] text-gray-500">Adds it to this batch&apos;s expected list — it shows as missing wherever it isn&apos;t recorded.</span>
        </div>
      </div>

      {msg && <div className={`rounded-lg border px-4 py-2 text-sm ${msg.kind === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.text}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr><th className="px-3 py-2">Slab</th><th className="px-3 py-2">Present at</th><th className="px-3 py-2">Missing at</th>{mayEdit && <th className="px-3 py-2"></th>}</tr>
          </thead>
          <tbody>
            {slabs.map((s) => {
              const missing = ALL_STATIONS.filter((st) => !s.stations.includes(st));
              return (
                <tr key={s.slab} className="border-t border-gray-100 align-top hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-900">{s.slab}{s.added && <span className="ml-1 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">added</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{s.stations.length ? s.stations.join(", ") : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-amber-700">{missing.length ? missing.join(", ") : <span className="text-gray-300">—</span>}</td>
                  {mayEdit && <td className="px-3 py-2 text-right"><button type="button" onClick={() => remove(s.slab)} disabled={pending} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Remove</button></td>}
                </tr>
              );
            })}
            {slabs.length === 0 && <tr><td colSpan={mayEdit ? 4 : 3} className="px-3 py-8 text-center text-sm text-gray-400">No slabs in this batch yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
