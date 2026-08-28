"use client";

// THE GRAPHICAL PIECE. Click a side, the feet and the rupees move.
//
// The owner asked for exactly this: "we show them a graphical piece, they
// choose sides, and feet is calculated and paid." So the control IS the piece —
// a rectangle drawn to the row's proportions with four clickable edges — and
// not four checkboxes labelled front/back/left/right. A fabricator points at a
// side; he does not read a list and translate.
//
//        ┌──── back ────┐        front and back run the LENGTH
//   left │   28 × 22.5  │ right  left and right run the WIDTH
//        └──── front ───┘
//
// ONE PICKER PER ORDERED ROW, because "same row all have same". Every piece of
// row A is the same size and gets the same treatment; a picker per piece would
// be sixty identical decisions.
//
// ─────────────────────── AND ONLY ON ROWS THAT REACH FABRICATION ────────────
// The owner: "this part is only for the sink cut pieces — the fabrication,
// pieces only which can come to fabrication."
//
// Edge work IS fabrication work, and requirement-derive.ts has always encoded
// it: `fabricationRequired = sinkRequired`, because "fabrication here means the
// outsourced hand-polish of the sink cutout, so it never applies to a piece
// without a sink". A row with no sinks never reaches the fabricator, so this
// board does not offer it a decision — showing one would invite a supervisor to
// mark edges that nobody will polish and nobody will pay for.
//
// The feet follow the same rule: priceRow counts them over the SINK pieces, so
// a row of 60 with 30 sinks is 30 pieces' worth of edge, not 60. The picker
// prints that count beside the figure, because "252.5 ft" on a row of sixty
// only makes sense once you can see it is thirty pieces.
//
// SET THE SINKS FIRST. Step 3 is above this one for that reason: until a row
// has a sink count it is not a fabrication row and there is nothing to price.
//
// EVERY NUMBER COMES FROM lib/fab/pricing.ts. Nothing is computed in this file
// — same rule as CeoOverviewBoard — so the feet the supervisor sees while
// choosing and the feet the CEO board bills from are the same function, and
// cannot drift into two answers for one row.
//
// ─────────────────────────────────── NOT CHOSEN IS NOT ZERO ─────────────────
// null means nobody has looked at this row; an empty selection means somebody
// looked and said no edge work. Both cost nothing today and they are different
// facts, so the picker shows them differently — an untouched row says "Not
// chosen yet" in amber, and Clear puts a row BACK to that state rather than
// storing "none". See the route for why the column is nullable.

import { useCallback, useMemo, useState } from "react";
import {
  EDGES, ALL_EDGES, parseEdges, serializeEdges, describeEdges, edgeCount,
  priceRow, runningFeet, formatRupees, thicknessLabel,
  type Edge, type EdgeSelection,
} from "@/lib/fab/pricing";

export interface EdgePickerRow {
  requirementId: string;
  /** "A", "B" — what every piece of this row is named after. */
  pieceLabel: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  /** Pieces ORDERED on this row. The charge is the whole row's, not this
   *  slab's share — the edges get polished once, wherever the pieces are cut. */
  orderedQuantity: number;
  /** fab_requirement.sink_quantity, so the row's total reads in full. */
  sinkQuantity: number | null;
  /** fab_requirement.finished_edges. NULL = not chosen yet. */
  finishedEdges: string | null;
  /** MILLIMETRES — the stone this row is cut from. Decides the rate: 2 cm is
   *  ₹15/ft, 3 cm is ₹20/ft, anything else is not on the card and is reported
   *  unpriced rather than charged at a neighbour's rate. */
  thicknessMm: number | null;
}

async function postJson(url: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data?.error ?? `Save failed (${res.status}).`) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach the server — the change was not saved." };
  }
}

/* -- the drawing ----------------------------------------------------------- */

const ON = "bg-indigo-500 hover:bg-indigo-600";
const OFF = "bg-slate-200 hover:bg-slate-300";

/**
 * The piece, drawn to its own proportions.
 *
 * Clamped to between 1:2 and 2:1 of the box: a 96 × 4 in windowsill drawn
 * truly would be a hairline with untappable edges. The dimensions are printed
 * in the middle, so the drawing is a control and the text is the truth.
 */
