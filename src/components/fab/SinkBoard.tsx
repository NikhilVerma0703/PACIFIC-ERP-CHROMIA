"use client";

// SINK ASSIGNMENT — the board, extracted so it can sit UNDER one slab's pieces.
//
// This is the board the owner described, unchanged in behaviour and moved here
// whole out of the standalone /fab/supervisor/sinks page:
//
//   * ONE COLUMN to begin with. Every piece row it is given: the piece, its
//     dimensions, its quantities.
//   * CLICKING A ROW SENDS IT RIGHT. So does dragging it. Both, because the
//     shop floor uses tablets and gloves and a drag is not always possible.
//   * THE SINK COLUMN APPEARS on the first assignment. It is not there before,
//     and it VANISHES again when the last row leaves it — an empty Sink column
//     left on screen asserts "these have no sinks" about pieces nobody has
//     looked at yet.
//   * FULL QUANTITY IS THE DEFAULT when a row moves across. A partial move —
//     3 of the 10 — splits the row so both columns show their share.
//   * IT SAVES ON EVERY CLICK. There is no save button and there is nothing to
//     remember to press.
//   * UNDO, and dragging back, both work.
//
// AND IT STARTS EMPTY ON THE RIGHT. Nothing is pre-filled — not from the piece
// width, not from the old sink_cuts column, not from anything. fab_requirement
// .sink_quantity is NULL until the supervisor touches the row, and NULL means
// "not looked at yet" rather than "none", which is why undo can put it back.
//
// TWO NUMBERS ON EVERY ROW, AND THAT IS THE POINT OF THIS COMPONENT EXISTING.
// The decision is the ORDER ROW's, not the slab's. A requirement of 60 tops cut
// 12 to a slab shows "12 on this slab" — but marking it writes sink_quantity =
// 60, the full ordered quantity, and it is 60 on every other slab that row
// touches. A card that showed only the 12 while the click wrote 60 would be
// lying to the operator, so describeSlabSinkRow puts BOTH on every row, on both
// sides, and a row whose decision reaches past this slab says so out loud.
//
// IT DOES NOT OWN THE ROWS. The same requirement can be on more than one slab,
// and both boards have to move together — so the rows are a prop and every save
// is reported up through onSinkQuantityChange. What the board does own is the
// undo stack, the in-flight write, and which column is being dragged over.
//
// The rules about what belongs where live in lib/fab/sinkBoard.ts, pure and
// tested — including the one that decides whether the Sink column exists at all.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FabAlerts } from "@/components/fab/FabAlerts";
import { postJson } from "@/lib/fab/postJson";
import {
  defaultSinkQuantity, describeSlabSinkRow, resolveSlabSinkRow,
  slabPlainColumnRows, slabSinkColumnRows, slabSinkColumnVisible,
} from "@/lib/fab/sinkBoard";
import { describeRequirement } from "@/lib/fab/releasePlan";

/* -- Types ----------------------------------------------------------------- */

/** One piece row on the slab being prepped. */
export interface SinkBoardRow {
  requirementId: string;
  poNumber: string | null;
  drawingNumber: string | null;
  pieceLabel: string | null;
  description: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  /** fab_requirement.quantity — how many were ORDERED. The sink decision is
   *  written against this, never against the slab's share. */
  orderedQuantity: number;
  /** fab_requirement.sink_quantity. NULL = not looked at yet. */
  sinkQuantity: number | null;
  /** This slab's share of the row — displayed, never written against. */
  onThisSlab: number;
}

/** One reversible move. `previous` is what sink_quantity was before — including
 *  NULL, which is a real state ("not looked at") and not the same as 0. */
interface Move {
  requirementId: string;
  previous: number | null;
  next: number | null;
}

const DRAG_TYPE = "text/plain";

function nameOf(r: SinkBoardRow): string {
  return describeRequirement({
    drawingNumber: r.drawingNumber,
    poNumber: r.poNumber,
    pieceLabel: r.pieceLabel,
    description: r.description,
  });
}

function dims(r: SinkBoardRow): string {
  if (r.lengthIn == null || r.widthIn == null) return "—";
  return `${r.lengthIn} × ${r.widthIn} in`;
}

/* -- One card -------------------------------------------------------------- */

