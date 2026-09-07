"use client";

// THE GRAPHICAL PIECE. Click a side, the feet and the rupees move.
//
// The owner asked for exactly this: "we show them a graphical piece, they
// choose sides, and feet is calculated and paid." So the control IS the piece —
// drawn to the row's proportions with clickable edges — and not four checkboxes
// labelled front/back/left/right. A fabricator points at a side; he does not
// read a list and translate.
//
//        ┌──── back ────┐        front and back run the LENGTH
//   left │   28 × 22.5  │ right  left and right run the WIDTH
//        └──── front ───┘
//
// ONE PICKER PER ORDERED ROW, because "same row all have same". Every piece of
// row A is the same size and gets the same treatment; a picker per piece would
// be sixty identical decisions.
//
// ─────────────────────── THIS IS HAND EDGE POLISH, ON ITS OWN ───────────────
// AND THAT REVERSES WHAT THIS FILE USED TO SAY, deliberately.
//
// It used to refuse any row without a sink, on the rule
// `fabricationRequired = sinkRequired` — edge work was read as the hand-polish
// that came WITH a sink cutout, so a plain row was never offered a decision.
//
// The owner: "we choose the sink, there itself we need to choose the edge
// polish, which is NOT the polish of the operator. This edge polish is by hand,
// where we need the running foot length and charge by thickness." And: "any
// pieces can be assigned the edge hand polish or not — this is chosen and done
// by supervisor, or else the one manager who uploads the PO."
//
// So EVERY row gets a picker now. There are two hand jobs and only one of them
// is chosen here:
//
//   SINK POLISH   implied by the sink cut, priced inside the per-piece sink
//                 rate. Nobody chooses it and this control never mentions it.
//   EDGE POLISH   chosen here, on any row, sink or plain. Running feet at the
//                 thickness rate.
//
// The old refusal was not a safety rail, it was a leak: a plain row whose front
// edge the customer wanted polished could not be marked at all, and the shop
// did the work unpaid.
//
// ─────────────────────────────── CIRCLES AND OVALS ──────────────────────────
// "Regarding the cost, now it's like polish side only for a squares or rect,
// need to include circle, oval as well. Default is rect shape fine."
//
// A round piece has ONE edge. There are no sides to choose between, so the four
// bands become a single ring: polished or not. The drawing changes with it —
// showing a rectangle for a circle would invite somebody to pick "front" on a
// shape that has no front.
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
  EDGES, ALL_EDGES, ROUND_ALL, allEdgesFor, parseEdges, serializeEdges,
  describeEdges, edgeCount, edgeCapacity,
  priceRow, runningFeet, formatRupees, thicknessLabel,
  type Edge, type EdgeSelection,
} from "@/lib/fab/pricing";
import { isRound, parseShape, describeShapeSize, ROUND_EDGE } from "@/lib/fab/shape";

