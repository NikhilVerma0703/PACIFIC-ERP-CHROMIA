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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EDGES, ALL_EDGES, ROUND_ALL, allEdgesFor, parseEdges, serializeEdges,
  describeEdges, edgeCount, edgeCapacity,
  priceRow, runningFeet, formatRupees, thicknessLabel, describePricingMode,
  type Edge, type EdgeSelection,
} from "@/lib/fab/pricing";
import {
  isRound, parseShape, describeShapeSize, ROUND_EDGE,
  faceEdgesFromLegacy, parseFaceEdges, faceEdgesUnset, serializeFaceEdges,
  describeFaceEdges, faceSideCounts, POLISH_FACES,
  type FaceEdges,
} from "@/lib/fab/shape";
import { HandPolishPicker } from "@/components/fab/HandPolishPicker";
import { type PolishTermsValue } from "@/components/fab/PolishTerms";
import { SendToHandDialog, type HandTarget } from "@/components/fab/SendToHandDialog";

export interface EdgePickerRow {
  requirementId: string;
  /** "A", "B" — what every piece of this row is named after. */
  pieceLabel: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  /** scripts/0068 — fab_requirement.dim_unit: 'CM', or NULL/'IN' for the
   *  inches every US order is written in. Display only; the feet are always
   *  computed from lengthIn/widthIn above. */
  dimUnit: string | null;
  /** scripts/0069 — Rs per foot for a side done on BOTH faces. NULL = no
   *  discount, the two faces are summed at edgeRate. */
  pairRate?: number | null;
  /** scripts/0070 — each face's own Rs per foot. NULL falls back to edgeRate,
   *  then to the card, so an untouched row prices exactly as before. */
  edgeRateTop?: number | null;
  edgeRateBottom?: number | null;
  edgeRateSide?: number | null;
  /** Pieces ORDERED on this row. THE COUNT THE FEET ARE MEASURED OVER, since
   *  hand edge polish stopped following the sink: a row is homogeneous, so if
   *  its edges are marked, every piece of it is hand polished. */
  orderedQuantity: number;
  /**
   * THE PIECES OF THIS ROW ON THE SLAB BEING WORKED ON — and what this card
   * charges for whenever it is given.
   *
   * The owner: "the price there should be of the quantity, not of the full row.
   * Only in the PO should we see the row with its full price — because some
   * pieces, if the price is different, or sent to hand polish from the machine
   * late, then prices are different. So just show the price of the quantity we
   * are working on."
   *
   * ABSENT (undefined) MEANS "THE WHOLE ROW", which is what the manager's
   * purchase-order card wants: there, the row IS the unit, because that is
   * where the order is priced. On the supervisor's slab board it is the pieces
   * on the stone in front of him — a 150-piece row split 42/42 showed the same
   * ₹1,772.50 under both slabs before this existed, so the two slabs added up
   * to twice the row.
   */
  slabQuantity?: number | null;
  /** fab_requirement.sink_quantity — the ROW's count. Apportioned to
   *  slabQuantity by this card; see the note on `sinkHere`. */
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