function RowCard({
  row, side, boardId, shownQuantity, busy, onMove, onDragStart,
}: {
  row: SinkBoardRow;
  side: "plain" | "sink";
  /** Scopes the input ids: the same requirement can be on two slabs, so two
   *  boards on one page would otherwise emit the same id twice and the second
   *  <label htmlFor> would point at the first board's box. */
  boardId: string;
  /** The share of the row this column holds. */
  shownQuantity: number;
  busy: boolean;
  /** Absolute new sink quantity for the whole row. */
  onMove: (row: SinkBoardRow, sinkQuantity: number) => void;
  onDragStart: (requirementId: string) => void;
}) {
  const split = resolveSlabSinkRow({
    requirementId: row.requirementId,
    quantity: row.orderedQuantity,
    sinkQuantity: row.sinkQuantity,
    onThisSlab: row.onThisSlab,
  });
  const [partial, setPartial] = useState("");

  // Left card: how many MORE get a sink, defaulting to all that are left.
  // Right card: how many keep theirs, defaulting to what it holds now.
  const partialDefault = side === "plain" ? split.plainQuantity : split.sinkQuantity;
  const typed = partial === "" ? partialDefault : Number(partial);
  const partialTarget = side === "plain"
    ? split.sinkQuantity + (Number.isFinite(typed) ? typed : 0)
    : (Number.isFinite(typed) ? typed : split.sinkQuantity);
  const partialValid =
    Number.isFinite(typed) && typed >= 0 && partialTarget >= 0 && partialTarget <= split.quantity;

  const wholeTarget = side === "plain" ? defaultSinkQuantity(row.orderedQuantity) : 0;

  return (
    <li
      draggable={!busy}
      onDragStart={e => {
        e.dataTransfer.setData(DRAG_TYPE, row.requirementId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(row.requirementId);
      }}
      className={`rounded-xl border bg-white ${side === "sink" ? "border-orange-200" : "border-slate-200"}`}
    >
      {/* THE ROW ITSELF IS THE BUTTON. Clicking it moves the whole row across,
          which is the owner's "clicking a row sends it to the right side" — and
          being a real <button> it is reachable by Tab and fires on Enter and
          Space without any of the keyboard handling a div would need. */}
      <button
        type="button"
        onClick={() => onMove(row, wholeTarget)}
        disabled={busy}
        aria-label={
          side === "plain"
            ? `Give all ${split.quantity} ordered piece(s) of ${nameOf(row)} a sink. ${split.onThisSlab} of them are on this slab.`
            : `Take the sink off all ${split.sinkQuantity} piece(s) of ${nameOf(row)}. ${split.onThisSlab} of them are on this slab.`
        }
        className="w-full text-left px-4 py-3 hover:bg-slate-50 disabled:opacity-50 rounded-t-xl transition"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono font-bold text-sm text-slate-800">{nameOf(row)}</span>
          {/* LABELLED, not a bare count. This badge is the column's share of the
              ORDER ROW — 60 of the 60 ordered — while only 12 of them are on the
              slab he is looking at. "60 pcs" on a card sitting under a slab
              reads as sixty pieces on that slab, which is the exact confusion
              this whole component is arranged to prevent. */}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            side === "sink" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
            {shownQuantity} {side === "sink" ? "with sink" : "no sink"}
          </span>
        </span>
        <span className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
          <span>{dims(row)}</span>
          {/* BOTH QUANTITIES, from the pure function that pins the wording:
              "12 on this slab · 60 ordered · sink 60/60". */}
          <span>&middot; {describeSlabSinkRow({
            requirementId: row.requirementId,
            quantity: row.orderedQuantity,
            sinkQuantity: row.sinkQuantity,
            onThisSlab: row.onThisSlab,
          })}</span>
          {/* A split row is on BOTH sides, and says so on both. */}
          {split.split && (
            <span className="text-orange-600 font-semibold">
              &middot; split {split.sinkQuantity} with sink / {split.plainQuantity} without
            </span>
          )}
        </span>
        {/* The decision reaches past the slab in front of him. Ordinary, and
            said out loud, because his next click changes all of them. */}
        {split.appliesBeyondThisSlab && (
          <span className="block text-[11px] text-orange-700 mt-1">
            Covers {split.sinkQuantity - split.onThisSlab} piece(s) on other slabs — the sink is the order row&apos;s, not this slab&apos;s.
          </span>
        )}
        <span className="block text-[11px] text-indigo-600 mt-1">
          {side === "plain"
            ? `Click to give all ${split.quantity} ordered a sink →`
            : `← Click to take the sink off all ${split.sinkQuantity}`}
        </span>
      </button>

      <div className="flex items-end gap-2 px-4 pb-3 pt-1 border-t border-slate-50">
        <div>
          <label htmlFor={`p-${boardId}-${side}-${row.requirementId}`} className="block text-[10px] font-medium text-slate-400 mb-0.5">
            {side === "plain" ? "Or move only" : "Or keep only"}
          </label>
          <input
            id={`p-${boardId}-${side}-${row.requirementId}`}
            type="number"
            min={0}
            max={side === "plain" ? split.plainQuantity : split.sinkQuantity}
            value={partial}
            placeholder={String(partialDefault)}
            disabled={busy}
            onChange={e => setPartial(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && partialValid) { onMove(row, partialTarget); setPartial(""); }
            }}
            className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => { onMove(row, partialTarget); setPartial(""); }}
          disabled={busy || !partialValid || partialTarget === split.sinkQuantity}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40 transition"
        >
          {side === "plain" ? "Move these" : "Keep these"}
        </button>
      </div>
    </li>
  );
}