export interface EdgePickerRow {
  requirementId: string;
  /** "A", "B" — what every piece of this row is named after. */
  pieceLabel: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  /** Pieces ORDERED on this row. THE COUNT THE FEET ARE MEASURED OVER, since
   *  hand edge polish stopped following the sink: a row is homogeneous, so if
   *  its edges are marked, every piece of it is hand polished. */
  orderedQuantity: number;
  /** fab_requirement.sink_quantity — shown for context, no longer a gate. */
  sinkQuantity: number | null;
  /** fab_requirement.finished_edges. NULL = not chosen yet. */
  finishedEdges: string | null;
  /** MILLIMETRES — the stone this row is cut from. Decides the rate: 2 cm is
   *  ₹15/ft, 3 cm is ₹20/ft, anything else is not on the card and is reported
   *  unpriced rather than charged at a neighbour's rate. */
  thicknessMm: number | null;
  /** RECTANGLE / CIRCLE / OVAL. Null is a rectangle — every row written before
   *  shapes existed, which is nearly all of them. */
  shapeType?: string | null;
  /** TOP / BOTTOM / BOTH. Null is TOP; BOTH is the same line walked twice and
   *  DOUBLES the feet.
   *
   *  THIS WAS MISSING AND THIS CARD QUOTED HALF. The manager's PO card passed
   *  the face and this one did not, so one row read Rs15,150 there and Rs7,575
   *  here — against the whole rule that the two screens cannot hold different
   *  answers for one row. The board route has always sent it. */
  edgeFaces?: string | null;
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

/**
 * THE ROUND PIECE — one edge, one click.
 *
 * A circle has no sides, so this is not four bands with three disabled: it is a
 * ring that is polished or is not. Drawn as an ellipse to the row's own axes so
 * an oval reads as an oval, and its ring IS the button — the same "point at the
 * thing" gesture the rectangle asks for.
 */
function RoundDiagram({
  shape, lengthIn, widthIn, on, onToggle, disabled,
}: {
  shape: string;
  lengthIn: number | null;
  widthIn: number | null;
  on: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const circle = parseShape(shape) === "CIRCLE";
  const a = Number(lengthIn) > 0 ? Number(lengthIn) : 1;
  // A circle's width is its diameter, whatever the column happens to hold.
  const b = circle ? a : (Number(widthIn) > 0 ? Number(widthIn) : 1);
  const ratio = Math.min(2, Math.max(0.5, b / a));
  const boxW = 168;
  const boxH = Math.round(boxW * ratio);

  const label = on
    ? "Whole edge polished — click to remove"
    : "Edge not polished — click to polish the whole edge";

  return (
    <button
      type="button" onClick={onToggle} disabled={disabled}
      aria-label={label} aria-pressed={on} title={label}
      className="relative shrink-0 disabled:opacity-50 disabled:cursor-not-allowed group"
      style={{ width: boxW, height: boxH }}
    >
      <svg viewBox={`0 0 ${boxW} ${boxH}`} width={boxW} height={boxH} className="overflow-visible">
        <ellipse
          cx={boxW / 2} cy={boxH / 2}
          rx={boxW / 2 - 6} ry={boxH / 2 - 6}
          className={on
            ? "fill-slate-50 stroke-indigo-500 group-hover:stroke-indigo-600"
            : "fill-slate-50 stroke-slate-300 group-hover:stroke-slate-400"}
          strokeWidth={on ? 8 : 5}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
          {describeShapeSize(shape, { lengthIn, widthIn })}
        </span>
        <span className="text-[9px] text-slate-400">{circle ? "circle" : "oval"}</span>
      </span>
    </button>
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

  const shape = row.shapeType ?? "RECTANGLE";
  const round = isRound(shape);
  const capacity = edgeCapacity(shape);

  const chosen = row.finishedEdges !== null;
  const edges = useMemo(() => parseEdges(row.finishedEdges), [row.finishedEdges]);

  const priced = useMemo(() => priceRow({
    lengthIn: row.lengthIn,
    widthIn: row.widthIn,
    quantity: row.orderedQuantity,
    sinkQuantity: row.sinkQuantity,
    thicknessMm: row.thicknessMm,
    edges,
    shape,
    edgeFace: row.edgeFaces,
  }), [row.lengthIn, row.widthIn, row.orderedQuantity, row.sinkQuantity, row.thicknessMm, edges, shape, row.edgeFaces]);

  /** Every edge on the whole row — what this row would come to at most.
   *  Measured over the ORDERED quantity, because that is what it would actually
   *  be: hand edge polish applies to the whole row or none of it. */
  const feetAll = useMemo(
    () => runningFeet(row.lengthIn, row.widthIn, row.orderedQuantity, allEdgesFor(shape), shape, row.edgeFaces),
    [row.lengthIn, row.widthIn, row.orderedQuantity, shape, row.edgeFaces],
  );

  const save = useCallback(async (next: EdgeSelection | null) => {
    const previousStored = row.finishedEdges;
    const nextStored = next === null ? null : serializeEdges(next);
    if (previousStored === nextStored) return;

    setError(null);
    setSaving(true);
    onChange(row.requirementId, nextStored);          // optimistic

    // The wire form is a list of edge names — the four side names for a
    // rectangle, or the single word "round". The route validates against the
    // ROW'S shape and refuses the other vocabulary, so a stale screen cannot
    // write "front" onto a circle.
    const wire = next === null
      ? null
      : round
        ? (next.round ? [ROUND_EDGE] : [])
        : EDGES.filter((e) => next[e]);

    const res = await postJson("/api/fab/supervisor/finished-edges", {
      requirementId: row.requirementId,
      edges: wire,
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
  }, [row.requirementId, row.finishedEdges, round, onChange]);

  const toggle = useCallback((e: Edge) => {
    // A first click on an untouched row starts from nothing, not from all four:
    // the click itself is the choice, and defaulting to four would charge for
    // three edges nobody picked.
    save({ ...edges, [e]: !edges[e] });
  }, [edges, save]);

  const toggleRound = useCallback(() => {
    save(edges.round ? {} : { ...ROUND_ALL });
  }, [edges, save]);

  const n = edgeCount(edges, shape);
  const description = describeEdges(edges, shape);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-start gap-4 flex-wrap">
        {round ? (
          <RoundDiagram
            shape={shape} lengthIn={row.lengthIn} widthIn={row.widthIn}
            on={!!edges.round} onToggle={toggleRound} disabled={busy}
          />
        ) : (
          <PieceDiagram
            lengthIn={row.lengthIn} widthIn={row.widthIn}
            edges={edges} onToggle={toggle} disabled={busy}
          />
        )}

        <div className="min-w-[13rem] flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-slate-800">
              {row.pieceLabel ?? "Row"}
            </span>
            <span className="text-[11px] text-slate-400">
              {/* THE WHOLE ROW is hand polished when its edges are marked — a
                  row is homogeneous. The sink count sits beside it as context,
                  not as a gate, because the two jobs are independent now. */}
              {row.orderedQuantity} pc{row.orderedQuantity === 1 ? "" : "s"}
              {priced.sinkPieces > 0 && ` · ${priced.sinkPieces} with a sink`}
              {" · "}{thicknessLabel(row.thicknessMm)}
            </span>
            {!chosen && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                Not chosen yet
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 mt-1">
            {chosen ? description : "Nobody has marked this row's edges"}
            {chosen && n > 0 && n < capacity && (
              <span className="text-slate-400"> &middot; {n} of {capacity}</span>
            )}
          </p>

          {/* the money, live */}
          <div className="mt-2 text-xs tabular-nums">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Running feet</span>
              <span className="font-semibold text-slate-800">
                {priced.runningFeet} ft
                {n > 0 && n < capacity && (
                  <span className="text-slate-400 font-normal"> of {feetAll} all round</span>
                )}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {description === "None" ? "no edges" : description.toLowerCase()} on{" "}
              {priced.edgePieces} piece{priced.edgePieces === 1 ? "" : "s"}
              {/* NAMED, because 1,010 ft on a row of 505 ft of edge is otherwise
                  an arithmetic error to anybody reading it. */}
              {priced.edgeFace === "BOTH" && (
                <span className="text-amber-700 font-semibold"> &middot; both faces, walked twice</span>
              )}
              {priced.edgeFace === "BOTTOM" && <span> &middot; bottom face</span>}
            </div>
            {priced.unpriced ? (
              // THREE DIFFERENT HOLES, and one amber line for all of them sent
              // everyone to argue about the rate card when the real problem was a
              // blank width. Each line names the person who can fix it.
              priced.unpricedReason === "EDGES" ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  This row names edges the shape does not have — a circle has one
                  ring, a rectangle has four sides. Re-pick the edges for the shape
                  above and the charge appears.
                </p>
              ) : priced.unpricedReason === "SHAPE" ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  This row is an L, a curve or a custom outline. There is no perimeter
                  formula for it here, so the hand polish has to be quoted by hand —
                  the sink, if any, is charged as usual.
                </p>
              ) : priced.unpricedReason === "DIMENSIONS" ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  {round
                    ? `This row has no ${parseShape(shape) === "CIRCLE" ? "diameter" : "axes"} on the order, so there is no perimeter to charge.`
                    : "The edges marked here run along a dimension the order does not give."}
                  {" "}Enter the size on the purchase-order row and the charge appears.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-amber-700">
                  {thicknessLabel(row.thicknessMm)} is not on the rate card (2 cm and 3 cm are) —
                  the feet are right, the charge has to be agreed.
                </p>
              )
            ) : (
              <>
                <div className="flex justify-between gap-4 mt-0.5">
                  <span className="text-slate-500">
                    Hand edge polish &middot; {formatRupees(priced.rate!.edgePerFoot)}/ft
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
            <button type="button" disabled={busy || n === capacity}
              onClick={() => save(allEdgesFor(shape))}
              className="text-[11px] font-semibold px-2 py-1 rounded border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition">
              {round ? "Whole edge" : "All four"}
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
  // EVERY ROW, NOT JUST THE SINK ONES.
  //
  // This board used to filter to `sinkQuantity > 0` and print a line explaining
  // why the rest were missing. That filter was the old rule made visible — edge
  // work followed the sink — and it hid exactly the rows the owner wanted
  // marked: "any pieces can be assigned the edge hand polish or not."
  //
  // A plain row whose front edge the customer wants polished is now here, and
  // it is worth money.
  const unchosen = rows.filter((r) => r.finishedEdges === null).length;

  if (rows.length === 0) {
    return <p className="text-[11px] text-slate-400">Put pieces on this slab first — edges are marked per ordered row.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        HAND edge polish — the outsourced running-foot job, not the machine polish at the
        polishing station. Any row can have it, with or without a sink. The sink&rsquo;s own
        polish is part of the sink and is not chosen here.
      </p>
      {unchosen > 0 && (
        <p className="text-[11px] text-amber-700">
          {unchosen} row{unchosen === 1 ? " has" : "s have"} no edge decision yet —
          reported as unpriced, not as free.
        </p>
      )}
      {rows.map((r) => (
        <EdgePicker key={r.requirementId} row={r} busy={busy} onChange={onChange} />
      ))}
    </div>
  );
}
