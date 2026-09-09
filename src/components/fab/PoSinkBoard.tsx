"use client";

// SINK ASSIGNMENT ON THE PURCHASE ORDER — the supervisor's board, moved to where
// the decision now lives, and made a DRAFT.
//
// The owner asked for two things, in order:
//
//   "I want the UI and flow you had for the supervisor dashboard earlier for the
//    PO as well."
//
//   "If I'm adding it, make nothing — even manually edit the row, it gives you a
//    real row newly. But you make it again to unsink or no sink, it doesn't go
//    to original, instead stays where they are. It should be like manager do
//    these things and then save to send to supervisor."
//
// The first gave us the board. The second found what was wrong underneath it.
//
// ─────────────────────────────────── WHY SAVE-ON-CLICK WAS THE BUG ──────────
// Writing every move straight to the database meant a SPLIT CREATED A ROW THE
// MOMENT IT WAS TYPED. Dragging that row back to "no sink" only marked it plain
// — it did not go home. Row C of 60, split into 40 + 20 and then thought better
// of, stayed TWO PLAIN ROWS of 40 and 20 where the order has one row of 60.
// Every hesitation left litter behind, and no amount of merging-on-the-way-back
// fixes a model where the manager's thinking is being written down as he thinks.
//
// He is not making standing decisions one at a time. He is WORKING OUT the
// breakdown. So nothing is written until he presses Save.
//
// ─────────────────────────────────── THE DRAFT IS ONE NUMBER PER ROW ────────
// However much dragging and typing happens, the whole intent is: for each
// ORDERED ROW, how many of its pieces carry a sink? Everything on screen is
// DERIVED from that number by draftCards() — one card, or two with the second
// marked "new on save". Moving a provisional card back is just that number
// changing, so it merges itself. A row that was never created cannot be left
// behind.
//
// AND IT SURVIVES A REFRESH. The owner: "refresh data should not be gone."
//
// A manager marking up a forty-row order is not going to finish before a tablet
// sleeps, a page reloads, or somebody opens a PDF in the same tab. Losing the
// lot to that would make the draft worse than the save-on-click board it
// replaced. So it is kept in localStorage, per purchase order.
//
// LOCAL, NOT SERVER, and that distinction is the whole design:
//
//   the draft   this manager's working-out. His browser only. Nobody else sees
//               it, and the supervisor certainly does not.
//   the save    the decision. Written to fab_requirement, and from that moment
//               the supervisor has these rows to find slabs for.
//
// A draft is dropped for any row that has since vanished or been altered
// underneath it, and the board says out loud when it has restored one — a
// silent restore is how somebody saves a decision they made last Tuesday and
// have entirely forgotten about.
//
// ─────────────────────────── AND HAND EDGE POLISH, BESIDE IT ────────────────
// The owner: "we choose the sink, THERE ITSELF we need to choose the edge
// polish, which is not the polish of the operator. This edge polish is by hand,
// where we need the running foot length and charge by thickness." And on who:
// "this is chosen and done by supervisor, or else the one manager who uploads
// the PO."
//
// So the edge decision sits on the card, next to the sink one. Two jobs, one
// group, one place to settle both.
//
//   SINK POLISH   implied by the sink cut and priced inside the per-piece rate.
//                 Nobody chooses it and it appears nowhere on this board.
//   EDGE POLISH   chosen here, on any card — sink or plain. Per running foot.
//
// EDGES ARE WRITTEN ON CLICK; SINKS ARE NOT. That asymmetry is deliberate, and
// it is the reason the draft exists: a sink SPLIT CREATES A ROW, so a manager
// working out a breakdown would leave litter behind every time he changed his
// mind. An edge selection creates nothing — it is one nullable column on a row
// that already exists, and it is reversible with one more click. Holding it in
// the draft would buy nothing and would mean the supervisor's board (which has
// always written edges on click) and this one disagreed about when a decision
// counts. The board says which is which rather than hiding the difference.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FabAlerts } from "@/components/fab/FabAlerts";
import { postJson } from "@/lib/fab/postJson";
import { rowLabel } from "@/lib/fab/pieceNaming";
import {
  draftCards, draftChanges, draftShape, draftValue, planSinkMerge, sideOf,
  type DraftCard, type SinkSide,
} from "@/lib/fab/sinkSplit";
import {
  EDGES, allEdgesFor, describeEdges, edgeCount, edgeCapacity, parseEdges,
  priceRow, serializeEdges, formatRupees,
  type Edge, type EdgeSelection,
} from "@/lib/fab/pricing";
import {
  isRound, describeShapeSize, ROUND_EDGE,
  PIECE_SHAPES, EDGE_FACES, parseShape, parseEdgeFace, dimensionLabels,
  faceEdgesFromLegacy, parseFaceEdges, faceEdgesUnset, serializeFaceEdges,
  describeFaceEdges, faceSideCounts, POLISH_FACES,
  type PieceShape, type EdgeFace, type FaceEdges,
} from "@/lib/fab/shape";
import { HandPolishPicker } from "@/components/fab/HandPolishPicker";
import { type PolishTermsValue } from "@/components/fab/PolishTerms";

/** How each shape reads on a button. The enum values are for the database. */
const SHAPE_LABEL: Record<PieceShape, string> = {
  RECTANGLE: "Rect / Square",
  CIRCLE: "Circle",
  OVAL: "Oval",
};

/** TOP / BOTTOM / BOTH, in the words a fabricator uses. BOTH says out loud that
 *  it is twice the work, because that is the whole reason the control exists. */
const FACE_LABEL: Record<EdgeFace, string> = {
  TOP: "Top",
  BOTTOM: "Bottom",
  BOTH: "Both ×2",
};