/* -- The board ------------------------------------------------------------- */

export function SinkBoard({
  boardId, slabLabel, projectId, rows, busy: parentBusy = false, onSinkQuantityChange,
}: {
  /** Scopes input ids and drop-zone labels — there is one board per slab card. */
  boardId: string;
  /** "Slab A-14", for the drop zones' accessible names. */
  slabLabel: string;
  /** The undo stack belongs to the project on screen: carrying it across a
   *  project change would let Undo write a quantity onto a row of the job the
   *  supervisor just left. */
  projectId: string;
  /** The rows on this slab, already scoped by the caller. */
  rows: SinkBoardRow[];
  /** The embedding page is mid-write; the board greys out with it. */
  busy?: boolean;
  /** Every save, optimistic and confirmed, is reported here. The caller holds
   *  the rows and must apply it to EVERY slab the requirement sits on. */
  onSinkQuantityChange: (requirementId: string, sinkQuantity: number | null) => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [history, setHistory] = useState<Move[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState<"plain" | "sink" | null>(null);

  const busy = parentBusy || saving;

  useEffect(() => { setHistory([]); }, [projectId]);

  /**
   * ONE MOVE, SAVED IMMEDIATELY.
   *
   * Optimistic: the row moves on screen first, because a board that waits for
   * the network before showing the change gets clicked twice. If the write
   * fails the row goes BACK to exactly where it was and the red banner says it
   * was not saved — the board never leaves a row sitting in a column the
   * database does not agree with, which is the failure that would send pieces
   * to sink-cutting that nobody asked for.
   */
  const move = useCallback(async (row: SinkBoardRow, next: number | null, remember = true) => {
    const previous = row.sinkQuantity ?? null;
    if (previous === next) return;

    setActionError(null);
    setSaving(true);
    onSinkQuantityChange(row.requirementId, next);

    const res = await postJson("/api/fab/supervisor/sink-quantity", {
      requirementId: row.requirementId,
      sinkQuantity: next,
    });

    if (!res.ok) {
      // Put it back. Nothing was written, so the screen must not keep showing
      // it as though something was.
      onSinkQuantityChange(row.requirementId, previous);
      setActionError(res.error);
      setSaving(false);
      return;
    }

    // Believe the server's number rather than the one we sent — it clamps.
    const saved = typeof res.data?.sinkQuantity === "number" ? res.data.sinkQuantity : next;
    onSinkQuantityChange(row.requirementId, saved);
    if (remember) setHistory(h => [...h, { requirementId: row.requirementId, previous, next: saved }]);
    setSaving(false);
  }, [onSinkQuantityChange]);

  async function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    const row = rows.find(r => r.requirementId === last.requirementId);
    if (!row) { setHistory(h => h.slice(0, -1)); return; }
    // `remember: false` — an undo is not itself an undoable move, or the button
    // would flip the same row back and forth forever.
    await move(row, last.previous, false);
    setHistory(h => h.slice(0, -1));
  }

  function onDrop(side: "plain" | "sink", e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const row = rows.find(r => r.requirementId === id);
    if (!row) return;
    // A drop takes the whole row, the same as a click on it. Partial splits are
    // typed, because no drag gesture can express "3 of the 10".
    move(row, side === "sink" ? defaultSinkQuantity(row.orderedQuantity) : 0);
  }

  const boardRows = useMemo(
    () => rows.map(r => ({
      requirementId: r.requirementId,
      quantity: r.orderedQuantity,
      sinkQuantity: r.sinkQuantity,
      onThisSlab: r.onThisSlab,
    })),
    [rows],
  );
  const byId = useMemo(() => new Map(rows.map(r => [r.requirementId, r])), [rows]);

  // THE ONE RULE THAT DECIDES WHETHER THERE IS A SECOND COLUMN AT ALL.
  const showSink = slabSinkColumnVisible(boardRows);
  const sinkRows = slabSinkColumnRows(boardRows);
  const plainRows = slabPlainColumnRows(boardRows);
  const sinkPieces = sinkRows.reduce((s, r) => s + r.sinkQuantity, 0);

  // Nothing on the slab yet. Say so in one line rather than standing an empty
  // two-column board in front of a step he cannot do yet.
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">
        Add piece rows to this slab first — then mark which of them need a sink.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">Sinks for the pieces on this slab</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Click or drag a row to give its pieces a sink — every change saves as you make it. The
            sink belongs to the order row, so marking one covers all of its ordered pieces, on every
            slab.
          </p>
        </div>
        <button
          type="button"
          onClick={undo}
          disabled={busy || history.length === 0}
          className="shrink-0 text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-300 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
          Undo{history.length ? ` (${history.length})` : ""}
        </button>
      </div>

      <FabAlerts actionError={actionError} onDismiss={() => setActionError(null)} noun="board" />

      <div className={`grid gap-4 ${showSink ? "grid-cols-2" : "grid-cols-1"}`}>
        {/* LEFT: everything without a sink. Also a drop target, so a row can
            be dragged back — and the same move is on every card as a button,
            so nothing here needs a mouse. */}
        <section
          aria-label={`Piece rows on ${slabLabel} without a sink`}
          onDragOver={e => { e.preventDefault(); setDragOver("plain"); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={e => onDrop("plain", e)}
          className={`rounded-2xl border p-3 transition ${
            dragOver === "plain" ? "border-indigo-400 bg-indigo-50/40" : "border-slate-200 bg-slate-50/40"}`}
        >
          <h4 className="text-xs font-bold text-slate-800 px-1 mb-2">
            Piece rows <span className="text-slate-400 font-normal">({plainRows.length})</span>
          </h4>
          {plainRows.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-1 py-8 text-center">
              Every row has a sink. Drag one back, or click it on the right.
            </p>
          ) : (
            <ul className="space-y-2">
              {plainRows.map(split => {
                const r = byId.get(split.requirementId);
                if (!r) return null;
                return (
                  <RowCard
                    key={r.requirementId}
                    row={r}
                    side="plain"
                    boardId={boardId}
                    shownQuantity={split.plainQuantity}
                    busy={busy}
                    onMove={move}
                    onDragStart={() => setDragOver(null)}
                  />
                );
              })}
            </ul>
          )}
        </section>

        {/* RIGHT: the Sink column. It does not exist until the first row is
            assigned, and it is gone again the moment the last one leaves —
            slabSinkColumnVisible() is the whole of that decision. */}
        {showSink && (
          <section
            aria-label={`Piece rows on ${slabLabel} with a sink`}
            onDragOver={e => { e.preventDefault(); setDragOver("sink"); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => onDrop("sink", e)}
            className={`rounded-2xl border p-3 transition ${
              dragOver === "sink" ? "border-orange-400 bg-orange-50/60" : "border-orange-200 bg-orange-50/30"}`}
          >
            <h4 className="text-xs font-bold text-orange-800 px-1 mb-2">
              Sink <span className="text-orange-400 font-normal">
                ({sinkRows.length} row{sinkRows.length === 1 ? "" : "s"} &middot; {sinkPieces} ordered piece{sinkPieces === 1 ? "" : "s"})
              </span>
            </h4>
            <ul className="space-y-2">
              {sinkRows.map(split => {
                const r = byId.get(split.requirementId);
                if (!r) return null;
                return (
                  <RowCard
                    key={r.requirementId}
                    row={r}
                    side="sink"
                    boardId={boardId}
                    shownQuantity={split.sinkQuantity}
                    busy={busy}
                    onMove={move}
                    onDragStart={() => setDragOver(null)}
                  />
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {!showSink && (
        <p className="mt-3 text-xs text-slate-400">
          No sinks on this slab yet. The Sink column appears as soon as you send the first row across.
        </p>
      )}
    </div>
  );
}
