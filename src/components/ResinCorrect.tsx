"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ResinPrep, ResinOp, ResinDiff } from "@/lib/resinCorrection";
import { previewResin, applyResin } from "@/app/resin/actions";

type Mode = "weight" | "insert" | "delete";
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "weight", label: "Fix quantity", hint: "This prep was a different amount — adjust it and ripple forward." },
  { id: "insert", label: "Insert skipped prep", hint: "A prep was made but never logged — add it at this position." },
  { id: "delete", label: "Remove extra prep", hint: "This prep was logged by mistake — remove it (its quantity returns to storage)." },
];
const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const kg = (n: number) => n.toLocaleString("en-IN");

export function ResinCorrect({ tankNo, preps, mayEdit }: { tankNo: string; preps: ResinPrep[]; mayEdit: boolean }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("weight");
  const [newWeight, setNewWeight] = useState("");
  const [insWeight, setInsWeight] = useState("");
  const [diff, setDiff] = useState<ResinDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() { setDiff(null); setError(null); setNewWeight(""); setInsWeight(""); }
  function openRow(p: ResinPrep) { if (openId === p.id) { setOpenId(null); reset(); } else { setOpenId(p.id); setMode("weight"); reset(); setNewWeight(String(p.weight)); } }

  function buildOp(p: ResinPrep): ResinOp | null {
    if (mode === "weight") { const w = parseFloat(newWeight); return Number.isFinite(w) ? { type: "editWeight", rowId: p.id, newWeight: w } : null; }
    if (mode === "insert") { const w = parseFloat(insWeight); return Number.isFinite(w) && w > 0 ? { type: "insert", afterRowId: p.id, weight: w } : null; }
    if (mode === "delete") return { type: "delete", rowId: p.id };
    return null;
  }
  function preview(p: ResinPrep) {
    const op = buildOp(p); if (!op) { setError("Fill in a valid value first."); return; }
    setError(null); setDone(null);
    start(async () => { const r = await previewResin(tankNo, op); if (r.error) { setError(r.error); setDiff(null); } else setDiff(r.diff ?? null); });
  }
  function apply(p: ResinPrep) {
    const op = buildOp(p); if (!op) return;
    start(async () => { const r = await applyResin(tankNo, op); if (r.error) setError(r.error); else { setDone(r.message ?? "Done."); setDiff(null); setOpenId(null); router.refresh(); } });
  }

  return (
    <div className="space-y-3">
      {done && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">✓ {done}</div>}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Prep</th>
              <th className="px-3 py-2">Incharge</th><th className="px-3 py-2 text-right">Prepared</th>
              <th className="px-3 py-2 text-right">Used</th><th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2">Fed cycles (FIFO)</th>{mayEdit && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {preps.map((p) => {
              const isOpen = openId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className={`border-t border-gray-100 align-top ${isOpen ? "bg-brand/[0.03]" : "hover:bg-gray-50/50"}`}>
                    <td className="px-3 py-2 font-medium text-gray-500">{p.increment}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{p.date ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{p.label}{p.supplier && <div className="text-[11px] font-normal text-gray-400">{p.supplier}</div>}</td>
                    <td className="px-3 py-2 text-gray-600">{p.incharge ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">{kg(p.weight)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{kg(p.consumed)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${p.remaining > 0 ? "text-amber-700" : "text-gray-400"}`}>{kg(p.remaining)}</td>
                    <td className="px-3 py-2">
                      {p.draws.length ? (
                        <div className="flex flex-wrap gap-1">
                          {p.draws.slice(0, 6).map((d, i) => <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">B{d.batch ?? "?"}·C{d.cycle ?? "?"} <span className="text-gray-400">{kg(d.kg)}kg</span></span>)}
                          {p.draws.length > 6 && <span className="text-[11px] text-gray-400">+{p.draws.length - 6}</span>}
                        </div>
                      ) : <span className="text-[11px] text-gray-300">— in tank</span>}
                    </td>
                    {mayEdit && <td className="px-3 py-2 text-right"><button onClick={() => openRow(p)} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${isOpen ? "border-brand bg-brand text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{isOpen ? "Close" : "Correct"}</button></td>}
                  </tr>
                  {isOpen && mayEdit && (
                    <tr className="border-t border-brand/20 bg-brand/[0.03]">
                      <td colSpan={9} className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {MODES.map((m) => <button key={m.id} onClick={() => { setMode(m.id); reset(); if (m.id === "weight") setNewWeight(String(p.weight)); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === m.id ? "bg-brand text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{m.label}</button>)}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">{MODES.find((m) => m.id === mode)?.hint}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {mode === "weight" && <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Correct quantity (kg)</span><input value={newWeight} onChange={(e) => setNewWeight(e.target.value)} type="number" className={input} placeholder={String(p.weight)} /></label>}
                          {mode === "insert" && (<>
                            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Skipped prep quantity (kg)</span><input value={insWeight} onChange={(e) => setInsWeight(e.target.value)} type="number" className={input} placeholder="e.g. 500" /></label>
                            <p className="text-[11px] text-gray-400 sm:col-span-2">Inserts right after prep #{p.increment}; the tank is renumbered to keep prep order.</p>
                          </>)}
                          {mode === "delete" && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2">Removes prep <b>{p.label}</b> ({kg(p.weight)} kg). Its quantity returns to resin storage and the cycles it fed are re-balanced onto the following preps.</p>}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button onClick={() => preview(p)} disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black disabled:opacity-50">{pending ? "Checking…" : "Preview change"}</button>
                          {diff && <button onClick={() => apply(p)} disabled={pending} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">Confirm & apply</button>}
                          <button onClick={() => { setOpenId(null); reset(); }} className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
                        </div>
                        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
                        {diff && <ResinDiffView diff={diff} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!mayEdit && <p className="text-xs text-gray-400">You have view-only access — only incharge and above can apply corrections.</p>}
    </div>
  );
}

function ResinDiffView({ diff }: { diff: ResinDiff }) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-semibold text-gray-800">Preview — what this correction will change</div>
      <p className="text-xs text-gray-500">{diff.note}</p>
      {diff.remainingChanges.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Prep remaining</div>
          <div className="flex flex-wrap gap-2">{diff.remainingChanges.map((c, i) => <span key={i} className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{c.label}: {kg(c.before)} → <b>{kg(c.after)}</b> kg</span>)}</div>
        </div>
      )}
      {diff.linkChanges.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Downstream cycles re-balanced ({diff.affectedCycles})</div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {diff.linkChanges.slice(0, 40).map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded bg-gray-50 px-2 py-1 text-[11px]">
                <span className="font-medium text-gray-700">B{c.batch ?? "?"}·C{c.cycle ?? "?"}</span>
                <span className="text-gray-400">{c.before.join(", ") || "—"}</span><span className="text-gray-400">→</span>
                <span className="font-medium text-gray-800">{c.after.join(", ") || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {diff.shortfalls.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">⚠ {diff.shortfalls.length} cycle(s) can no longer be fully filled from this tank after the change.</div>}
      {diff.remainingChanges.length === 0 && diff.linkChanges.length === 0 && <div className="text-[11px] text-gray-500">No downstream change — this correction only updates the prep itself.</div>}
    </div>
  );
}
