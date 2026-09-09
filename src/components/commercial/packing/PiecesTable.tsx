"use client";
// The cut-to-size table on the packing-list editor (round three, answer 5).
//
// A packing list packs slabs today; his three cut-to-size workbooks pack PIECES,
// and the columns are theirs: CRATE NO. | DRAWING NO | PIECE NO. | MATERIAL NAME
// | SIZE L × W | THICK | SQFT | QTY (PCS) | BUILDING | WEIGHT, with a subtotal
// per crate and a TOTAL for the sheet.
//
// Edited the same way the slab table is — field by field, committed on blur —
// because a cut-to-size sheet is typed from paper over an afternoon and a form
// that loses twenty rows to a lapsed session gets kept on paper instead.
//
// SIZES ARE TYPED AND SHOWN IN THE LIST'S UNIT and stored in millimetres
// (sizeToMm / sizeFromMm): the row underneath never moves when the clerk flips
// the sheet between cm and in, which is the same lens the slab sizes look
// through (answer 17 of round one).
import React, { useEffect, useState } from "react";
import { Empty } from "@/components/ui";
import { pieceSheet, sizeFromMm, sizeToMm, MAX_PIECE_QUANTITY, type PieceLike } from "@/lib/commercial/pieces-rules";
import type { MeasurementUnit } from "@/lib/commercial/measure";

export interface PieceRow extends PieceLike {
  id: string;
  crateId: string | null;
  drawingNo: string | null;
  pieceNo: string | null;
  room: string | null;
  notes: string | null;
}

const cell = "w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:border-transparent disabled:bg-transparent disabled:text-gray-500";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnDanger = "rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60";

const n3 = (v: number | null | undefined): string => (v == null ? "" : String(v));