function PieceDiagram({
  lengthIn, widthIn, edges, onToggle, disabled,
}: {
  lengthIn: number | null;
  widthIn: number | null;
  edges: EdgeSelection;
  onToggle: (e: Edge) => void;
  disabled: boolean;
}) {
  const l = Number(lengthIn) > 0 ? Number(lengthIn) : 1;
  const w = Number(widthIn) > 0 ? Number(widthIn) : 1;
  const ratio = Math.min(2, Math.max(0.5, w / l));
  const boxW = 168;
  const boxH = Math.round(boxW * ratio);

  const band = "absolute transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const label = (e: Edge) => `${e} edge — ${edges[e] ? "polished, click to remove" : "not polished, click to add"}`;

  return (
    <div className="relative shrink-0" style={{ width: boxW, height: boxH }}>
      {/* the stone */}
      <div className="absolute inset-[10px] rounded bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
        <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
          {lengthIn ?? "?"} × {widthIn ?? "?"}
        </span>
        <span className="text-[9px] text-slate-400">inches</span>
      </div>

      {/* back — runs the LENGTH, along the top */}
      <button type="button" aria-label={label("back")} aria-pressed={!!edges.back}
        title={label("back")} disabled={disabled} onClick={() => onToggle("back")}
        className={`${band} left-[10px] right-[10px] top-0 h-[8px] ${edges.back ? ON : OFF}`} />
      {/* front — runs the LENGTH, along the bottom */}
      <button type="button" aria-label={label("front")} aria-pressed={!!edges.front}
        title={label("front")} disabled={disabled} onClick={() => onToggle("front")}
        className={`${band} left-[10px] right-[10px] bottom-0 h-[8px] ${edges.front ? ON : OFF}`} />
      {/* left — runs the WIDTH */}
      <button type="button" aria-label={label("left")} aria-pressed={!!edges.left}
        title={label("left")} disabled={disabled} onClick={() => onToggle("left")}
        className={`${band} top-[10px] bottom-[10px] left-0 w-[8px] ${edges.left ? ON : OFF}`} />
      {/* right — runs the WIDTH */}
      <button type="button" aria-label={label("right")} aria-pressed={!!edges.right}
        title={label("right")} disabled={disabled} onClick={() => onToggle("right")}
        className={`${band} top-[10px] bottom-[10px] right-0 w-[8px] ${edges.right ? ON : OFF}`} />
    </div>
  );
}

/* -- one row --------------------------------------------------------------- */