export interface PoSinkRow {
  id: string;
  pieceLabel: string | null;
  rowLetter: string | null;
  length: number | null;
  width: number | null;
  quantity: number;
  /** NULL = nobody has decided. After a saved split this is 0 or the quantity. */
  sinkQuantity: number | null;
  /** fab_requirement.finished_edges — the HAND edge polish decision. NULL =
   *  nobody has marked it, which is not the same as "no edges". */
  finishedEdges?: string | null;
  /** RECTANGLE / CIRCLE / OVAL. Null is a rectangle. */
  shapeType?: string | null;
  /** scripts/0068 — fab_requirement.dim_unit: 'CM', or NULL/'IN'. Display only.
   *  length/width above stay inches, because the running feet are built on them. */
  dimUnit?: string | null;
  /** scripts/0069 — Rs per foot for a side done on BOTH faces. NULL = the two
   *  faces are summed at edgeRate, which is every row before 0069. */
  pairRate?: number | null;
  /** scripts/0070 — each face's own Rs per foot. NULL falls back to edgeRate,
   *  then to the card. */
  edgeRateTop?: number | null;
  edgeRateBottom?: number | null;
  edgeRateSide?: number | null;
  /** TOP / BOTTOM / BOTH — how many times each chosen edge is walked. NULL is
   *  TOP. BOTH doubles the running feet; see scripts/0065.
   *  SUPERSEDED by the three faces below on any row that has them. */
  edgeFaces?: string | null;
  /** scripts/0067 — top / bottom / side, each with its OWN sides, plus this
   *  row's own rate, mode and agreed total. All null on a row the new controls
   *  have not touched, in which case the legacy pair above decides and the row
   *  prices exactly as it does today. */
  edgesTop?: string | null;
  edgesBottom?: string | null;
  edgesSide?: string | null;
  edgeRate?: number | null;
  pricingMode?: string | null;
  edgeTotalOverride?: number | null;
  /** MILLIMETRES, when the row is already on a slab — the rate depends on it.
   *  Null on an order not yet given stone, and the feet still show. */
  thicknessMm?: number | null;
  allocatedQty: number;
  pieceCount: number;
  /** Already sent to cutting — shown, never moved. */
  locked: boolean;
}

const DRAG_TYPE = "text/plain";

/* -- Where an unsaved draft lives ------------------------------------------ *
 *
 * Per purchase order, in this browser. Every read and write is wrapped: a
 * tablet in private mode, or with site data blocked, throws on access rather
 * than returning null, and a manager must not be shown a broken board because
 * his browser will not remember things.
 */
const DRAFT_KEY = (poId: string) => `pacific:po-sink-draft:${poId}`;

interface StoredDraft { savedAt: number; entries: Array<[string, number]> }

function readDraft(poId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(poId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!Array.isArray(parsed?.entries)) return null;
    // Only pairs of (string, whole number) — anything else is a different
    // version of this code, or corruption, and is not worth guessing at.
    const entries = parsed.entries.filter(
      (e): e is [string, number] =>
        Array.isArray(e) && typeof e[0] === "string" && Number.isInteger(e[1]),
    );
    return entries.length ? { savedAt: Number(parsed.savedAt) || 0, entries } : null;
  } catch {
    return null;
  }
}

function writeDraft(poId: string, draft: Map<string, number>) {
  try {
    if (draft.size === 0) window.localStorage.removeItem(DRAFT_KEY(poId));
    else window.localStorage.setItem(
      DRAFT_KEY(poId),
      JSON.stringify({ savedAt: Date.now(), entries: [...draft.entries()] } satisfies StoredDraft),
    );
  } catch {
    // Storage unavailable or full. The draft still works for this page view;
    // it just will not survive a reload. Not worth interrupting anybody over.
  }
}

function whenText(ms: number): string {
  if (!ms) return "earlier";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "a moment ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function dims(r: PoSinkRow): string {
  // Shape-aware: "⌀ 24 in" for a circle, "36 × 24 in oval" for an oval. Printing
  // 24 × 24 for a circle reads as a square and makes its running feet — which
  // are π·24, not 4·24 — look like an arithmetic error.
  if (r.length == null) return "—";
  return describeShapeSize(r.shapeType, { lengthIn: r.length, widthIn: r.width }, r.dimUnit);
}

/* -- HAND EDGE POLISH, on the card ----------------------------------------- *
 *
 * Small on purpose. The full graphical piece lives on the supervisor's slab
 * card (components/fab/EdgePicker.tsx) where there is room for it; here the
 * manager is going down forty rows and needs the decision and the number, not a
 * diagram per row.
 *
 * THE SAME ROUTE, THE SAME COLUMN, THE SAME CANONICAL STRING as that picker —
 * so the two screens cannot come to hold different answers for one row.
 */
