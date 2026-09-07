"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteJson, patchJson, postJson } from "@/lib/fab/postJson";
import { PoSinkBoard } from "@/components/fab/PoSinkBoard";

interface Row {
  id: string;
  pieceLabel: string | null;
  /** The row's letter — every piece cut from it is named {project}-{LETTER}-{n}.
   *  Null for rows imported before scripts/0054. */
  rowLetter: string | null;
  length: number | null;
  width: number | null;
  quantity: number;
  /** fab_requirement.sink_quantity. NULL = nobody has decided yet, which is a
   *  different fact from 0 and is shown as such. */
  sinkQuantity: number | null;
  /** fab_requirement.finished_edges — the HAND edge polish decision, settled on
   *  the board above beside the sink. NULL = nobody has marked it, which is not
   *  the same as "no edges". */
  finishedEdges: string | null;
  /** RECTANGLE / CIRCLE / OVAL. Null is a rectangle. */
  shapeType: string | null;
  /** TOP / BOTTOM / BOTH — how many times each chosen edge is walked. Null is
   *  TOP; BOTH doubles the running feet. scripts/0065. */
  edgeFaces: string | null;
  /** MILLIMETRES of the stone this row is on, or null before it has one — the
   *  edge rate is keyed on the thickness, so the charge waits for it. */
  thicknessMm: number | null;
  totalSqft: number | null;
  notes: string | null;
  allocatedQty: number;
  pieceCount: number;
  locked: boolean;
}

/* -- SINKS ARE THE BOARD'S JOB NOW ------------------------------------------
 *
 * A SinkCell in this table and a SinkBulkBar above it used to hold the sink
 * decision. Both are gone, replaced by components/fab/PoSinkBoard.tsx —
 * the owner: "I want the UI and flow you had for the supervisor dashboard
 * earlier for the PO as well."
 *
 * Nothing was lost in the move: the board does everything they did — the two
 * ends in one click, a typed partial that splits, and the whole-PO bulk button —
 * and adds what a table cell could not: two columns you can see the shape of at
 * a glance, drag and drop, and an undo that can merge a mis-typed split back.
 *
 * This table keeps what it was always for: sizes, quantities, notes.
 */

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

  /** What the board calls after anything it does. A split or a merge changes
   *  the SHAPE of the list — a row appears or vanishes — so the table re-fetches
   *  rather than guessing, which is how it ended up showing 80 pieces on an
   *  order of 60. (setSink and bulkSink used to live here; the board owns both
   *  requests now, so there is one caller of each rather than two.) */
  const reload = useCallback(async () => {
    await load();
    router.refresh();
  }, [load, router]);

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
      <PoSinkBoard poId={poId} rows={rows} busy={busy !== null} onChanged={reload} />
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {/* THE ROW LETTER — read-only on purpose. It is baked into every
                  piece code already cut from this row, so it is not a field
                  anybody may retype. The editable Label beside it stays what it
                  was: the PDF's own row number, and a place for a note. */}
              <th className="text-left px-3 py-2 font-semibold">Row</th>
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
                <td className="px-3 py-1.5">
                  <span className={`font-mono font-bold ${r.rowLetter ? "text-slate-800" : "text-slate-300"}`}>
                    {r.rowLetter ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    key={r.pieceLabel ?? ""}
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
                    type="number" step="0.01" key={r.length ?? ""}
                    defaultValue={r.length ?? ""}
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
                    type="number" step="0.01" key={r.width ?? ""}
                    defaultValue={r.width ?? ""}
                    disabled={r.locked || busy === r.id}
                    onBlur={e => {
                      const n = Number(e.target.value);
                      if (n && n !== r.width) save(r.id, { widthIn: n });
                    }}
                    className="w-20 text-right border border-transparent focus:border-slate-300 rounded px-2 py-1 disabled:text-slate-400"
                  />
                </td>
                <td className="px-2 py-1.5">
                  {/* key={r.quantity} — THE SPLIT BUG.
                      These inputs are UNCONTROLLED: `defaultValue` is read once,
                      when the input mounts, and ignored on every render after.
                      That was invisible while the only thing that changed a
                      value was the person typing it — the box already showed
                      what they had typed.
                      A split changes quantity from the SERVER: row C goes from
                      60 to 40 and a new row takes 20. The reload fetched 40, and
                      the box carried on showing 60 because the <tr> key never
                      changed, so React had no reason to remount it — 60 + 20 =
                      80 on screen, 40 + 20 = 60 in the database. Keying on the
                      value forces the remount, and the box shows what was
                      actually stored. */}
                  <input
                    key={r.quantity}
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
                    key={r.notes ?? ""}
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
              <td className="px-3 py-1.5 text-slate-300 font-mono">—</td>
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
      <p className="text-[11px] text-slate-400 mt-1">
        <strong className="text-slate-500">Sink</strong> — one question: how many of the row&apos;s
        pieces have a sink? Plain and Sink are the two ends in one click; type anything in between
        and press Enter and the row splits — it keeps the rest, a new row takes the others, same
        size and thickness, a different row because the routing differs. Use the bar above to clear
        a whole PO at once. A row already on a slab has to come off the slab board first.
      </p>
    </div>
  );
}