  /** scripts/0067 — the three-face specification and this row's own terms.
   *  All null on a row the new controls have not touched, in which case the two
   *  legacy fields above are read through faceEdgesFromLegacy and the row shows
   *  exactly the figure it shows today. */
  edgesTop?: string | null;
  edgesBottom?: string | null;
  edgesSide?: string | null;
  edgeRate?: number | null;
  pricingMode?: string | null;
  edgeTotalOverride?: number | null;
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

/* -- the drawings live in FacePolishPicker now ----------------------------- *
 *
 * PieceDiagram and RoundDiagram were defined here, and this card drew ONE of
 * them for the whole row. That is the shape of question scripts/0067 replaced:
 * top, bottom and side each choose their own sides, so there is a diagram per
 * face and the picker that owns that flow owns the drawings.
 *
 * Moved rather than copied. Two drawings of one piece that both decide money is
 * two controls that can disagree, and the supervisor's card and the manager's
 * card must not disagree about which edge is which.
 */

/** Two decimals — the same rounding lib/fab/pricing.ts applies, restated for
 *  the one display figure this file works out for itself. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* -- one row --------------------------------------------------------------- */

/** The whole hand-polish decision for one row — what "copy above" carries. */
export interface PolishSpec {
  faces: FaceEdges;
  terms: PolishTermsValue;
}

export function EdgePicker({
  row, busy: parentBusy = false, onChange, copyFrom, onSpecChange, index = 0, total = 1,
  onSendToHand,
}: {
  row: EdgePickerRow;
  busy?: boolean;
  /** The row directly above's specification, or null when this is the first
   *  row. Present so the button can be disabled rather than silently doing
   *  nothing on row one. */
  copyFrom?: PolishSpec | null;
  /** Announced on every change so the board can offer it to the row below and
   *  can push it down the whole order. */
  onSpecChange?: (requirementId: string, spec: PolishSpec) => void;
  index?: number;
  total?: number;
  /** Opens the send-to-hand dialog for this row. Absent on any board that has
   *  no business reassigning work. */
  onSendToHand?: () => void;
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

  const chosen = row.finishedEdges !== null
    || !faceEdgesUnset({ top: row.edgesTop ?? null, bottom: row.edgesBottom ?? null, side: row.edgesSide ?? null });
  const edges = useMemo(() => parseEdges(row.finishedEdges), [row.finishedEdges]);

  // ── THE SPECIFICATION THIS CARD IS EDITING ──────────────────────────────
  //
  // Held locally and seeded from the row, because the parent boards hold the
  // legacy pair and refresh on their own cycle; keeping the three faces here
  // means the card responds to a click immediately and the board catches up
  // when it next reads.
  //
  // SEEDED THROUGH faceEdgesFromLegacy WHEN THE ROW HAS NO NEW SPEC, so a card
  // opened on an untouched row shows exactly what that row is quoted at today —
  // "front,back + BOTH" appears as top: front,back and bottom: front,back — and
  // the supervisor is editing the same decision, not starting a new one.
  const seedFaces = useMemo<FaceEdges>(() => {
    const stored = { top: row.edgesTop ?? null, bottom: row.edgesBottom ?? null, side: row.edgesSide ?? null };
    return faceEdgesUnset(stored)
      ? faceEdgesFromLegacy(parseEdges(row.finishedEdges), row.edgeFaces)
      : parseFaceEdges(stored);
  }, [row.edgesTop, row.edgesBottom, row.edgesSide, row.finishedEdges, row.edgeFaces]);

  const seedTerms = useMemo<PolishTermsValue>(() => ({
    pricingMode: row.pricingMode ?? null,
    rate: row.edgeRate ?? null,
    totalOverride: row.edgeTotalOverride ?? null,
    pairRate: row.pairRate ?? null,
    rateTop: row.edgeRateTop ?? null,
    rateBottom: row.edgeRateBottom ?? null,
    rateSide: row.edgeRateSide ?? null,
  }), [row.pricingMode, row.edgeRate, row.edgeTotalOverride, row.pairRate,
       row.edgeRateTop, row.edgeRateBottom, row.edgeRateSide]);

  const [faces, setFaces] = useState<FaceEdges>(seedFaces);
  const [terms, setTerms] = useState<PolishTermsValue>(seedTerms);

  // ── AND FOLLOW THE ROW WHEN IT IS RE-READ ────────────────────────────────
  //
  // The owner: "on refresh, or changing tabs, the pricing and all numbers are
  // getting back to zero."
  //
  // Half of that was the board route dropping the per-face columns on the way
  // out (see api/fab/supervisor/board/route.ts). The other half was HERE: these
  // two were seeded ONCE, by useState, and nothing ever seeded them again. The
  // boards poll, and the slabs page refetches when its tab is re-opened, so the
  // saved rates arrived in `row` a moment after the card mounted — and the card
  // went on showing the empty state it was born with. Every box read as
  // untouched over a database that had the numbers.
  //
  // KEYED ON WHAT IS STORED, not on the props object, so a poll returning the
  // same values does not reset a card somebody is working in. The signature
  // changes only when the DATABASE's answer for this row changes — which is
  // either somebody else's save or the confirmation of ours, and both should be
  // on screen.
  const storedSignature = JSON.stringify([
    row.edgesTop, row.edgesBottom, row.edgesSide, row.finishedEdges, row.edgeFaces,
    row.pricingMode, row.edgeRate, row.edgeTotalOverride, row.pairRate,
    row.edgeRateTop, row.edgeRateBottom, row.edgeRateSide,
  ]);
  //
  // AND ONLY WHILE THE CARD IS UNTOUCHED. `touched` is the guard, and it is not
  // caution — it is a correctness rule. saveTerms writes the three edges_*
  // columns and leaves the legacy finished_edges alone, so after one edit the
  // props hold a MIXTURE: our new spec in one place and the row's old legacy
  // answer in the other. Re-seeding off that would resurrect the old selection
  // on the next board read. "Not chosen" was the case that bit: clearing a
  // legacy row patched finishedEdges to null, the signature moved, and seedFaces
  // read the stale edges_top the server had last sent and put the faces back.
  //
  // So the server's answer wins until somebody starts working, and after that
  // this card is authoritative for its own lifetime. A reload seeds it afresh.
  const applied = useRef(storedSignature);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || applied.current === storedSignature) return;
    applied.current = storedSignature;
    setFaces(seedFaces);
    setTerms(seedTerms);
  }, [storedSignature, seedFaces, seedTerms]);

  // The board watches this to offer "copy above" to the row below, and to push
  // one row's answer down the whole order. Announced on every change including
  // the first render, so row two can copy row one before row one is touched.
  useEffect(() => {
    onSpecChange?.(row.requirementId, { faces, terms });
  }, [row.requirementId, faces, terms, onSpecChange]);

  // ── WHAT THIS CARD IS PRICING ────────────────────────────────────────────
  //
  // The pieces in front of the man reading it: those on this slab when the
  // board gave us a count, the whole ordered row when it did not (the
  // purchase-order card, where the row is the unit).
  //
  // CLAMPED TO THE ORDER. An allocation larger than the quantity ordered is
  // data corruption, not extra work, and charging for pieces that do not exist
  // is the one direction this must never round.
  const pricedQuantity = row.slabQuantity == null
    ? row.orderedQuantity
    : Math.min(row.orderedQuantity, Math.max(0, Math.floor(row.slabQuantity)));
  /** True when this card covers PART of the row — the rest is on other stone,
   *  or not yet on any. Drives the wording: "42 of 150 on this slab". */
  const partOfRow = row.slabQuantity != null && pricedQuantity < row.orderedQuantity;

  /**
   * THE SINKS ON THIS SLAB — APPORTIONED, and it has to be.
   *
   * The edge charge over a part of a row is EXACT: every piece of a row carries
   * identical edge work, so 42 pieces owe exactly 42 shares. The sink is not:
   * which of the 42 carry the cutout is settled at the bench and is written
   * down nowhere, so the only honest figure is the row's sink count scaled by
   * the pieces here. The sink line says so out loud rather than presenting a
   * guess as a count.
   *
   * The same rule and the same reason as lib/fab/slabCosting.ts, which
   * apportions sink money for the CEO board's per-slab panel.
   */
  const sinkHere = useMemo(() => {
    const rowSinks = Math.max(0, Math.floor(row.sinkQuantity ?? 0));
    if (row.slabQuantity == null || row.orderedQuantity <= 0) return row.sinkQuantity;
    if (rowSinks === 0) return 0;
    if (!partOfRow) return Math.min(pricedQuantity, rowSinks);
    return Math.min(pricedQuantity, Math.round((rowSinks * pricedQuantity) / row.orderedQuantity));
  }, [row.sinkQuantity, row.slabQuantity, row.orderedQuantity, pricedQuantity, partOfRow]);

  const priced = useMemo(() => priceRow({
    lengthIn: row.lengthIn,
    widthIn: row.widthIn,
    quantity: pricedQuantity,
    sinkQuantity: sinkHere,
    thicknessMm: row.thicknessMm,
    edges,
    shape,
    edgeFace: row.edgeFaces,
    faceEdges: faces,
    rate: terms.rate,
    pricingMode: terms.pricingMode,
    edgeTotalOverride: terms.totalOverride,
    pairRate: terms.pairRate,
    rateTop: terms.rateTop,
    rateBottom: terms.rateBottom,
    rateSide: terms.rateSide,
  }), [row.lengthIn, row.widthIn, pricedQuantity, sinkHere, row.thicknessMm, edges, shape, row.edgeFaces, faces, terms]);

  const cardRate = priced.rate?.edgePerFoot ?? null;

  /**
   * THE RATES THAT ACTUALLY PRICED THIS ROW, said in one line.
   *
   * Read off priced.edgeLines — the buckets the charge was computed from — so
   * it cannot claim a figure the money did not come from. Three cases:
   *
   *   one rate everywhere   "₹15.00/ft", which is every row nobody has priced
   *                         per face, and reads exactly as it always has
   *   several              "₹1.00–₹20.00/ft by face", and the per-face panels
   *                         above carry the detail
   *   no buckets            "no rate", or the row is unpriced and this whole
   *                         block is replaced by the amber note anyway
   */
  const rateSummary = useMemo(() => {
    const rates = priced.edgeLines
      .map((l) => l.rate)
      .filter((r): r is number => r !== null);
    if (rates.length === 0) {
      return priced.edgeRate === null ? "no rate" : `${formatRupees(priced.edgeRate)}/ft`;
    }
    const low = Math.min(...rates);
    const high = Math.max(...rates);
    return low === high
      ? `${formatRupees(low)}/ft`
      : `${formatRupees(low)}–${formatRupees(high)}/ft by face`;
  }, [priced.edgeLines, priced.edgeRate]);
  const faceCounts = useMemo(() => faceSideCounts(shape, faces), [shape, faces]);

  /**
   * SAVE THE THREE FACES AND THE TERMS.
   *
   * A different route from the legacy one below, and a different set of columns.
   * The old finished_edges / edge_faces pair is left exactly as it is: any
   * screen still reading it keeps working, and if this row is ever cleared back
   * the legacy answer is still underneath. The pricing engine prefers the new
   * columns whenever they exist — faceEdgesUnset decides — so the row moves to
   * the new model the first time somebody saves here and not before.
   */
  const saveTerms = useCallback(async (nextFaces: FaceEdges, nextTerms: PolishTermsValue) => {
    setError(null);
    setSaving(true);
    // From here on this card holds the answer, not the props — see `touched`.
    touched.current = true;
    const wire = serializeFaceEdges(nextFaces);
    const res = await postJson("/api/fab/supervisor/polish-terms", {
      requirementId: row.requirementId,
      faces: {
        top: wire.top ? wire.top.split(",") : [],
        bottom: wire.bottom ? wire.bottom.split(",") : [],
        side: wire.side ? wire.side.split(",") : [],
      },
      rate: nextTerms.rate,
      pairRate: nextTerms.pairRate,
      rateTop: nextTerms.rateTop,
      rateBottom: nextTerms.rateBottom,
      rateSide: nextTerms.rateSide,
      pricingMode: nextTerms.pricingMode,
      totalOverride: nextTerms.totalOverride,
    });
    if (!res.ok) {
      // Back exactly where it was — a card showing a specification the database
      // refused is an invoice nobody agreed to.
      // Back exactly where it was, which means the props are authoritative
      // again and this card should resume following them.
      setFaces(seedFaces);
      setTerms(seedTerms);
      touched.current = false;
      setError(res.error);
    }
    setSaving(false);
  }, [row.requirementId, seedFaces, seedTerms]);

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

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      {/* ── ONE COLUMN, NOT TWO ────────────────────────────────────────────
          This card used to be a left column holding the diagram and a right
          column holding the price, which is what made the screen the owner
          called clumsy: the box that set the bottom's rate was in a different
          column from the drawing that says what "bottom" is.

          Now the row identifies itself, the whole decision is made in one
          control underneath, and the money is a short footer. */}
      <div className="flex flex-col gap-2">
        <div className="min-w-[13rem] flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-slate-800">
              {row.pieceLabel ?? "Row"}
            </span>
            {/* THE SIZE, BESIDE THE LETTER. "Wherever you put row, put the
                L x width of that too next to it." The drawing below carries it
                too, but the drawing is one face at a time and the card is
                identified by its heading — a supervisor scrolling forty cards
                reads the heading, not the diagram. */}
            {row.lengthIn != null && (
              <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                {describeShapeSize(shape, { lengthIn: row.lengthIn, widthIn: row.widthIn }, row.dimUnit)}
              </span>
            )}
            <span className="text-[11px] text-slate-400">
              {/* THE COUNT BEING CHARGED FOR, AND WHAT IT IS PART OF.
                  "42 of 150 pcs" rather than a bare "150 pcs" — a figure on a
                  slab panel that silently covered the whole order is the thing
                  this card was reported for. Edge work is homogeneous within a
                  row, so 42 pieces is exactly 42 shares of it. */}
              {partOfRow ? (
                <>
                  <span className="font-semibold text-indigo-700">{pricedQuantity}</span>
                  {" of "}{row.orderedQuantity} pc{row.orderedQuantity === 1 ? "" : "s"}
                  <span className="text-slate-400"> on this slab</span>
                </>
              ) : (
                <>{pricedQuantity} pc{pricedQuantity === 1 ? "" : "s"}</>
              )}
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
            {chosen ? describeFaceEdges(shape, faces) : "Nobody has marked this row's edges"}
          </p>

          {/* THE COUNTS, AS THE OWNER ASKS FOR THEM: "number of side for top,
              no of side for bottom, no of side for side." Faces with nothing on
              them are left out — three zeroes is noise, not information. */}
          {!round && POLISH_FACES.some((f) => faceCounts[f] > 0) && (
            <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
              {POLISH_FACES.filter((f) => faceCounts[f] > 0)
                .map((f) => `${f} ${faceCounts[f]} of ${capacity}`)
                .join(" · ")}
            </p>
          )}
        </div>

        {/* ── THE DECISION, AND ITS PRICE, IN ONE PLACE ────────────────────
            "If clicked top you see the sides, choose them, and you see the
            price for it, put price. Then bottom, same way. Then side."

            Faces, sides and each face's own rate are asked together, with the
            money for THAT face under the box that set it. The two-control
            version — diagram here, a wide "PER FACE" rate band four inches
            below — is what the owner was looking at when he asked for this to
            be cleaned up.

            `disabled` IS THE PARENT'S BUSY, NOT `busy`. Passing `busy` greyed
            every box out while a save was in flight, which pulled focus out
            from under the man typing the next rate. The boxes commit on blur,
            so a save can never be racing the keystrokes anyway. */}
        <HandPolishPicker
          shape={shape}
          lengthIn={row.lengthIn}
          widthIn={row.widthIn}
          unit={row.dimUnit}
          faces={faces}
          terms={terms}
          priced={priced}
          cardRate={cardRate}
          disabled={parentBusy}
          onChange={(nextFaces, nextTerms) => {
            setFaces(nextFaces);
            setTerms(nextTerms);
            void saveTerms(nextFaces, nextTerms);
          }}
        />

        <div className="min-w-[13rem] flex-1">
          {/* the money, live */}
          <div className="mt-1 text-xs tabular-nums">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Running feet</span>
              <span className="font-semibold text-slate-800">
                {priced.runningFeet} ft
                {priced.runningFeet > 0 && (
                  <span className="text-slate-400 font-normal">
                    {" "}&middot; {round2(priced.runningFeet / Math.max(1, priced.edgePieces))} ft a piece
                  </span>
                )}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {describeFaceEdges(shape, faces).toLowerCase()} on{" "}
              {priced.edgePieces} piece{priced.edgePieces === 1 ? "" : "s"}
              {/* NAMED, because 1,290 ft on a row whose perimeter is 505 ft is
                  otherwise an arithmetic error to anybody reading it. Three
                  faces is three passes of the chosen sides — SUMMED, and each
                  face over its own sides, which is why the number can be more
                  than three times the single-face figure or less. */}
              {POLISH_FACES.filter((f) => faceCounts[f] > 0).length > 1 && (
                <span className="text-amber-700 font-semibold">
                  {" "}&middot; {POLISH_FACES.filter((f) => faceCounts[f] > 0).length} faces, walked separately
                </span>
              )}
              {priced.rateSource === "ROW" && (
                <span className="text-indigo-600 font-semibold"> &middot; this row&apos;s own rate</span>
              )}
            </div>
            {/* THE RATE BOXES USED TO BE HERE, as a <PolishTerms> block sitting
                under the money. They have moved INTO the control above, where
                each face's rate sits beside that face's own drawing — the whole
                point of the rebuild. What is left below is the reckoning. */}

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
              ) : priced.unpricedReason === "RATE" ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  This row is charged {describePricingMode(priced.pricingMode).label.toLowerCase()},
                  so it needs its own figure — type it under Other terms above. The rate
                  card is quoted per FOOT and cannot stand in for a per-piece price.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-amber-700">
                  {thicknessLabel(row.thicknessMm)} is not on the rate card (2 cm and 3 cm are) —
                  the feet are right, the charge has to be agreed.
                </p>
              )
            ) : (
              <>
                {/* THE RATE THAT WAS ACTUALLY USED, in the unit the MODE implies.
                    This line used to read priced.rate!.edgePerFoot — the RATE CARD —
                    which is wrong twice over on a per-piece row: it printed "Rs15/ft"
                    beside a charge computed from Rs150 a piece, and `rate` is null on
                    stone the card does not cover, so the `!` was a crash waiting for
                    an off-card row. priced.edgeRate is the figure the money came from,
                    whichever way it got there. */}
                <div className="flex justify-between gap-4 mt-0.5">
                  <span className="text-slate-500">
                    Hand edge polish &middot;{" "}
                    {priced.edgeRate === null
                      ? "no rate"
                      : priced.pricingMode === "PER_PIECE"
                      ? `${formatRupees(priced.edgeRate)}/piece × ${priced.chargePieces}`
                      : priced.pricingMode === "LUMP_SUM"
                      ? `${formatRupees(priced.edgeRate)} for the row`
                      // ── ONE RATE IS NOT ALWAYS AN HONEST SUMMARY ──────────
                      //
                      // This line printed priced.edgeRate — the ROW's rate —
                      // and that is wrong the moment a face carries its own.
                      // Seen on row I of PI 1200: the row rate is ₹0 and the
                      // top face is ₹1, so the footer read "₹0.00/ft" beside a
                      // charge of ₹88.63. A rate of zero next to real money is
                      // not a rounding quibble, it is a line that cannot be
                      // checked and invites somebody to "fix" the wrong box.
                      //
                      // So the rates ACTUALLY USED are read off the buckets the
                      // charge was computed from. Formatting, not arithmetic —
                      // every figure here is one priceRow already returned.
                      : rateSummary}
                    {priced.rateSource === "ROW" && rateSummary.indexOf("face") < 0 && (
                      <span className="text-slate-400"> · this row&rsquo;s own</span>
                    )}
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatRupees(priced.edgeCost)}
                    {/* WHAT ONE PIECE EARNED, beside what the row earned.
                        "I need the price only for that particular quantity" — a
                        figure covering 150 pieces cannot be checked against a
                        rate somebody has just typed, and this is what the bench
                        is actually paid per piece. */}
                    {priced.edgeCostPerPiece > 0 && priced.chargePieces > 1 && (
                      <span className="text-slate-400 font-normal">
                        {" "}&middot; {formatRupees(priced.edgeCostPerPiece)} a piece
                      </span>
                    )}
                  </span>
                </div>
                {priced.sinkPieces > 0 && priced.rate && (
                  <div className="flex justify-between gap-4 mt-0.5">
                    <span className="text-slate-500">
                      Sinks &middot; {priced.sinkPieces} × {formatRupees(priced.rate.sinkPerPiece)}
                      {/* APPORTIONED, AND SAID SO. Edge work is identical on
                          every piece of a row, so a part of a row owes an exact
                          share of it. The sink is not: which pieces carry the
                          cutout is settled at the bench and recorded nowhere. */}
                      {partOfRow && (
                        <span className="text-amber-700" title="Apportioned by piece count. Which pieces of this row carry the sink cutout is decided at the bench and is not recorded, so the share on this slab is an estimate. The edge money above is exact.">
                          {" "}&middot; share
                        </span>
                      )}
                    </span>
                    <span className="font-semibold text-slate-800">{formatRupees(priced.sinkCost)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-slate-100">
                  {/* NAMED FOR WHAT IT COVERS. It used to say "Row total" while
                      sitting inside one slab's panel and covering the whole
                      order — so two slabs of one row showed the same figure and
                      adding them double-counted. */}
                  <span className="text-slate-600 font-medium">
                    {partOfRow
                      ? <>These {pricedQuantity} pieces</>
                      : <>Row total</>}
                  </span>
                  <span className="font-bold text-indigo-700">{formatRupees(priced.total)}</span>
                </div>
              </>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {/* "All four" and "No edges" lived here and belonged to the single
                diagram this card used to have. FacePolishPicker carries both,
                per face, where the choice is actually made — a row-level "all
                four" cannot say WHICH face it means once there are three.

                What survives is the one thing the picker cannot express: back
                to "nobody has chosen", which is not the same as "no edges" and
                is the only way to undo having looked at a row by mistake. */}
            {/* ── COPY THE ROW ABOVE ────────────────────────────────────────
                "If I put rate of one row, I need option to inherit it to next
                row, and next to next as well — based on click, copy above row."

                Faces AND terms together, because they are one decision: a rate
                without the faces it was quoted for is a number with no shape.
                The quantity, the sink count and the dimensions are the row's
                own and are never touched. */}
            {index > 0 && (
              <button
                type="button"
                disabled={busy || !copyFrom}
                onClick={() => {
                  if (!copyFrom) return;
                  setFaces(copyFrom.faces);
                  setTerms(copyFrom.terms);
                  void saveTerms(copyFrom.faces, copyFrom.terms);
                }}
                title="Take the faces, the mode and the rate from the row above"
                className="text-[11px] font-semibold px-2 py-1 rounded border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Copy row above
              </button>
            )}
            {/* ── THE MACHINE CANNOT DO IT ──────────────────────────────────
                The owner asked for this on BOTH screens. The operator's queue
                has it per piece, because he is holding one. Here the supervisor
                is looking at ordered ROWS, so the only sensible unit is the
                whole row — and the dialog drops its per-piece button when it is
                given no piece ids. */}
            {onSendToHand && (
              <button type="button" disabled={busy} onClick={onSendToHand}
                title="The machine cannot do this profile, is busy, or is down — send the row to the hand bench and record what it costs"
                className="text-[11px] font-semibold px-2 py-1 rounded border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 transition">
                To hand
              </button>
            )}
            {chosen && (
              <button type="button" disabled={busy}
                onClick={() => { setFaces({}); void saveTerms({}, terms); void save(null); }}
                title="Put this row back to 'not chosen' — different from 'no edges'"
                className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:text-slate-700 disabled:opacity-40 transition">
                Not chosen
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
  // Each row's live specification, so the row below can copy it and so one row
  // can be pushed down the rest of the order. Held here rather than in each
  // card because "the row above" is a fact about the LIST, not about a row.
  const [specs, setSpecs] = useState<Record<string, PolishSpec>>({});
  const [pushing, setPushing] = useState<string | null>(null);
  /** scripts/0067 — the row currently being sent to the hand bench, or null.
   *  ONE at a time for the whole board: two open dialogs would be two answers
   *  to "what does this cost" with nothing saying which won. */
  const [handTarget, setHandTarget] = useState<HandTarget | null>(null);
  const noteSpec = useCallback((id: string, spec: PolishSpec) => {
    setSpecs((prev) => (prev[id] === spec ? prev : { ...prev, [id]: spec }));
  }, []);

  /**
   * PUSH ONE ROW'S ANSWER DOWN THE WHOLE ORDER.
   *
   * "Copy above" one row at a time is thirty-nine clicks on a forty-row PO,
   * which is the same problem in a new costume. This is the same decision
   * applied to every row BELOW the one it came from — never above, so a
   * supervisor working down the order cannot undo what he has already settled
   * by pressing it a second time.
   *
   * One request per row, sequentially, because each row is validated against
   * its OWN shape: a circle three rows down must refuse "front" rather than
   * having it written because a rectangle above it was fine.
   */
  const applyBelow = useCallback(async (fromId: string) => {
    const spec = specs[fromId];
    const from = rows.findIndex((r) => r.requirementId === fromId);
    if (!spec || from < 0 || from >= rows.length - 1) return;
    setPushing(fromId);
    const wire = serializeFaceEdges(spec.faces);
    for (const r of rows.slice(from + 1)) {
      await postJson("/api/fab/supervisor/polish-terms", {
        requirementId: r.requirementId,
        faces: {
          top: wire.top ? wire.top.split(",") : [],
          bottom: wire.bottom ? wire.bottom.split(",") : [],
          side: wire.side ? wire.side.split(",") : [],
        },
        rate: spec.terms.rate,
        // scripts/0069 — the pair rate travels for the same reason the rate
        // does: it is a figure PER FOOT and it scales. A row below with a
        // different number of paired sides gets the right money out of the
        // same quote, which is the whole point of pushing a rate rather than
        // a total.
        pairRate: spec.terms.pairRate,
        // The per-face rates travel for the same reason: each is Rs per foot and
        // scales to whatever sides the row below actually has.
        rateTop: spec.terms.rateTop,
        rateBottom: spec.terms.rateBottom,
        rateSide: spec.terms.rateSide,
        pricingMode: spec.terms.pricingMode,
        // THE AGREED TOTAL IS NOT PUSHED. A figure somebody settled for ONE row
        // is not a figure for the thirty-nine under it; copying it would bill
        // every one of them at a total nobody quoted. The rate travels, because
        // a rate is per foot or per piece and scales; a lump sum does not.
        totalOverride: null,
      });
    }
    setPushing(null);
  }, [specs, rows]);
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
      {/* WHICH PIECES THE MONEY BELOW COVERS. Said once for the board rather
          than on every card. The figures are for the pieces ON THIS SLAB; the
          purchase-order screen is where a row is priced whole. */}
      <p className="text-[11px] text-slate-500">
        Every charge here is for <strong>the pieces of that row on this slab</strong> — not the
        whole ordered row. A row split across two slabs is priced twice, once on each, so the
        slabs add up instead of double-counting. The full row total is on the purchase order.
      </p>
      {unchosen > 0 && (
        <p className="text-[11px] text-amber-700">
          {unchosen} row{unchosen === 1 ? " has" : "s have"} no edge decision yet —
          reported as unpriced, not as free.
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.requirementId} className="relative">
          <EdgePicker
            row={r} busy={busy || pushing !== null} onChange={onChange}
            index={i} total={rows.length}
            copyFrom={i > 0 ? specs[rows[i - 1].requirementId] ?? null : null}
            onSpecChange={noteSpec}
            onSendToHand={() => setHandTarget({
              pieceIds: [],                       // rows here, not pieces
              requirementId: r.requirementId,
              pieceLabel: r.pieceLabel,
              lengthIn: r.lengthIn,
              widthIn: r.widthIn,
              dimUnit: r.dimUnit,
              thicknessMm: r.thicknessMm,
              shapeType: r.shapeType ?? null,
              finishedEdges: r.finishedEdges,
              edgeFaces: r.edgeFaces ?? null,
              rowPieceCount: r.orderedQuantity,
            })}
          />
          {i < rows.length - 1 && specs[r.requirementId] && (
            <div className="mt-1 mb-1 flex justify-end">
              <button
                type="button"
                disabled={busy || pushing !== null}
                onClick={() => void applyBelow(r.requirementId)}
                title="Give every row below this one the same faces, mode and rate. The agreed total is not copied."
                className="text-[10px] font-medium text-slate-400 hover:text-indigo-700 disabled:opacity-40 transition"
              >
                {pushing === r.requirementId
                  ? `applying to ${rows.length - 1 - i} row${rows.length - 1 - i === 1 ? "" : "s"}…`
                  : `↓ apply to the ${rows.length - 1 - i} row${rows.length - 1 - i === 1 ? "" : "s"} below`}
              </button>
            </div>
          )}
        </div>
      ))}

      <SendToHandDialog
        target={handTarget}
        onClose={() => setHandTarget(null)}
        onDone={() => setHandTarget(null)}
      />
    </div>
  );
}
