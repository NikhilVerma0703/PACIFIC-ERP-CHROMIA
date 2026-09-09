"use client";

// WHICH FACES, THEN WHICH SIDES OF EACH — the hand-polish specification, asked
// in the order the owner asks it.
//
//   "First select top only or any combo. Based on choice — like you click top
//    for a row you see the diagram to choose the side, then choose the bottom
//    you see for that, then if side you see for it."
//
// So it is TWO STEPS, not one grid:
//
//   1. FACE CHIPS      Top / Bottom / Side. Any combination. Nothing else is
//                      on screen until at least one is chosen.
//   2. ONE DIAGRAM     for the face you are currently editing, with the piece
//                      drawn to its own proportions and its sides clickable.
//                      Switch face, the diagram switches with it.
//
// ─────────────────────── WHY NOT A 3 x 4 GRID ───────────────────────────────
// Twelve checkboxes is the same information and a worse question. The owner
// thinks "top, all four — bottom, just the two long ones", one face at a time,
// and the grid asks him to hold three answers in his head at once while reading
// a matrix. One diagram at a time is the way the decision is actually made.
//
// ─────────────────────── AND THE COUNT IS ON THE CHIP ───────────────────────
// He asked to choose "the number of side for top, no of side for bottom, no of
// side for side", so the count is what the chip shows: TOP 4, BOTTOM 2.
//
// The count is DISPLAYED and the sides are STORED, and that difference is the
// whole reason this is a diagram and not three number boxes. On a 103 x 19.5 cm
// piece "two sides" is either 206 cm or 39 cm — five times apart — so a count
// alone cannot be charged by the foot. He gets the number he thinks in; the
// system gets the geometry it has to bill from.
//
// ─────────────────────── WHAT THE THREE FACES ARE ───────────────────────────
// TOP and BOTTOM are the two arrises of an edge — the lines where the face
// meets the band. SIDE is the band itself, the vertical thickness face, which
// is normally machine polished and is sometimes done by hand instead. Fully
// hand polished is all three on all four sides: three passes of the perimeter.
//
// EVERY NUMBER SHOWN HERE COMES FROM lib/fab/pricing.ts. Nothing is computed in
// this file — the same rule CeoOverviewBoard and EdgePicker already follow, so
// the feet a supervisor sees while choosing and the feet the CEO board bills
// from cannot become two answers to one question.

import { useMemo, useState } from "react";
import {
  POLISH_FACES, faceSideCounts, isRound, parseShape, describeShapeSize,
  type FaceEdges, type PolishFace, type EdgeSelection,
} from "@/lib/fab/shape";
import { EDGES, allEdgesFor, type Edge } from "@/lib/fab/pricing";
// scripts/0068 — the size AS THE CUSTOMER ORDERED IT, for the drawing caption.
import { formatDimension, parseDimUnit } from "@/lib/fab/dimensions";

/* -- the drawings ---------------------------------------------------------- *
 *
 * MOVED HERE FROM EdgePicker, which now imports them. Two copies of a control
 * that decides money is two controls that can disagree, and the supervisor's
 * card and the manager's card must not draw the same piece differently.
 */

const ON = "bg-indigo-500 hover:bg-indigo-600";
const OFF = "bg-slate-200 hover:bg-slate-300";

/**
 * The piece, drawn to its own proportions.
 *
 * Clamped to between 1:2 and 2:1 of the box: a 96 × 4 in windowsill drawn truly
 * would be a hairline with untappable edges. The dimensions are printed in the
 * middle, so the drawing is a control and the text is the truth.
 */