export function EdgePicker({
  row, busy: parentBusy = false, onChange,
}: {
  row: EdgePickerRow;
  busy?: boolean;
  /** Every save, optimistic and confirmed. The caller holds the rows and must
   *  apply it to EVERY slab the requirement sits on — the decision is the
   *  ROW'S, so the same row under slab 4 has just changed too. */
  onChange: (requirementId: string, finishedEdges: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = parentBusy || saving;

  const chosen = row.finishedEdges !== null;
  const edges = useMemo(() => parseEdges(row.finishedEdges), [row.finishedEdges]);

  const priced = useMemo(() => priceRow({
    lengthIn: row.lengthIn,
    widthIn: row.widthIn,
    quantity: row.orderedQuantity,
    sinkQuantity: row.sinkQuantity,
    thicknessMm: row.thicknessMm,
    edges,
  }), [row.lengthIn, row.widthIn, row.orderedQuantity, row.sinkQuantity, row.thicknessMm, edges]);

  /** All four edges on the same FABRICATION pieces — what this row would come
   *  to at most. Measured over priced.fabricationPieces, not the ordered
   *  quantity, or the comparison would be against a number nobody will ever be
   *  charged. */
  const feetAllFour = useMemo(
    () => runningFeet(row.lengthIn, row.widthIn, priced.fabricationPieces, ALL_EDGES),
    [row.lengthIn, row.widthIn, priced.fabricationPieces],
  );

  const save = useCallback(async (next: EdgeSelection | null) => {
    const previousStored = row.finishedEdges;
    const nextStored = next === null ? null : serializeEdges(next);
    if (previousStored === nextStored) return;

    setError(null);
    setSaving(true);
    onChange(row.requirementId, nextStored);          // optimistic

    const res = await postJson("/api/fab/supervisor/finished-edges", {
      requirementId: row.requirementId,
      edges: next === null ? null : EDGES.filter((e) => next[e]),
    });

    if (!res.ok) {
      // Back exactly where it was. A picker left showing an edge the database
      // does not have is an invoice nobody agreed to.
      onChange(row.requirementId, previousStored);
      setError(res.error);
      setSaving(false);
      return;
    }
    // Believe the server's canonical string, not the one we sent.
    const saved = typeof res.data?.finishedEdges === "string" || res.data?.finishedEdges === null
      ? (res.data.finishedEdges as string | null)
      : nextStored;
    onChange(row.requirementId, saved);
    setSaving(false);
  }, [row.requirementId, row.finishedEdges, onChange]);

  const toggle = useCallback((e: Edge) => {
    // A first click on an untouched row starts from nothing, not from all four:
    // the click itself is the choice, and defaulting to four would charge for
    // three edges nobody picked.
    save({ ...edges, [e]: !edges[e] });
  }, [edges, save]);

  const n = edgeCount(edges);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-start gap-4 flex-wrap">
        <PieceDiagram
          lengthIn={row.lengthIn} widthIn={row.widthIn}
          edges={edges} onToggle={toggle} disabled={busy}
        />

        <div className="min-w-[13rem] flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-slate-800">
              {row.pieceLabel ?? "Row"}
            </span>
            <span className="text-[11px] text-slate-400">
              {/* BOTH counts, always. "252.5 ft" on a row of sixty is only
                  readable once you can see it is the thirty sink pieces. */}
              {priced.fabricationPieces} of {row.orderedQuantity} pc{row.orderedQuantity === 1 ? "" : "s"} to
              fabrication &middot; {thicknessLabel(row.thicknessMm)}
            </span>
            {!chosen && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                Not chosen yet
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 mt-1">
            {chosen ? describeEdges(edges) : "Nobody has marked this row's edges"}
            {chosen && n > 0 && n < EDGES.length && (
              <span className="text-slate-400"> &middot; {n} of 4</span>
            )}
          </p>

          {/* the money, live */}
          <div className="mt-2 text-xs tabular-nums">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Running feet</span>
              <span className="font-semibold text-slate-800">
                {priced.runningFeet} ft
                {n > 0 && n < EDGES.length && (
                  <span className="text-slate-400 font-normal"> of {feetAllFour} all round</span>
                )}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {describeEdges(edges) === "None" ? "no edges" : describeEdges(edges).toLowerCase()} on{" "}
              {priced.fabricationPieces} piece{priced.fabricationPieces === 1 ? "" : "s"}
            </div>
            {priced.unpriced ? (
              <p className="mt-1 text-[11px] text-amber-700">
                {thicknessLabel(row.thicknessMm)} is not on the rate card (2 cm and 3 cm are) —
                the feet are right, the charge has to be agreed.
              </p>
            ) : (
              <>
                <div className="flex justify-between gap-4 mt-0.5">
                  <span className="text-slate-500">
                    Edge work &middot; {formatRupees(priced.rate!.edgePerFoot)}/ft
                  </span>
                  <span className="font-semibold text-slate-800">{formatRupees(priced.edgeCost)}</span>
                </div>
                {priced.sinkPieces > 0 && (
                  <div className="flex justify-between gap-4 mt-0.5">
                    <span className="text-slate-500">
                      Sinks &middot; {priced.sinkPieces} × {formatRupees(priced.rate!.sinkPerPiece)}
                    </span>
                    <span className="font-semibold text-slate-800">{formatRupees(priced.sinkCost)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-slate-100">
                  <span className="text-slate-600 font-medium">Row total</span>
                  <span className="font-bold text-indigo-700">{formatRupees(priced.total)}</span>
                </div>
              </>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button type="button" disabled={busy || n === EDGES.length}
              onClick={() => save(ALL_EDGES)}
              className="text-[11px] font-semibold px-2 py-1 rounded border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition">
              All four
            </button>
            <button type="button" disabled={busy || (chosen && n === 0)}
              onClick={() => save({})}
              className="text-[11px] font-semibold px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              No edges
            </button>
            {chosen && (
              // Back to "nobody has chosen". Not the same as "no edges", and the
              // only way to undo having looked at a row by mistake.
              <button type="button" disabled={busy} onClick={() => save(null)}
                title="Put this row back to 'not chosen' — different from 'no edges'"
                className="text-[11px] px-2 py-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-40 transition">
                Clear
              </button>
            )}
            {saving && <span className="text-[11px] text-slate-400">Saving…</span>}
          </div>

          {error && (
            <p className="mt-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* -- all the rows on one slab ---------------------------------------------- */

export function EdgeBoard({
  rows, busy = false, onChange,
}: {
  rows: EdgePickerRow[];
  busy?: boolean;
  onChange: (requirementId: string, finishedEdges: string | null) => void;
}) {
  // ONLY THE ROWS THAT REACH FABRICATION. fabricationRequired = sinkRequired,
  // so a row with no sink count is not shown a picker at all — see the note at
  // the top of the file. The plain rows are COUNTED and named below rather than
  // silently dropped: a supervisor looking for row C needs to be told why it is
  // not here, or he will think the board is broken.
  const fabRows = rows.filter((r) => (r.sinkQuantity ?? 0) > 0);
  const plainRows = rows.filter((r) => (r.sinkQuantity ?? 0) <= 0);
  const unchosen = fabRows.filter((r) => r.finishedEdges === null).length;

  if (rows.length === 0) {
    return <p className="text-[11px] text-slate-400">Put pieces on this slab first — edges are marked per ordered row.</p>;
  }

  if (fabRows.length === 0) {
    return (
      <p className="text-[11px] text-slate-500">
        No row on this slab goes to fabrication yet. Edge work is the hand-polish that
        comes with a sink cutout, so a row is only asked about its edges once it has a
        sink count — set those in step 3 above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {unchosen > 0 && (
        <p className="text-[11px] text-amber-700">
          {unchosen} fabrication row{unchosen === 1 ? " has" : "s have"} no edge decision yet —
          reported as unpriced, not as free.
        </p>
      )}
      {fabRows.map((r) => (
        <EdgePicker key={r.requirementId} row={r} busy={busy} onChange={onChange} />
      ))}
      {plainRows.length > 0 && (
        <p className="text-[11px] text-slate-400">
          {plainRows.length} row{plainRows.length === 1 ? "" : "s"} not shown
          {" "}({plainRows.map((r) => r.pieceLabel ?? "?").join(", ")}) — no sinks, so
          {plainRows.length === 1 ? " it does" : " they do"} not go to fabrication and
          {plainRows.length === 1 ? " carries" : " carry"} no edge charge.
        </p>
      )}
    </div>
  );
}