function EdgeChoice({
  row, busy, onSaved, onShape, onFace, onError,
}: {
  row: PoSinkRow;
  busy: boolean;
  onSaved: (rowId: string, finishedEdges: string | null) => void;
  onShape: (rowId: string, shape: string, clearedEdges: boolean) => void;
  onFace: (rowId: string, face: string) => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const disabled = busy || saving;

  const shape = row.shapeType ?? "RECTANGLE";
  const round = isRound(shape);
  const face = parseEdgeFace(row.edgeFaces);
  const edges = useMemo(() => parseEdges(row.finishedEdges ?? null), [row.finishedEdges]);
  const stored0067 = { top: row.edgesTop ?? null, bottom: row.edgesBottom ?? null, side: row.edgesSide ?? null };
  const chosen = (row.finishedEdges ?? null) !== null || !faceEdgesUnset(stored0067);

  // SEEDED THROUGH faceEdgesFromLegacy WHEN THE ROW HAS NO NEW SPEC, so a card
  // opened on a row already quoted shows exactly what it is quoted at — the
  // manager is editing the same decision, not starting a fresh one.
  const seedFaces = useMemo<FaceEdges>(
    () => (faceEdgesUnset(stored0067)
      ? faceEdgesFromLegacy(parseEdges(row.finishedEdges ?? null), row.edgeFaces)
      : parseFaceEdges(stored0067)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row.edgesTop, row.edgesBottom, row.edgesSide, row.finishedEdges, row.edgeFaces],
  );
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
  // "On refresh, or changing tabs, the pricing and all numbers are getting back
  // to zero."
  //
  // These two were seeded ONCE, by useState, and nothing ever seeded them
  // again — so a card mounted before the fetch landed went on showing the empty
  // state it was born with over a database that held the rates. Keyed on WHAT
  // IS STORED rather than on the props object, so a poll returning the same
  // values cannot reset a card somebody is working in.
  const storedSignature = JSON.stringify([
    row.edgesTop, row.edgesBottom, row.edgesSide, row.finishedEdges, row.edgeFaces,
    row.pricingMode, row.edgeRate, row.edgeTotalOverride, row.pairRate,
    row.edgeRateTop, row.edgeRateBottom, row.edgeRateSide,
  ]);
  //
  // AND ONLY WHILE THE CARD IS UNTOUCHED. saveTerms writes the three edges_*
  // columns and leaves the legacy finished_edges alone, so after one edit the
  // props hold a MIXTURE — the new spec in one place and the row's old legacy
  // answer in the other — and re-seeding off that would resurrect the old
  // selection. The server's answer wins until somebody starts working; after
  // that this card is authoritative for its own lifetime.
  const applied = useRef(storedSignature);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || applied.current === storedSignature) return;
    applied.current = storedSignature;
    setFaces(seedFaces);
    setTerms(seedTerms);
  }, [storedSignature, seedFaces, seedTerms]);

  const faceCounts = useMemo(() => faceSideCounts(shape, faces), [shape, faces]);
  const n = edgeCount(edges, shape);
  const capacity = edgeCapacity(shape);
  const labels = dimensionLabels(shape);

  // THE WHOLE ROW, ALWAYS. Hand edge polish is a group decision — a row where
  // only some pieces want it is SPLIT — so the feet run over the ordered
  // quantity, not over the sink count. That is the reversal this build is
  // about; see lib/fab/pricing.ts.
  const priced = useMemo(() => priceRow({
    lengthIn: row.length, widthIn: row.width, quantity: row.quantity,
    sinkQuantity: row.sinkQuantity, thicknessMm: row.thicknessMm ?? null,
    edges, shape, edgeFace: face,
    faceEdges: faces,
    rate: terms.rate,
    pricingMode: terms.pricingMode,
    edgeTotalOverride: terms.totalOverride,
    pairRate: terms.pairRate,
    rateTop: terms.rateTop,
    rateBottom: terms.rateBottom,
    rateSide: terms.rateSide,
  }), [row.length, row.width, row.quantity, row.sinkQuantity, row.thicknessMm, edges, shape, face, faces, terms]);

  /** The three faces and the terms, through the scripts/0067 route. The legacy
   *  finished_edges / edge_faces pair is left untouched, so any screen still
   *  reading it keeps working and the old answer stays underneath. */
  const saveTerms = useCallback(async (nextFaces: FaceEdges, nextTerms: PolishTermsValue) => {
    setSaving(true);
    // From here on this card holds the answer, not the props — see `touched`.
    touched.current = true;
    const wire = serializeFaceEdges(nextFaces);
    const res = await postJson("/api/fab/supervisor/polish-terms", {
      requirementId: row.id,
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
    setSaving(false);
    if (!res.ok) {
      // Back exactly where it was — a card showing a specification the database
      // refused is an invoice nobody agreed to.
      // Back where it was, so the props are authoritative again and this card
      // should resume following them.
      setFaces(seedFaces);
      setTerms(seedTerms);
      touched.current = false;
      onError(res.error ?? "That change was not saved.");
    }
  }, [row.id, seedFaces, seedTerms, onError]);

  const save = useCallback(async (next: EdgeSelection | null) => {
    const previous = row.finishedEdges ?? null;
    const nextStored = next === null ? null : serializeEdges(next);
    if (previous === nextStored) return;

    setSaving(true);
    onSaved(row.id, nextStored);                       // optimistic
    const wire = next === null
      ? null
      : round ? (next.round ? [ROUND_EDGE] : []) : EDGES.filter(e => next[e]);
    const res = await postJson("/api/fab/supervisor/finished-edges", {
      requirementId: row.id,
      edges: wire,
    });
    setSaving(false);
    if (!res.ok) {
      // Back exactly where it was. A card left showing an edge the database does
      // not have is an invoice nobody agreed to.
      onSaved(row.id, previous);
      onError(res.error ?? "The edge change was not saved.");
      return;
    }
    const data = res.data as { finishedEdges?: string | null };
    onSaved(row.id, typeof data?.finishedEdges === "string" || data?.finishedEdges === null
      ? data.finishedEdges ?? null
      : nextStored);
  }, [row.id, row.finishedEdges, round, onSaved, onError]);

  const toggle = (e: Edge) => save({ ...edges, [e]: !edges[e] });

  /** Shape and face go through the SAME route as the edges — one card, one
   *  decision, one place it is written. The route validates the edge selection
   *  against the shape, so sending them separately is what stops a stale screen
   *  writing "front" onto a circle. */
  const post = useCallback(async (patch: Record<string, unknown>, after: () => void) => {
    setSaving(true);
    const res = await postJson("/api/fab/supervisor/finished-edges", { requirementId: row.id, ...patch });
    setSaving(false);
    if (!res.ok) { onError(res.error ?? "That change was not saved."); return; }
    after();
  }, [row.id, onError]);

  const setShape = (next: string) => {
    if (parseShape(next) === parseShape(shape)) return;
    void post({ shape: next }, () => {
      // CROSSING BETWEEN ROUND AND CORNERED CLEARS THE EDGES, server-side —
      // "front" is not a smaller answer on a circle, it is an answer about a
      // shape that no longer exists. The card follows rather than keeping a
      // selection the database has just dropped.
      const cleared = isRound(next) !== isRound(shape);
      onShape(row.id, next, cleared);
    });
  };

  const setFace = (next: string) => {
    if (next === face) return;
    void post({ edgeFaces: next }, () => onFace(row.id, next));
  };

  return (
    <div className="px-4 pb-3 pt-2 border-t border-slate-50">
      {/* ── SHAPE ── the question the two below depend on. A rectangle has four
          named sides; a circle has one ring and reads its DIAMETER out of the
          length column. Asking it first is why the edge buttons underneath can
          be trusted. */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Shape</span>
        <div className="flex items-center gap-1 flex-wrap">
          {PIECE_SHAPES.map(s => (
            <button key={s} type="button" disabled={disabled} onClick={() => setShape(s)}
              aria-pressed={parseShape(shape) === s}
              className={`text-[11px] font-semibold px-2 py-1 rounded border transition disabled:opacity-40 ${
                parseShape(shape) === s
                  ? "border-slate-400 bg-slate-100 text-slate-800"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              {SHAPE_LABEL[s]}
            </button>
          ))}
        </div>
        {/* The dimension columns do not move; what they MEAN does. A circle's
            diameter lives in the length column, so the card says so rather than
            leaving somebody to read 24 × 24 as a square. */}
        {parseShape(shape) !== "RECTANGLE" && (
          <span className="text-[11px] text-slate-400">
            {labels.length} = {row.length ?? "?"}
            {labels.width && <> · {labels.width} = {row.width ?? "?"}</>}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Hand edge polish
        </span>
        {!chosen && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
            not chosen
          </span>
        )}
        {saving && <span className="text-[10px] text-slate-400">saving…</span>}
      </div>

      {/* ── WHICH FACES, THEN WHICH SIDES OF EACH ─────────────────────────────
          scripts/0067, and it replaces two controls that used to live here: a
          row of four edge buttons, and a TOP / BOTTOM / BOTH strip under it.

          Those asked ONE question for all faces at once, which is exactly what
          the owner said the job is not: "choose the number of side for top, no
          of side for bottom, and no of side for side." Three counts that move
          independently cannot come out of one selection and a multiplier.

          So: chips to pick the faces, then one diagram at a time for the face
          being edited — WITH THAT FACE'S OWN RATE beside its drawing, and what
          that face costs under the box that set it.

          Same control the supervisor's board uses, so the two screens cannot
          draw the same piece differently OR quote it differently. The separate
          <PolishTerms> block that used to sit below is gone: its per-face rate
          band was four inches from the face it priced, which is the layout the
          owner called clumsy. */}
      <div className="mt-1">
        <HandPolishPicker
          shape={shape}
          lengthIn={row.length}
          widthIn={row.width}
          unit={row.dimUnit}
          faces={faces}
          terms={terms}
          priced={priced}
          cardRate={priced.rate?.edgePerFoot ?? null}
          disabled={disabled}
          onChange={(nextFaces, nextTerms) => {
            setFaces(nextFaces);
            setTerms(nextTerms);
            void saveTerms(nextFaces, nextTerms);
          }}
        />
      </div>

      {chosen && (
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {/* The one state the picker cannot express: back to "nobody has
              chosen", which is not the same as "no edges" and is the only way
              to undo having opened a row by mistake. */}
          <button type="button" disabled={disabled}
            onClick={() => { setFaces({}); void saveTerms({}, terms); void save(null); }}
            title="Put this row back to 'not chosen' — different from 'no edges'"
            className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:text-slate-700 disabled:opacity-40 transition">
            Not chosen
          </button>
          {!round && POLISH_FACES.some((f) => faceCounts[f] > 0) && (
            <span className="text-[10px] text-slate-400 tabular-nums">
              {POLISH_FACES.filter((f) => faceCounts[f] > 0)
                .map((f) => `${f} ${faceCounts[f]} of ${capacity}`)
                .join(" · ")}
            </span>
          )}
        </div>
      )}

      {/* THE RATE BOXES USED TO BE HERE. They are inside the control above now,
          each beside the face it prices — see the note on that mount. */}

      {POLISH_FACES.some((f) => faceCounts[f] > 0) && (
        <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
          {describeFaceEdges(shape, faces)} on all {row.quantity} pc{row.quantity === 1 ? "" : "s"}
          {POLISH_FACES.filter((f) => faceCounts[f] > 0).length > 1 && (
            <span className="text-amber-700 font-semibold">
              {" "}· {POLISH_FACES.filter((f) => faceCounts[f] > 0).length} faces, walked separately
            </span>
          )}
          {priced.rateSource === "ROW" && (
            <span className="text-indigo-600 font-semibold"> · own rate</span>
          )}
          {priced.edgeOverridden && (
            <span className="text-violet-700 font-semibold"> · total typed</span>
          )}
          {" · "}<strong className="text-slate-700">{priced.runningFeet} ft</strong>
          {priced.unpriced
            ? priced.unpricedReason === "EDGES"
              ? <span className="text-amber-700"> · edges do not match the shape — re-pick them</span>
              : priced.unpricedReason === "SHAPE"
              ? <span className="text-amber-700"> · L / curve / custom outline — quote the hand polish by hand</span>
              : priced.unpricedReason === "DIMENSIONS"
                ? <span className="text-amber-700"> · no size on this row, so nothing to charge yet</span>
                : priced.unpricedReason === "RATE"
                ? <span className="text-amber-700"> · per piece / lump sum needs its own rate — the card is per foot</span>
                : <span className="text-slate-400"> · rate once it is on 2 cm or 3 cm stone</span>
            : <> · <strong className="text-indigo-700">{formatRupees(priced.edgeCost)}</strong></>}
        </p>
      )}
    </div>
  );
}

/* -- One card -------------------------------------------------------------- */

function Card({
  card, row, busy, onSet, onMerge, mergeInto, onEdges, onShape, onFace, onError,
}: {
  card: DraftCard;
  row: PoSinkRow;
  busy: boolean;
  /** The row's new sink count, absolute. Draft only — nothing is written. */
  onSet: (rowId: string, sinkQuantity: number) => void;
  onMerge: (fromId: string, intoId: string) => void;
  /** A SAVED sibling of identical size this card could be folded back into. */
  mergeInto: PoSinkRow | null;
  /** An edge selection that HAS been written. Not part of the draft — see the
   *  note at the top of the file on why the two behave differently. */
  onEdges: (rowId: string, finishedEdges: string | null) => void;
  /** A shape change. `clearedEdges` is true when it crossed between round and
   *  cornered, which the route clears server-side — the card must follow. */
  onShape: (rowId: string, shape: string, clearedEdges: boolean) => void;
  onFace: (rowId: string, face: string) => void;
  onError: (message: string) => void;
}) {
  const [partial, setPartial] = useState("");

  if (card.locked) {
    return (
      <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 opacity-70">
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono font-bold text-sm text-slate-600">{card.label}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">On the cutter</span>
        </span>
        <span className="block text-[11px] text-slate-400 mt-0.5">
          {dims(row)} &middot; {card.quantity} pc{card.quantity === 1 ? "" : "s"} &middot; its pieces
          already carry this row&apos;s code
        </span>
        {/* THE EDGES ARE STILL CHANGEABLE ON A LOCKED ROW, and the sink is not.
            The difference is what each one costs to change: a sink count moves
            pieces between two different route sheets that are already cut, so it
            is frozen once the row is on the floor. Hand edge polish is a job
            that happens AFTER cutting and polishing, so a customer ringing up to
            ask for a polished front edge on Thursday is an ordinary thing to say
            yes to. The route re-stamps the pieces that have not been packed. */}
        <EdgeChoice row={row} busy={busy} onSaved={onEdges} onShape={onShape} onFace={onFace} onError={onError} />
      </li>
    );
  }

  // THE NUMBER IS ABOUT THIS CARD, NOT THE ROW — the supervisor board's own
  // arithmetic, kept because it is what reads correctly when a row is already
  // split across both columns:
  //
  //   left  "Or move only 5"  -> five MORE of this card's pieces get a sink
  //   right "Or keep only 5"  -> five of this card's pieces keep theirs
  //
  // The row's new sink count is derived from that. Making the box mean "the
  // row's sink count" instead would read as nonsense on the left half of an
  // already-split row: "move only 30" when twenty already have sinks.
  const shownSink = card.side === "sink" ? card.quantity : row.quantity - card.quantity;
  const typed = partial === "" ? card.quantity : Number(partial);
  const valid = Number.isInteger(typed) && typed >= 0 && typed <= card.quantity;
  const target = card.side === "plain" ? shownSink + typed : typed;
  const willChange = valid && target !== shownSink;
  const willSplit = valid && target > 0 && target < row.quantity;

  return (
    <li
      draggable={!busy}
      onDragStart={e => {
        e.dataTransfer.setData(DRAG_TYPE, card.sourceId);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`rounded-xl border bg-white ${
        card.isNew ? "border-dashed border-indigo-300 bg-indigo-50/30"
          : card.side === "sink" ? "border-orange-200" : "border-slate-200"}`}
    >
      <button
        type="button"
        onClick={() => onSet(card.sourceId, card.side === "plain" ? row.quantity : 0)}
        disabled={busy}
        aria-label={
          card.side === "plain"
            ? `Give all ${row.quantity} piece(s) of ${card.label} a sink`
            : `Take the sink off all ${row.quantity} piece(s) of ${card.label}`
        }
        className="w-full text-left px-4 py-3 hover:bg-slate-50 disabled:opacity-50 rounded-t-xl transition"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono font-bold text-sm text-slate-800">
            {card.label}
            {card.isNew && <span className="ml-1 text-[10px] font-semibold text-indigo-600">new row</span>}
          </span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            card.side === "sink" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
            {card.quantity} {card.side === "sink" ? "with sink" : "no sink"}
          </span>
        </span>
        <span className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
          <span>{dims(row)}</span>
          {card.undecided && <span className="text-amber-700 font-semibold">&middot; nobody has decided yet</span>}
          {card.isNew && (
            <span className="text-indigo-600 font-semibold">
              &middot; appears when you save &mdash; gets its own letter then
            </span>
          )}
        </span>
        <span className="block text-[11px] text-indigo-600 mt-1">
          {card.side === "plain"
            ? `Click to give all ${row.quantity} a sink →`
            : `← Click to take the sink off all ${row.quantity}`}
        </span>
      </button>

      <div className="flex items-end gap-2 px-4 pb-3 pt-1 border-t border-slate-50 flex-wrap">
        <div>
          <label htmlFor={`po-sink-${card.key}`} className="block text-[10px] font-medium text-slate-400 mb-0.5">
            {card.side === "plain" ? "Or move only" : "Or keep only"}
          </label>
          <input
            id={`po-sink-${card.key}`}
            type="number"
            min={0}
            max={card.quantity}
            value={partial}
            placeholder={String(card.quantity)}
            disabled={busy}
            onChange={e => setPartial(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && willChange) { e.preventDefault(); onSet(card.sourceId, target); setPartial(""); }
              if (e.key === "Escape") setPartial("");
            }}
            className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => { onSet(card.sourceId, target); setPartial(""); }}
          disabled={busy || !willChange}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40 transition"
        >
          {willSplit ? "Split" : card.side === "plain" ? "Move these" : "Keep these"}
        </button>

        {/* A SPLIT THAT WAS ALREADY SAVED cannot be undone by dragging — the two
            halves are real rows now, and moving one back would leave two rows of
            the same thing. This folds it home. Offered only when there is
            exactly ONE unlocked row of identical size to fold into, so it can
            never guess wrong. */}
        {mergeInto && !card.isNew && (
          <button
            type="button"
            onClick={() => onMerge(row.id, mergeInto.id)}
            disabled={busy}
            title={`Put these ${row.quantity} pieces back into ${rowLabel(mergeInto.rowLetter, mergeInto.pieceLabel)}, making one row of ${row.quantity + mergeInto.quantity} again.`}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 disabled:opacity-40 transition"
          >
            Merge into {rowLabel(mergeInto.rowLetter, mergeInto.pieceLabel)}
            {/* The size, so the button names the row it is merging into. */}
            <span className="font-normal opacity-70"> {dims(mergeInto)}</span>
          </button>
        )}
      </div>

      {/* ON THE SAVED CARD ONLY.
          A row drawn as two cards is still ONE fab_requirement until the split
          is saved, so both halves share one finished_edges column. Offering the
          control twice would be two switches wired to one lamp — click either
          and both move. The provisional half says so instead, and gets its own
          control the moment it becomes a real row. */}
      {card.isNew ? (
        <p className="px-4 pb-3 text-[11px] text-indigo-600">
          Hand edge polish follows {card.label} until you save this split — then this row gets
          its own letter and its own edge decision.
        </p>
      ) : (
        <EdgeChoice row={row} busy={busy} onSaved={onEdges} onShape={onShape} onFace={onFace} onError={onError} />
      )}
    </li>
  );
}

/* -- The board ------------------------------------------------------------- */

export function PoSinkBoard({
  poId, rows: incomingRows, busy: parentBusy = false, onChanged,
}: {
  poId: string;
  rows: PoSinkRow[];
  busy?: boolean;
  /** Reload. Called after a SAVE, never during drafting. */
  onChanged: () => Promise<void> | void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState<SinkSide | null>(null);
  /** rowId -> pending sink count. Kept in localStorage per PO, so a refresh or a
   *  sleeping tablet does not throw away a half-marked order. */
  const [draft, setDraft] = useState<Map<string, number>>(new Map());
  /** When a stored draft was last written, if this page restored one. Shown,
   *  because a silent restore is how somebody saves a decision from last week. */
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  /** Each entry is one reversible step: the row and what its draft held before. */
  const [history, setHistory] = useState<Array<{ id: string; previous: number | undefined }>>([]);
  const busy = parentBusy || saving;

  /* -- WHAT HAS ALREADY BEEN WRITTEN, held over the props -------------------
   *
   * NOT THE DRAFT. These three have been saved to fab_requirement; this map
   * only carries the answer between the click and the next reload of `rows`,
   * which the parent owns. Without it a click would flip back the instant React
   * re-rendered from the untouched prop, and the manager would be told his
   * change had failed when it had not.
   *
   * ONE MAP FOR ALL THREE, because they interact: choosing a circle clears the
   * edge selection server-side, and the card has to show both halves of that in
   * the same render or it flickers through an impossible state — a circle with
   * "Front + Left" still lit.
   *
   * Cleared per field whenever the parent hands over a row that already agrees
   * — see the effect below — so a reload is always believed over a stale local
   * answer, field by field rather than all or nothing.
   */
  interface RowOverride {
    finishedEdges?: string | null;
    shapeType?: string | null;
    edgeFaces?: string | null;
  }
  const [overrides, setOverrides] = useState<Map<string, RowOverride>>(new Map());

  const rows = useMemo(
    () => incomingRows.map(r => {
      const o = overrides.get(r.id);
      return o ? { ...r, ...o } : r;
    }),
    [incomingRows, overrides],
  );

  useEffect(() => {
    setOverrides(m => {
      if (m.size === 0) return m;
      let changed = false;
      const next = new Map(m);
      for (const r of incomingRows) {
        const o = next.get(r.id);
        if (!o) continue;
        // Field by field: the server may have caught up on the shape while the
        // face is still in flight, and dropping the whole entry would flip the
        // face back for one render.
        const settled: RowOverride = { ...o };
        if ("finishedEdges" in settled && (r.finishedEdges ?? null) === (settled.finishedEdges ?? null)) delete settled.finishedEdges;
        if ("shapeType" in settled && (r.shapeType ?? null) === (settled.shapeType ?? null)) delete settled.shapeType;
        if ("edgeFaces" in settled && (r.edgeFaces ?? null) === (settled.edgeFaces ?? null)) delete settled.edgeFaces;
        if (Object.keys(settled).length === 0) { next.delete(r.id); changed = true; }
        else if (Object.keys(settled).length !== Object.keys(o).length) { next.set(r.id, settled); changed = true; }
      }
      for (const id of next.keys()) {
        if (!incomingRows.some(r => r.id === id)) { next.delete(id); changed = true; }
      }
      return changed ? next : m;
    });
  }, [incomingRows]);

  const patchRow = useCallback((rowId: string, patch: RowOverride) => {
    setOverrides(m => new Map(m).set(rowId, { ...(m.get(rowId) ?? {}), ...patch }));
  }, []);

  const setEdges = useCallback((rowId: string, finishedEdges: string | null) => {
    patchRow(rowId, { finishedEdges });
  }, [patchRow]);

  const setShape = useCallback((rowId: string, shapeType: string, clearedEdges: boolean) => {
    // The route clears finished_edges when the shape crosses between round and
    // cornered. Mirroring it here is what stops the card showing "Front + Left"
    // on a circle for the one render before the parent reloads.
    patchRow(rowId, clearedEdges ? { shapeType, finishedEdges: null } : { shapeType });
  }, [patchRow]);

  const setFace = useCallback((rowId: string, edgeFaces: string) => {
    patchRow(rowId, { edgeFaces });
  }, [patchRow]);

  const shaped = useMemo(() => rows.map(r => ({
    id: r.id,
    label: rowLabel(r.rowLetter, r.pieceLabel),
    quantity: r.quantity,
    sinkQuantity: r.sinkQuantity,
    locked: r.locked,
  })), [rows]);

  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const cards = useMemo(() => draftCards(shaped, draft), [shaped, draft]);
  const changes = useMemo(() => draftChanges(shaped, draft), [shaped, draft]);
  const pending = changes.length;

  // STAY IN STEP WITH THE ORDER.
  //
  // The rows are fetched once on mount, so a row added or edited in the table
  // below — or by somebody else entirely — left the board showing yesterday's
  // order. It reloads whenever the tab comes back to the front, and there is a
  // Refresh beside the Undo for when it is already in front. The DRAFT is
  // untouched by a reload: it is keyed by row id, so it re-applies to whatever
  // the order now says, and entries for rows that have gone are pruned below.
  useEffect(() => {
    const back = () => { if (document.visibilityState === "visible") void onChanged(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [onChanged]);

  // RESTORE, ON MOUNT ONLY.
  //
  // In an effect rather than a lazy useState initialiser: this component is
  // server-rendered first, where `window` does not exist, and an initialiser
  // that read storage would either crash there or hydrate to different markup
  // than the server sent.
  useEffect(() => {
    const stored = readDraft(poId);
    if (!stored) return;
    setDraft(new Map(stored.entries));
    setRestoredAt(stored.savedAt);
  }, [poId]);

  // A row that vanished under the draft — deleted, merged away, or split by
  // somebody else — must not keep a pending number nobody can see or save. The
  // pruned draft is written straight back, so the stale entry does not come
  // round again on the next reload.
  useEffect(() => {
    if (rows.length === 0) return;   // not loaded yet; nothing has "vanished"
    setDraft(d => {
      let dropped = false;
      const next = new Map(d);
      for (const id of next.keys()) if (!byId.has(id)) { next.delete(id); dropped = true; }
      if (!dropped) return d;
      writeDraft(poId, next);
      return next;
    });
  }, [byId, rows.length, poId]);

  /**
   * EVERY CHANGE TO THE DRAFT GOES THROUGH HERE, and is written to storage in
   * the same breath.
   *
   * Explicitly, rather than through an effect watching `draft`: effects run in
   * declaration order, so a persist-on-change effect would fire once with the
   * EMPTY initial map before the restore effect above had put anything in it —
   * and clear the very draft it was meant to protect.
   */
  const applyDraft = useCallback((mutate: (next: Map<string, number>) => void) => {
    setSavedNote(null);
    setRestoredAt(null);           // it is his again the moment he touches it
    setDraft(d => {
      const next = new Map(d);
      mutate(next);
      writeDraft(poId, next);
      return next;
    });
  }, [poId]);

  const set = useCallback((rowId: string, sinkQuantity: number) => {
    setHistory(h => [...h, { id: rowId, previous: draft.get(rowId) }]);
    applyDraft(next => next.set(rowId, sinkQuantity));
  }, [applyDraft, draft]);

  /** Every row nobody has answered for, one way — still only the draft. */
  const bulk = useCallback((target: SinkSide) => {
    const steps: Array<{ id: string; previous: number | undefined }> = [];
    applyDraft(next => {
      for (const r of rows) {
        if (r.locked) continue;
        const seen = draftValue(
          { id: r.id, label: "", quantity: r.quantity, sinkQuantity: r.sinkQuantity }, next,
        );
        if (seen != null) continue;
        steps.push({ id: r.id, previous: next.get(r.id) });
        next.set(r.id, target === "sink" ? r.quantity : 0);
      }
    });
    if (steps.length) setHistory(h => [...h, ...steps]);
  }, [applyDraft, rows]);

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    applyDraft(next => {
      if (last.previous === undefined) next.delete(last.id);
      else next.set(last.id, last.previous);
    });
    setHistory(h => h.slice(0, -1));
  }

  function discard() {
    applyDraft(next => next.clear());
    setHistory([]);
    setActionError(null);
  }

  async function save() {
    if (pending === 0) return;
    setActionError(null);
    setSaving(true);
    const res = await postJson(`/api/fab/manager/pos/${poId}/sinks/commit`, {
      rows: changes.map(c => ({ id: c.id, sinkQuantity: c.to })),
    });
    setSaving(false);
    if (!res.ok) { setActionError(res.error); return; }
    // Only now is anything real. The stored draft goes with it — leaving it
    // behind would restore already-saved decisions on the next reload and offer
    // to save them again.
    setDraft(new Map());
    writeDraft(poId, new Map());
    setHistory([]);
    setRestoredAt(null);
    setSavedNote(String((res.data as { message?: string })?.message ?? "Saved."));
    await onChanged();
  }

  /** Fold an already-saved split back together. Kept separate from the draft on
   *  purpose: it deletes a real row, so it is not something to stack up and
   *  apply later. */
  async function merge(fromId: string, intoId: string) {
    setActionError(null);
    setSaving(true);
    const res = await postJson(`/api/fab/manager/pos/rows/${fromId}/merge`, { intoId, sinkQuantity: null });
    setSaving(false);
    if (!res.ok) { setActionError(res.error); return; }
    setSavedNote("Rows merged back into one.");
    await onChanged();
  }

  function onDrop(side: SinkSide, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const row = byId.get(id);
    if (!row || row.locked) return;
    // A drop takes the WHOLE row, same as clicking it. No drag gesture can say
    // "20 of the 60" — that is what the number on the card is for.
    set(row.id, side === "sink" ? row.quantity : 0);
  }

  /**
   * THE ONE SAVED ROW THIS ONE COULD BE FOLDED BACK INTO.
   *
   * Only offered when there is EXACTLY ONE unlocked, unallocated row of
   * identical size on the other side — then "merge into X" cannot guess wrong.
   * Two candidates and it stays silent rather than picking one.
   */
  function mergeTargetFor(row: PoSinkRow): PoSinkRow | null {
    if (draft.has(row.id)) return null;         // mid-draft: not a saved shape
    const side = sideOf(row.quantity, row.sinkQuantity);
    const candidates = rows.filter(o =>
      o.id !== row.id &&
      !draft.has(o.id) &&
      sideOf(o.quantity, o.sinkQuantity) !== side &&
      planSinkMerge(
        { id: o.id, quantity: o.quantity, lengthIn: o.length, widthIn: o.width, allocatedQuantity: o.allocatedQty, releasedPieces: o.pieceCount },
        { id: row.id, quantity: row.quantity, lengthIn: row.length, widthIn: row.width, allocatedQuantity: row.allocatedQty, releasedPieces: row.pieceCount },
      ).ok,
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic mb-4">
        Add piece rows to this purchase order first — then mark which of them need a sink.
      </p>
    );
  }

  // ROWS ARE COUNTED AS ROWS, CARDS AS CARDS.
  //
  // This is what "not synced with the actual data on the PO" turned out to be:
  // the column header printed cards.length under the words "Piece rows", and a
  // row split in the draft draws TWO cards while still being ONE ordered row.
  // An order of 18 rows could therefore read as 14, or 21, depending on how much
  // splitting was pending — a number that reconciles with nothing. draftShape()
  // counts the order; the columns count what is drawn; they are never the same
  // variable again.
  const shape = draftShape(shaped, draft);
  const plainCards = cards.filter(c => c.side === "plain");
  const sinkCards = cards.filter(c => c.side === "sink");
  const showSink = sinkCards.length > 0;
  const undecided = shape.undecidedRows;

  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">Sinks &amp; hand edge polish</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Click or drag a row to give its pieces a sink; type a number to split it.
            <strong className="text-slate-500"> Nothing is written until you save</strong> — move
            things around as much as you like, and a split you change your mind about simply
            disappears. Your unsaved work is kept if you reload.
          </p>
          {/* SAYING WHICH IS WHICH, rather than leaving a manager to discover
              that half this board saves on click and half does not. */}
          <p className="text-[11px] text-slate-400 mt-0.5">
            Hand edge polish is the separate running-foot job — not the machine polish, and not
            the sink&rsquo;s own polish, which comes with the sink.
            <strong className="text-slate-500"> Edge clicks save straight away</strong>, because
            they change one column and create no rows.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          {undecided > 0 && (
            <>
              <button type="button" onClick={() => bulk("plain")} disabled={busy}
                title="The rows nobody has answered for yet. Does not touch a decision already made."
                className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
                All {undecided} remaining plain
              </button>
              <button type="button" onClick={() => bulk("sink")} disabled={busy}
                className="text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
                …with sink
              </button>
            </>
          )}
          <button type="button" onClick={undo} disabled={busy || history.length === 0}
            className="text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-300 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
            Undo{history.length ? ` (${history.length})` : ""}
          </button>
          <button type="button" onClick={() => void onChanged()} disabled={busy}
            title="Re-read the order. Your unsaved draft is kept."
            className="text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-300 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
            Refresh
          </button>
        </div>
      </div>

      {/* THE LINE THAT RECONCILES WITH THE TABLE BELOW.
          Rows and pieces as the ORDER holds them — never card counts. If this
          disagrees with the rows table, something is genuinely wrong; before,
          the headers disagreed by design and there was no way to tell. */}
      <p className="text-[11px] text-slate-500 mb-2">
        <strong className="text-slate-700">{shape.rows}</strong> row{shape.rows === 1 ? "" : "s"} on this
        PO &middot; <strong className="text-slate-700">{shape.pieces}</strong> piece{shape.pieces === 1 ? "" : "s"} ordered
        {" "}&middot; {shape.sinkPieces} with a sink
        {shape.splitRows > 0 && (
          <span className="text-indigo-700">
            {" "}&middot; {shape.splitRows} row{shape.splitRows === 1 ? "" : "s"} drawn as two, pending save
          </span>
        )}
        {shape.lockedRows > 0 && <span className="text-slate-400"> &middot; {shape.lockedRows} on the cutter</span>}
      </p>

      <FabAlerts actionError={actionError} onDismiss={() => setActionError(null)} noun="board" />

      {/* THE ONE THING THAT MAKES A DRAFT SAFE: saying it is one. */}
      {pending > 0 && (
        <div className="mb-2 flex items-center gap-3 flex-wrap rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <span className="text-[11px] text-indigo-900">
            <strong>{pending} unsaved change{pending === 1 ? "" : "s"}</strong>
            {changes.some(c => c.splits) && (
              <> &middot; {changes.filter(c => c.splits).length} row
                {changes.filter(c => c.splits).length === 1 ? "" : "s"} will become two</>
            )}
            {restoredAt !== null
              ? <> &middot; picked up where you left off, {whenText(restoredAt)}</>
              : <> &middot; kept on this device until you save or discard</>}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button type="button" onClick={discard} disabled={busy}
              className="text-xs font-semibold text-slate-600 hover:text-slate-800 disabled:opacity-40 px-2 py-1 transition">
              Discard
            </button>
            <button type="button" onClick={save} disabled={busy}
              className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
              {saving ? "Saving…" : "Save & send to supervisor"}
            </button>
          </span>
        </div>
      )}
      {pending === 0 && savedNote && (
        <p className="mb-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {savedNote} The supervisor sees these rows now — he picks slabs for them and sends them to
          cutting.
        </p>
      )}

      <div className={`grid gap-4 ${showSink ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
        <section
          aria-label="Piece rows with no sink"
          onDragOver={e => { e.preventDefault(); setDragOver("plain"); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={e => onDrop("plain", e)}
          className={`rounded-2xl border p-3 transition ${
            dragOver === "plain" ? "border-indigo-400 bg-indigo-50/40" : "border-slate-200 bg-slate-50/40"}`}
        >
          <h4 className="text-xs font-bold text-slate-800 px-1 mb-2">
            No sink <span className="text-slate-400 font-normal">
              ({shape.plainRows} row{shape.plainRows === 1 ? "" : "s"}
              {plainCards.length !== shape.plainRows && <> &middot; {plainCards.length} card{plainCards.length === 1 ? "" : "s"}</>})
            </span>
            {undecided > 0 && <span className="text-amber-700 font-normal"> &middot; {undecided} not decided</span>}
          </h4>
          {plainCards.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-1 py-8 text-center">
              Every row has a sink. Drag one back, or click it on the right.
            </p>
          ) : (
            <ul className="space-y-2">
              {plainCards.map(c => {
                const row = byId.get(c.sourceId);
                if (!row) return null;
                return <Card key={c.key} card={c} row={row} busy={busy} onSet={set}
                  onMerge={merge} mergeInto={mergeTargetFor(row)}
                  onEdges={setEdges} onShape={setShape} onFace={setFace}
                  onError={setActionError} />;
              })}
            </ul>
          )}
        </section>

        {showSink && (
          <section
            aria-label="Piece rows with a sink"
            onDragOver={e => { e.preventDefault(); setDragOver("sink"); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => onDrop("sink", e)}
            className={`rounded-2xl border p-3 transition ${
              dragOver === "sink" ? "border-orange-400 bg-orange-50/60" : "border-orange-200 bg-orange-50/30"}`}
          >
            <h4 className="text-xs font-bold text-orange-800 px-1 mb-2">
              Sink <span className="text-orange-400 font-normal">
                ({shape.sinkRows} row{shape.sinkRows === 1 ? "" : "s"} &middot; {shape.sinkPieces} piece{shape.sinkPieces === 1 ? "" : "s"})
              </span>
            </h4>
            <ul className="space-y-2">
              {sinkCards.map(c => {
                const row = byId.get(c.sourceId);
                if (!row) return null;
                return <Card key={c.key} card={c} row={row} busy={busy} onSet={set}
                  onMerge={merge} mergeInto={mergeTargetFor(row)}
                  onEdges={setEdges} onShape={setShape} onFace={setFace}
                  onError={setActionError} />;
              })}
            </ul>
          </section>
        )}
      </div>

      {!showSink && (
        <p className="mt-3 text-xs text-slate-400">
          No sinks on this order yet. The Sink column appears as soon as you send the first row across.
        </p>
      )}
    </div>
  );
}
