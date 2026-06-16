"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LedgerBag, RmOption, Op, CorrectionDiff } from "@/lib/siloCorrection";
import { previewSiloCorrection, applySiloCorrection } from "@/app/silo/actions";

type Mode = "weight" | "swap" | "insert" | "delete";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "weight", label: "Fix weight", hint: "The bag weighed a different amount — adjust it and ripple forward." },
  { id: "swap", label: "Wrong bag / RM", hint: "Right amount, wrong material — re-point to the correct RM bag." },
  { id: "insert", label: "Insert skipped bag", hint: "A bag was dumped but never logged — add it at this position." },
  { id: "delete", label: "Remove extra bag", hint: "This bag was logged by mistake — remove it." },
];

const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const kg = (n: number) => n.toLocaleString("en-IN");

export function SiloCorrect({ siloNo, bags, rmOptions, mayEdit }: { siloNo: string; bags: LedgerBag[]; rmOptions: RmOption[]; mayEdit: boolean }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("weight");
  const [newWeight, setNewWeight] = useState("");
  const [rmId, setRmId] = useState("");
  const [insWeight, setInsWeight] = useState("");
  const [insRm, setInsRm] = useState("");
  const [diff, setDiff] = useState<CorrectionDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() { setDiff(null); setError(null); setNewWeight(""); setRmId(""); setInsWeight(""); setInsRm(""); }
  function openRow(b: LedgerBag) { if (openId === b.id) { setOpenId(null); reset(); } else { setOpenId(b.id); setMode("weight"); reset(); setNewWeight(String(b.weight)); } }

  function buildOp(bag: LedgerBag): Op | null {
    if (mode === "weight") { const w = parseFloat(newWeight); return Number.isFinite(w) ? { type: "editWeight", bagId: bag.id, newWeight: w } : null; }
    if (mode === "swap") return { type: "swapBag", bagId: bag.id, rmAirtableId: rmId || null };
    if (mode === "insert") { const w = parseFloat(insWeight); return Number.isFinite(w) && w > 0 ? { type: "insert", afterBagId: bag.id, weight: w, rmAirtableId: insRm || null } : null; }
    if (mode === "delete") return { type: "delete", bagId: bag.id };
    return null;
  }

  function preview(bag: LedgerBag) {
    const op = buildOp(bag); if (!op) { setError("Fill in a valid value first."); return; }
    setError(null); setDone(null);
    start(async () => { const r = await previewSiloCorrection(siloNo, op); if (r.error) { setError(r.error); setDiff(null); } else { setDiff(r.diff ?? null); } });
  }
  function apply(bag: LedgerBag) {
    const op = buildOp(bag); if (!op) return;
    start(async () => { const r = await applySiloCorrection(siloNo, op); if (r.error) setError(r.error); else { setDone(r.message ?? "Done."); setDiff(null); setOpenId(null); router.refresh(); } });
  }

  return (
    <div className="space-y-3">
      {done && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">✓ {done}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Bag</th>
              <th className="px-3 py-2">Material</th><th className="px-3 py-2 text-right">Dumped</th>
              <th className="px-3 py-2 text-right">Used</th><th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2">Fed cycles (FIFO)</th>{mayEdit && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {bags.map((b) => {
              const isOpen = openId === b.id;
              return (
                <Fragment key={b.id}>
                  <tr key={b.id} className={`border-t border-gray-100 align-top ${isOpen ? "bg-brand/[0.03]" : "hover:bg-gray-50/50"}`}>
                    <td className="px-3 py-2 font-medium text-gray-500">{b.increment}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{b.date ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{b.label}{b.supplier && <div className="text-[11px] font-normal text-gray-400">{b.supplier}</div>}</td>
                    <td className="px-3 py-2 text-gray-600">{b.material}</td>
                    <td className="px-3 py-2 text-right font-medium">{kg(b.weight)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{kg(b.consumed)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${b.remaining > 0 ? "text-amber-700" : "text-gray-400"}`}>{kg(b.remaining)}</td>
                    <td className="px-3 py-2">
                      {b.draws.length ? (
                        <div className="flex flex-wrap gap-1">
                          {b.draws.slice(0, 6).map((d, i) => <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">B{d.batch ?? "?"}·C{d.cycle ?? "?"} <span className="text-gray-400">{kg(d.kg)}kg</span></span>)}
                          {b.draws.length > 6 && <span className="text-[11px] text-gray-400">+{b.draws.length - 6}</span>}
                        </div>
                      ) : <span className="text-[11px] text-gray-300">— in stock</span>}
                    </td>
                    {mayEdit && <td className="px-3 py-2 text-right"><button onClick={() => openRow(b)} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${isOpen ? "border-brand bg-brand text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{isOpen ? "Close" : "Correct"}</button></td>}
                  </tr>
                  {isOpen && mayEdit && (
                    <tr key={b.id + "-edit"} className="border-t border-brand/20 bg-brand/[0.03]">
                      <td colSpan={mayEdit ? 9 : 8} className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {MODES.map((m) => <button key={m.id} onClick={() => { setMode(m.id); reset(); if (m.id === "weight") setNewWeight(String(b.weight)); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === m.id ? "bg-brand text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{m.label}</button>)}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">{MODES.find((m) => m.id === mode)?.hint}</p>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {mode === "weight" && (
                            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Correct weight (kg)</span><input value={newWeight} onChange={(e) => setNewWeight(e.target.value)} type="number" className={input} placeholder={String(b.weight)} /></label>
                          )}
                          {mode === "swap" && (
                            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-gray-600">Correct RM bag (in store)</span>
                              <select value={rmId} onChange={(e) => setRmId(e.target.value)} className={input}><option value="">— remove RM link —</option>{rmOptions.map((o) => <option key={o.airtableId} value={o.airtableId}>{o.label} · {o.material}</option>)}</select></label>
                          )}
                          {mode === "insert" && (<>
                            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Skipped bag weight (kg)</span><input value={insWeight} onChange={(e) => setInsWeight(e.target.value)} type="number" className={input} placeholder="e.g. 1200" /></label>
                            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">RM bag (optional)</span><select value={insRm} onChange={(e) => setInsRm(e.target.value)} className={input}><option value="">— none —</option>{rmOptions.map((o) => <option key={o.airtableId} value={o.airtableId}>{o.label} · {o.material}</option>)}</select></label>
                            <p className="text-[11px] text-gray-400 sm:col-span-2">Inserts right after bag #{b.increment}; the silo is renumbered to keep dump order.</p>
                          </>)}
                          {mode === "delete" && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2">Removes bag <b>{b.label}</b> ({kg(b.weight)} kg). Its RM returns to store and the cycles it fed are re-balanced onto the following bags.</p>}
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <button onClick={() => preview(b)} disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black disabled:opacity-50">{pending ? "Checking…" : "Preview change"}</button>
                          {diff && <button onClick={() => apply(b)} disabled={pending} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">Confirm & apply</button>}
                          <button onClick={() => { setOpenId(null); reset(); }} className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
                        </div>

                        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
                        {diff && <DiffView diff={diff} />}
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

function DiffView({ diff }: { diff: CorrectionDiff }) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-semibold text-gray-800">Preview — what this correction will change</div>
      <p className="text-xs text-gray-500">{diff.note}</p>

      {diff.remainingChanges.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Bag remaining weight</div>
          <div className="flex flex-wrap gap-2">
            {diff.remainingChanges.map((c, i) => <span key={i} className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{c.label}: {kg(c.before)} → <b>{kg(c.after)}</b> kg</span>)}
          </div>
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
            {diff.linkChanges.length > 40 && <div className="text-[11px] text-gray-400">+{diff.linkChanges.length - 40} more</div>}
          </div>
        </div>
      )}

      {diff.shortfalls.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          ⚠ {diff.shortfalls.length} cycle(s) can no longer be fully filled from this silo after the change: {diff.shortfalls.slice(0, 5).map((s) => `B${s.batch ?? "?"}·C${s.cycle ?? "?"} short ${kg(s.short)}kg`).join("; ")}{diff.shortfalls.length > 5 ? "…" : ""}
        </div>
      )}

      {diff.affectedBatches.length > 0 && <div className="text-[11px] text-gray-400">Batches affected: {diff.affectedBatches.join(", ")}</div>}
      {diff.remainingChanges.length === 0 && diff.linkChanges.length === 0 && <div className="text-[11px] text-gray-500">No downstream change — this correction only updates the bag itself.</div>}
    </div>
  );
}