/** One editable cell: committed on blur or Enter, and only when it changed. */
function Cell({ value, onCommit, disabled, width, placeholder }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; width?: string; placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <input
      className={cell} style={width ? { width } : undefined} value={v} disabled={disabled} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

const BLANK = { crateNo: "", drawingNo: "", pieceNo: "", design: "", length: "", width: "", thickness: "", sqft: "", quantity: "1", room: "", weightKg: "" };

export function PiecesTable({ pieces, unit, editable, busy, onAdd, onPatch, onRemove, onError }: {
  pieces: PieceRow[];
  unit: MeasurementUnit;
  editable: boolean;
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<boolean>;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState({ ...BLANK });
  const sheet = pieceSheet(pieces);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const showSize = (mm: number | null): string => n3(sizeFromMm(mm, unit));

  /** A size typed in the list's unit, saved as the millimetres the row keeps. */
  const commitSize = (id: string, side: "lengthMm" | "widthMm" | "thicknessMm", typed: string) => {
    const v = typed.trim();
    if (v === "") return onPatch(id, { [side]: null });
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      onError(`${side === "lengthMm" ? "Length" : side === "widthMm" ? "Width" : "Thickness"} must be a number of ${unit}`);
      return Promise.resolve(false);
    }
    return onPatch(id, { [side]: sizeToMm(n, unit) });
  };

  const addLine = async () => {
    if (!draft.design.trim()) { onError("Name the design — a line with no material names nothing that can be packed"); return; }
    const qty = Number(draft.quantity || "1");
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_PIECE_QUANTITY) { onError(`Quantity is a whole number of pieces, 1 to ${MAX_PIECE_QUANTITY}`); return; }

    // A TYPO IN A NUMERIC BOX IS CAUGHT HERE, NOT SWALLOWED. sizeToMm answers
    // null for "1030 mm", "10,30" and an O typed for a nought exactly as it does
    // for an empty box, so a mistyped length used to be posted as no length at
    // all: the line stored sizeless, printed with a blank Length and a blank
    // Sqft, and the sheet's TOTAL was short by that line's whole area. The route
    // refuses it now too (parsePiece); this says so before the round trip.
    // A thousands comma is a figure, not a typo — the same reading the rules
    // give it (pieces-rules figure), so the screen and the route never disagree
    // about what counts as a number.
    const num = (raw: string): number | null => {
      const v = raw.trim();
      return v === "" ? null : Number(v.replace(/,/g, ""));
    };
    const sizes: Array<[string, string]> = [["Length", draft.length], ["Width", draft.width], ["Thickness", draft.thickness]];
    for (const [what, raw] of sizes) {
      const n = num(raw);
      if (n === null) continue;
      if (!Number.isFinite(n)) { onError(`${what} must be a number of ${unit} — "${raw.trim()}" is not`); return; }
      if (n <= 0) { onError(`${what} must be more than nought ${unit}`); return; }
    }
    for (const [what, raw] of [["Sqft", draft.sqft], ["Weight", draft.weightKg]] as Array<[string, string]>) {
      const n = num(raw);
      if (n !== null && !Number.isFinite(n)) { onError(`${what} must be a number — "${raw.trim()}" is not`); return; }
    }

    const ok = await onAdd({
      crateNo: draft.crateNo, drawingNo: draft.drawingNo, pieceNo: draft.pieceNo, design: draft.design,
      lengthMm: sizeToMm(draft.length, unit), widthMm: sizeToMm(draft.width, unit), thicknessMm: sizeToMm(draft.thickness, unit),
      // Left blank the area is worked out from the size and the quantity; typed,
      // it is kept exactly as typed, because the sheet in his hand is the source
      // of truth for a figure he has already worked out.
      sqft: draft.sqft.trim() === "" ? null : draft.sqft,
      quantity: qty, room: draft.room, weightKg: draft.weightKg.trim() === "" ? null : draft.weightKg,
    });
    // The crate, the drawing and the building carry down the sheet: the next
    // line is nearly always the same crate. Only what identifies the piece is
    // cleared.
    if (ok) setDraft((d) => ({ ...d, pieceNo: "", design: "", length: "", width: "", sqft: "", quantity: "1" }));
  };

  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <>
      {pieces.length === 0 ? <Empty>No cut-to-size line on this list yet.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-2">Crate</th>
                <th className="py-2 pr-2">Drawing</th>
                <th className="py-2 pr-2">Piece</th>
                <th className="py-2 pr-2">Design</th>
                <th className="py-2 pr-2">L {unit}</th>
                <th className="py-2 pr-2">W {unit}</th>
                <th className="py-2 pr-2">T {unit}</th>
                <th className="py-2 pr-2 text-right">Sqft</th>
                <th className="py-2 pr-2 text-right">Qty</th>
                <th className="py-2 pr-2">Building</th>
                <th className="py-2 pr-2 text-right">Weight kg</th>
                {editable && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sheet.rows.map((r, i) => {
                if (r.kind === "subtotal") {
                  return (
                    <tr key={`sub-${r.crateNo ?? "none"}-${i}`} className="bg-gray-50 text-xs font-medium text-gray-600">
                      <td className="py-1.5 pr-2" colSpan={7}>
                        {r.crateNo ? `Crate ${r.crateNo}` : "Not in a crate"} — {r.lines} line(s)
                      </td>
                      <td className="py-1.5 pr-2 text-right">{r.sqft.toFixed(3)}</td>
                      <td className="py-1.5 pr-2 text-right">{r.pieces}</td>
                      <td className="py-1.5 pr-2" />
                      <td className="py-1.5 pr-2 text-right">{r.weightKg == null ? "—" : r.weightKg.toFixed(2)}</td>
                      {editable && <td />}
                    </tr>
                  );
                }
                const p = byId.get(r.id);
                if (!p) return null;
                return (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-2 w-16"><Cell value={p.crateNo ?? ""} disabled={!editable} onCommit={(v) => onPatch(r.id, { crateNo: v })} /></td>
                    <td className="py-1.5 pr-2 w-24"><Cell value={p.drawingNo ?? ""} disabled={!editable} onCommit={(v) => onPatch(r.id, { drawingNo: v })} /></td>
                    <td className="py-1.5 pr-2 w-20"><Cell value={p.pieceNo ?? ""} disabled={!editable} onCommit={(v) => onPatch(r.id, { pieceNo: v })} /></td>
                    <td className="py-1.5 pr-2"><Cell value={p.design} disabled={!editable} onCommit={(v) => onPatch(r.id, { design: v })} /></td>
                    <td className="py-1.5 pr-2 w-16"><Cell value={showSize(p.lengthMm)} disabled={!editable} onCommit={(v) => commitSize(r.id, "lengthMm", v)} /></td>
                    <td className="py-1.5 pr-2 w-16"><Cell value={showSize(p.widthMm)} disabled={!editable} onCommit={(v) => commitSize(r.id, "widthMm", v)} /></td>
                    <td className="py-1.5 pr-2 w-16"><Cell value={showSize(p.thicknessMm)} disabled={!editable} onCommit={(v) => commitSize(r.id, "thicknessMm", v)} /></td>
                    <td className="py-1.5 pr-2 w-20"><Cell value={n3(p.sqft)} disabled={!editable} onCommit={(v) => onPatch(r.id, { sqft: v === "" ? null : v })} /></td>
                    <td className="py-1.5 pr-2 w-16"><Cell value={String(p.quantity)} disabled={!editable} onCommit={(v) => onPatch(r.id, { quantity: v })} /></td>
                    <td className="py-1.5 pr-2 w-28"><Cell value={p.room ?? ""} disabled={!editable} onCommit={(v) => onPatch(r.id, { room: v })} /></td>
                    <td className="py-1.5 pr-2 w-20"><Cell value={n3(p.weightKg)} disabled={!editable} onCommit={(v) => onPatch(r.id, { weightKg: v === "" ? null : v })} /></td>
                    {editable && (
                      <td className="py-1.5 text-right">
                        <button type="button" className={btnDanger} disabled={busy} onClick={() => onRemove(r.id)}>Remove</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              <tr className="border-t-2 border-gray-300 text-sm font-semibold text-gray-800">
                <td className="py-2 pr-2" colSpan={7}>TOTAL — {sheet.totals.lines} line(s)</td>
                <td className="py-2 pr-2 text-right">{sheet.totals.sqft.toFixed(3)}</td>
                <td className="py-2 pr-2 text-right">{sheet.totals.pieces}</td>
                <td className="py-2 pr-2" />
                <td className="py-2 pr-2 text-right">{sheet.totals.weightKg == null ? "—" : sheet.totals.weightKg.toFixed(2)}</td>
                {editable && <td />}
              </tr>
            </tbody>
          </table>
          {sheet.totals.weightKg == null && sheet.hasWeights && (
            <p className="mt-2 text-xs text-amber-700">
              Some lines have no weight, so there is no total: a weight that counts an unweighed line as nought kilograms understates the shipment.
            </p>
          )}
        </div>
      )}

      {editable && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Add a cut-to-size line</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <div><label className={label} htmlFor="p-crate">Crate no.</label><input id="p-crate" className={inp} value={draft.crateNo} onChange={set("crateNo")} /></div>
            <div><label className={label} htmlFor="p-drawing">Drawing no.</label><input id="p-drawing" className={inp} value={draft.drawingNo} onChange={set("drawingNo")} /></div>
            <div><label className={label} htmlFor="p-piece">Piece no.</label><input id="p-piece" className={inp} value={draft.pieceNo} onChange={set("pieceNo")} /></div>
            <div className="col-span-2"><label className={label} htmlFor="p-design">Design / material</label><input id="p-design" className={inp} value={draft.design} onChange={set("design")} placeholder="CPKT12412A" /></div>
            <div><label className={label} htmlFor="p-room">Building / area</label><input id="p-room" className={inp} value={draft.room} onChange={set("room")} placeholder="KITCHEN" /></div>
            <div><label className={label} htmlFor="p-l">Length ({unit})</label><input id="p-l" className={inp} inputMode="decimal" value={draft.length} onChange={set("length")} /></div>
            <div><label className={label} htmlFor="p-w">Width ({unit})</label><input id="p-w" className={inp} inputMode="decimal" value={draft.width} onChange={set("width")} /></div>
            <div><label className={label} htmlFor="p-t">Thick ({unit})</label><input id="p-t" className={inp} inputMode="decimal" value={draft.thickness} onChange={set("thickness")} /></div>
            <div><label className={label} htmlFor="p-qty">Qty (pcs)</label><input id="p-qty" className={inp} inputMode="numeric" value={draft.quantity} onChange={set("quantity")} /></div>
            <div><label className={label} htmlFor="p-sqft">Sqft</label><input id="p-sqft" className={inp} inputMode="decimal" value={draft.sqft} onChange={set("sqft")} placeholder="from the size" /></div>
            <div><label className={label} htmlFor="p-kg">Weight (kg)</label><input id="p-kg" className={inp} inputMode="decimal" value={draft.weightKg} onChange={set("weightKg")} /></div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className={btn} disabled={busy || !draft.design.trim()} onClick={addLine}>Add line</button>
            <p className="text-xs text-gray-400">
              Sizes are typed in {unit} and stored in millimetres. Leave Sqft blank and it is worked out from the size and the quantity.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
