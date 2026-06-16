"use client";
// Wrong-batch entries card (Batch Lookup). Click a group to open the slab
// list, tick the slabs to fix (all pre-selected), and move them to the slab’s
// true (line-head) batch — like the duplicates tool, but for batch moves.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WrongBatchGroup } from "@/lib/batchMismatch";
import { moveWrongBatchRows } from "@/app/batch/wrongBatchActions";

function GroupCard({ g, mayEdit, viewedBatch }: { g: WrongBatchGroup; mayEdit: boolean; viewedBatch: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(g.rows.map((r) => r.id)));
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const allOn = sel.size === g.rows.length && g.rows.length > 0;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allOn ? new Set() : new Set(g.rows.map((r) => r.id)));

  const run = () => start(async () => {
    const r = await moveWrongBatchRows(g.model, [...sel], g.toBatch);
    setMsg(r.error ?? r.message ?? null);
    if (r.ok) { setDone(true); setConfirming(false); router.refresh(); }
  });

  return (
    <div className="rounded-lg border border-red-100 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-red-50/50">
        <span className="text-sm text-gray-800">
          <span className="font-semibold">{g.label}</span>{" — "}
          {g.direction === "foreign"
            ? <>{g.rows.length} slab(s) entered under <b>{viewedBatch}</b> that the line head created in batch <b>{g.toBatch}</b></>
            : <>{g.rows.length} slab(s) of this batch entered under <b>{g.fromBatch}</b> by mistake</>}
          {g.skipped.length > 0 && <span className="text-amber-700"> · {g.skipped.length} not auto-fixable</span>}
        </span>
        <span className="text-xs font-medium text-brand">{open ? "Hide ▴" : "Review & fix ▾"}</span>
      </button>

      {open && (
        <div className="border-t border-red-100 px-3 py-3">
          {g.rows.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700">
                  <input type="checkbox" checked={allOn} onChange={toggleAll} className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                  Select all ({g.rows.length})
                </label>
                {mayEdit && !done && (!confirming ? (
                  <button onClick={() => { setMsg(null); setConfirming(true); }} disabled={sel.size === 0}
                    className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">
                    Move {sel.size === g.rows.length ? "all" : sel.size} selected to {g.toBatch}…
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    <button onClick={run} disabled={pending} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                      {pending ? "Moving…" : `Yes — move ${sel.size} slab(s) to ${g.toBatch}`}
                    </button>
                    <button onClick={() => setConfirming(false)} disabled={pending} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-8">
                {g.rows.map((r) => (
                  <label key={r.id} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${sel.has(r.id) ? "border-red-300 bg-red-50 text-red-800" : "border-gray-200 bg-white text-gray-500"}`}>
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                    #{r.slabNumber}
                  </label>
                ))}
              </div>
            </>
          )}
          {g.skipped.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <div className="mb-1 font-medium">Not auto-fixable — needs a person to decide:</div>
              {g.skipped.slice(0, 8).map((s) => <div key={s.slabNumber}>#{s.slabNumber}: {s.reason}</div>)}
              {g.skipped.length > 8 && <div>+{g.skipped.length - 8} more</div>}
            </div>
          )}
          {msg && <div className="mt-2 text-xs font-medium text-red-800">{msg}</div>}
          {!mayEdit && g.rows.length > 0 && <div className="mt-2 text-xs text-gray-400">Only incharge and above can move slabs between batches.</div>}
        </div>
      )}
    </div>
  );
}

export function WrongBatchFix({ groups, mayEdit, viewedBatch }: { groups: WrongBatchGroup[]; mayEdit: boolean; viewedBatch: string }) {
  if (!groups.length) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="mb-1 text-sm font-semibold text-red-800">⚠ Wrong-batch entries detected</div>
      <p className="mb-3 max-w-3xl text-xs text-red-700">
        The slab number is created at the line head (Distributor / Kreos), so the line head decides which batch a slab belongs to.
        The rows below disagree with the line head — usually an operator typed the wrong batch. Click a row to review the slabs and
        move some or all of them; only the batch on the station record changes.
      </p>
      <div className="space-y-2">
        {groups.map((g, i) => <GroupCard key={`${g.model}-${g.toBatchKey}-${g.direction}-${i}`} g={g} mayEdit={mayEdit} viewedBatch={viewedBatch} />)}
      </div>
    </div>
  );
}
