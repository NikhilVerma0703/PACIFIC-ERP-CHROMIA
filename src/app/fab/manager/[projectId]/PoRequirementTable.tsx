"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteJson, patchJson, postJson } from "@/lib/fab/postJson";

interface Row {
  id: string;
  pieceLabel: string | null;
  length: number | null;
  width: number | null;
  quantity: number;
  totalSqft: number | null;
  notes: string | null;
  allocatedQty: number;
  pieceCount: number;
  locked: boolean;
}

export function PoRequirementTable({ poId }: { poId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    pieceLabel: "",
    lengthIn: "",
    widthIn: "",
    quantity: "1",
    notes: "",
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/manager/pos/${poId}/rows`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setLoadError(data?.error ?? "Could not load rows.");
      return;
    }
    setRows(Array.isArray(data?.rows) ? data.rows : []);
    setLoadError(null);
  }, [poId]);

  useEffect(() => { load(); }, [load]);

  async function save(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    const r = await patchJson(`/api/fab/manager/pos/rows/${id}`, patch);
    setBusy(null);
    if (!r.ok) { setLoadError(r.error); return; }
    await load();
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this piece row? It will leave the purchase order.")) return;
    setBusy(id);
    const r = await deleteJson(`/api/fab/manager/pos/rows/${id}`);
    setBusy(null);
    if (!r.ok) { setLoadError(r.error); return; }
    await load();
    router.refresh();
  }

  async function add() {
    setBusy("add");
    const r = await postJson(`/api/fab/manager/pos/${poId}/rows`, {
      pieceLabel: draft.pieceLabel || `Row ${rows.length + 1}`,
      lengthIn: Number(draft.lengthIn),
      widthIn: Number(draft.widthIn),
      quantity: Number(draft.quantity),
      notes: draft.notes,
    });
    setBusy(null);
    if (!r.ok) { setLoadError(r.error); return; }
    setDraft({ pieceLabel: "", lengthIn: "", widthIn: "", quantity: "1", notes: "" });
    await load();
    router.refresh();
  }

  return (
    <div className="mt-4">
      {loadError && (
        <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Label</th>
              <th className="text-right px-3 py-2 font-semibold">Length (in)</th>
              <th className="text-right px-3 py-2 font-semibold">Width (in)</th>
              <th className="text-right px-3 py-2 font-semibold">Qty</th>
              <th className="text-right px-3 py-2 font-semibold">SFT</th>
              <th className="text-left px-3 py-2 font-semibold">Notes</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(r => (
              <tr key={r.id} className={r.locked ? "bg-slate-50/80" : "hover:bg-slate-50"}>
                <td className="px-2 py-1.5">
                  <input
                    defaultValue={r.pieceLabel ?? ""}
                    disabled={r.locked || busy === r.id}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v && v !== (r.pieceLabel ?? "")) save(r.id, { pieceLabel: v });
                    }}
                    className="w-full min-w-[5rem] border border-transparent focus:border-slate-300 rounded px-2 py-1 font-mono font-semibold text-slate-800 disabled:text-slate-400"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number" step="0.01" defaultValue={r.length ?? ""}
                    disabled={r.locked || busy === r.id}
                    onBlur={e => {
                      const n = Number(e.target.value);
                      if (n && n !== r.length) save(r.id, { lengthIn: n });
                    }}
                    className="w-20 text-right border border-transparent focus:border-slate-300 rounded px-2 py-1 disabled:text-slate-400"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number" step="0.01" defaultValue={r.width ?? ""}
                    disabled={r.locked || busy === r.id}
                    onBlur={e => {
                      const n = Number(e.target.value);
                      if (n && n !== r.width) save(r.id, { widthIn: n });
                    }}
                    className="w-20 text-right border border-transparent focus:border-slate-300 rounded px-2 py-1 disabled:text-slate-400"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number" step="1" min="1" defaultValue={r.quantity}
                    disabled={r.locked || busy === r.id}
                    onBlur={e => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1 && n !== r.quantity) save(r.id, { quantity: n });
                    }}
                    className="w-16 text-right border border-transparent focus:border-slate-300 rounded px-2 py-1 disabled:text-slate-400"
                  />
                </td>
                <td className="px-3 py-1.5 text-right text-slate-500">
                  {r.totalSqft != null ? r.totalSqft.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <input
                    defaultValue={r.notes ?? ""}
                    disabled={busy === r.id}
                    placeholder="Row info"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== (r.notes ?? "")) save(r.id, { notes: v });
                    }}
                    className="w-full min-w-[8rem] border border-transparent focus:border-slate-300 rounded px-2 py-1 text-slate-700"
                  />
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {r.locked ? (
                    <span className="text-[10px] font-semibold text-slate-400">On the cutter</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      disabled={busy === r.id}
                      className="text-[11px] font-semibold text-red-600 hover:text-red-800 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50/60">
              <td className="px-2 py-1.5">
                <input
                  value={draft.pieceLabel}
                  onChange={e => setDraft(d => ({ ...d, pieceLabel: e.target.value }))}
                  placeholder={`Row ${rows.length + 1}`}
                  className="w-full min-w-[5rem] border border-slate-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number" step="0.01" value={draft.lengthIn}
                  onChange={e => setDraft(d => ({ ...d, lengthIn: e.target.value }))}
                  placeholder="L"
                  className="w-20 text-right border border-slate-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number" step="0.01" value={draft.widthIn}
                  onChange={e => setDraft(d => ({ ...d, widthIn: e.target.value }))}
                  placeholder="W"
                  className="w-20 text-right border border-slate-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number" step="1" min="1" value={draft.quantity}
                  onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))}
                  className="w-16 text-right border border-slate-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-3 py-1.5 text-slate-300 text-right">—</td>
              <td className="px-2 py-1.5">
                <input
                  value={draft.notes}
                  onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                  placeholder="Row info"
                  className="w-full min-w-[8rem] border border-slate-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-3 py-1.5 text-right">
                <button
                  type="button"
                  onClick={add}
                  disabled={busy === "add" || !draft.lengthIn || !draft.widthIn}
                  className="text-[11px] font-semibold text-slate-800 hover:text-slate-600 disabled:opacity-40"
                >
                  {busy === "add" ? "Adding…" : "Add row"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Click a cell to edit, then leave it to save. Rows already sent to cutting stay locked.
      </p>
    </div>
  );
}