export function PieceDiagram({
  lengthIn, widthIn, edges, onToggle, disabled, unit,
}: {
  lengthIn: number | null;
  widthIn: number | null;
  edges: EdgeSelection;
  onToggle: (e: Edge) => void;
  disabled: boolean;
  /** scripts/0068 — fab_requirement.dim_unit. THIS DRAWING IS THE ONE SOMEBODY
   *  CLICKS while holding the purchase order, so its caption has to be the
   *  order's own numbers: "103 × 3 / cm", not "40.5512 × 1.1811 / inches".
   *  Display only. The bands, the geometry and the running feet are all still
   *  computed from the inches in lengthIn/widthIn. */
  unit?: string | null;
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
      <div className="absolute inset-[10px] rounded bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
        <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
          {formatDimension(lengthIn, unit) ?? "?"} × {formatDimension(widthIn, unit) ?? "?"}
        </span>
        <span className="text-[9px] text-slate-400">
          {parseDimUnit(unit) === "CM" ? "centimetres" : "inches"}
        </span>
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
 * an oval reads as an oval, and its ring IS the button.
 */
export function RoundDiagram({
  shape, lengthIn, widthIn, on, onToggle, disabled, unit,
}: {
  shape: unknown;
  lengthIn: number | null;
  widthIn: number | null;
  on: boolean;
  onToggle: () => void;
  disabled: boolean;
  /** scripts/0068 — fab_requirement.dim_unit, so a metric order's diameter
   *  reads "50 cm" and not "19.685 in". NULL/absent is inches, unchanged. */
  unit?: string | null;
}) {
  const circle = parseShape(shape) === "CIRCLE";
  const a = Number(lengthIn) > 0 ? Number(lengthIn) : 1;
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
          {describeShapeSize(shape, { lengthIn, widthIn }, unit)}
        </span>
        <span className="text-[9px] text-slate-400">{circle ? "circle" : "oval"}</span>
      </span>
    </button>
  );
}

/* -- the picker ------------------------------------------------------------ */

const FACE_LABEL: Record<PolishFace, string> = {
  top: "Top",
  bottom: "Bottom",
  side: "Side",
};

/** What each face IS, on hover — because "side" is the one people get wrong,
 *  and reading it as a fifth direction rather than the band is the whole
 *  misunderstanding this tooltip exists to head off. */
const FACE_HINT: Record<PolishFace, string> = {
  top: "The top arris — the line where the top face meets the edge band. The usual one.",
  bottom: "The bottom arris, on the underside. Chosen when the edge is seen from below.",
  side: "The edge band itself — the vertical thickness face. Normally done on the machine; choose this when it is being done by hand instead.",
};

function faceOn(shape: unknown, sel: EdgeSelection | undefined): boolean {
  const e = sel ?? {};
  return isRound(shape) ? !!e.round : EDGES.some((k) => !!e[k]);
}

export function FacePolishPicker({
  shape, lengthIn, widthIn, value, onChange, disabled = false, unit,
}: {
  shape: unknown;
  lengthIn: number | null;
  widthIn: number | null;
  value: FaceEdges;
  onChange: (next: FaceEdges) => void;
  disabled?: boolean;
  /** scripts/0068 — the unit the CUSTOMER ordered in. Passed straight down to
   *  the drawing's size caption so the man choosing sides is reading the same
   *  numbers as the purchase order in front of him. Display only: lengthIn and
   *  widthIn are inches here as everywhere, and the feet are computed from them. */
  unit?: string | null;
}) {
  const round = isRound(shape);
  const counts = useMemo(() => faceSideCounts(shape, value), [shape, value]);
  const active = useMemo(
    () => POLISH_FACES.filter((f) => faceOn(shape, value[f])),
    [shape, value],
  );

  // Which face's diagram is on screen. Follows the last face switched on, so
  // clicking "Bottom" puts you straight into choosing bottom's sides — the
  // sequence the owner described, without a second click to get there.
  const [editing, setEditing] = useState<PolishFace>(active[0] ?? "top");
  const shown = active.includes(editing) ? editing : (active[0] ?? null);

  /** Switching a face ON selects EVERY side of it, and that is deliberate.
   *
   *  "Top and bottom edges too, on all four sides" is the case this exists for,
   *  and the diagram appears immediately showing exactly what was selected with
   *  the count on the chip — so it is a visible default, not a silent one.
   *  Taking two off is two clicks; building four up would be four. */
  function toggleFace(f: PolishFace) {
    if (disabled) return;
    const next: FaceEdges = { ...value };
    if (faceOn(shape, next[f])) {
      delete next[f];
    } else {
      next[f] = allEdgesFor(shape);
      setEditing(f);
    }
    onChange(next);
  }

  function toggleEdge(f: PolishFace, e: Edge) {
    if (disabled) return;
    const cur: EdgeSelection = { ...(value[f] ?? {}) };
    if (cur[e]) delete cur[e]; else cur[e] = true;
    const next: FaceEdges = { ...value };
    // Clearing the last side of a face turns the FACE off, rather than leaving
    // an empty selection that reads on screen as "chosen" and prices as zero.
    if (!faceOn(shape, cur)) delete next[f]; else next[f] = cur;
    onChange(next);
  }

  function setAll(f: PolishFace, all: boolean) {
    if (disabled) return;
    const next: FaceEdges = { ...value };
    if (all) next[f] = allEdgesFor(shape); else delete next[f];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ---- STEP ONE: which faces ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-0.5">
          Polish
        </span>
        {POLISH_FACES.map((f) => {
          const on = faceOn(shape, value[f]);
          return (
            <button
              key={f}
              type="button"
              disabled={disabled}
              onClick={() => toggleFace(f)}
              aria-pressed={on}
              title={FACE_HINT[f]}
              className={`text-[11px] font-semibold rounded-full border px-2.5 py-1 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                on
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              {FACE_LABEL[f]}
              {on && (
                <span className="ml-1.5 tabular-nums text-indigo-500">
                  {round ? "ring" : counts[f]}
                </span>
              )}
            </button>
          );
        })}
        {active.length === 0 && (
          <span className="text-[11px] text-slate-400 ml-1">
            none — this row has no hand polish
          </span>
        )}
      </div>

      {/* ---- STEP TWO: which sides of the face you are editing ---- */}
      {shown && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 flex flex-col gap-2">
          {/* Only worth a tab strip when there is more than one face to switch
              between; one face is just a heading. */}
          {active.length > 1 ? (
            <div className="flex items-center gap-1">
              {active.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setEditing(f)}
                  aria-pressed={f === shown}
                  className={`text-[11px] font-medium rounded px-2 py-0.5 transition ${
                    f === shown
                      ? "bg-white border border-slate-300 text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {FACE_LABEL[f]}
                  <span className="ml-1 tabular-nums text-slate-400">
                    {round ? "" : counts[f]}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] font-medium text-slate-600">
              {FACE_LABEL[shown]} — choose the {round ? "edge" : "sides"}
            </div>
          )}

          <div className="flex items-start gap-3">
            {round ? (
              <RoundDiagram
                shape={shape}
                lengthIn={lengthIn}
                widthIn={widthIn}
                on={!!value[shown]?.round}
                onToggle={() => setAll(shown, !value[shown]?.round)}
                disabled={disabled}
                unit={unit}
              />
            ) : (
              <PieceDiagram
                lengthIn={lengthIn}
                widthIn={widthIn}
                edges={value[shown] ?? {}}
                onToggle={(e) => toggleEdge(shown, e)}
                disabled={disabled}
                unit={unit}
              />
            )}

            {!round && (
              <div className="flex flex-col gap-1 pt-1">
                <button
                  type="button" disabled={disabled} onClick={() => setAll(shown, true)}
                  className="text-[11px] rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:border-slate-300 disabled:opacity-50"
                >
                  All four
                </button>
                <button
                  type="button" disabled={disabled} onClick={() => setAll(shown, false)}
                  className="text-[11px] rounded border border-slate-200 bg-white px-2 py-1 text-slate-500 hover:border-slate-300 disabled:opacity-50"
                >
                  Clear
                </button>
                <div className="text-[10px] text-slate-400 leading-tight mt-0.5 max-w-[7rem]">
                  front and back run the length; left and right run the width
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
