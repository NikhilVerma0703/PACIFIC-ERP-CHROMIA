"use client";

// THE MACHINE COULD NOT DO IT — send this to the hand bench, and say what it costs.
//
// The owner: "already decided is also sent to hand later if machine doesn't
// support or busy or breakdown... it need to ask the cost on how much per feet,
// which all the side — top or bottom or side or any combo — and choose the
// number of side for top, no of side for bottom, no of side for side. And this
// can be per piece... they can send a piece or a row itself fully."
//
// So the dialog asks exactly three things, in that order:
//
//   1. WHICH FACES, and which sides of each   — the same picker the row uses
//   2. WHAT IT COSTS                          — the same terms control
//   3. THIS PIECE, OR THE WHOLE ROW           — two buttons, not a checkbox
//
// ─────────────────────── IT OPENS PREFILLED, AND THAT IS THE POINT ──────────
// "If in same row again a piece is sent like that, same applicable and prefilled
// for everything." The machine that broke is still broken; the second piece off
// it needs the same treatment as the first, and retyping the faces and the rate
// for each one is how a shift's worth of pieces end up with three different
// specifications by accident.
//
// THE AGREED TOTAL IS NEVER PREFILLED, though. A lump sum settled for one piece
// is by definition not a figure for the next — carrying it would bill the same
// total per piece across a row nobody quoted that way. The route drops it on
// the way out for the same reason.
//
// ─────────────────────── WHY THIS OVERRIDES THE ROW ─────────────────────────
// Everywhere else, a row where half the pieces differ is SPLIT. That rule is
// right for an ORDER, decided once at a desk with time to think. It is wrong
// for a machine failing at nine at night, which takes whatever is in front of
// it, mid-row, with nobody available to renumber an order around it. So this
// writes per PIECE and each one overrides its row for itself.

import { useCallback, useEffect, useState } from "react";
import {
  parseFaceEdges, faceEdgesUnset, serializeFaceEdges, faceEdgesFromLegacy,
  describeShapeSize,
  type FaceEdges,
} from "@/lib/fab/shape";
import { priceRow, parseEdges, formatRupees, thicknessLabel } from "@/lib/fab/pricing";
import { FacePolishPicker } from "@/components/fab/FacePolishPicker";
import { PolishTerms, type PolishTermsValue } from "@/components/fab/PolishTerms";

export interface HandTarget {
  /**
   * The pieces being sent. One, or several ticked on a queue.
   *
   * EMPTY IS A REAL CASE, not a missing one: the supervisor's board shows
   * ordered ROWS, not individual pieces, so from there the only sensible action
   * is "the whole row" and there are no piece ids to give. The dialog drops the
   * per-piece button when this is empty rather than offering one that cannot
   * name what it would send.
   */
  pieceIds: string[];
  /** Their ordered row — needed for the prefill lookup and for "whole row". */
  requirementId: string;
  /** For the drawing and the feet. */
  pieceLabel: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  /** scripts/0068 — the unit the customer ordered in, so the hand bench reads
   *  the same size the purchase order does. Display only. */
  dimUnit?: string | null;
  thicknessMm: number | null;
  shapeType: string | null;
  /** The row's own edge decision, so the dialog can open on it when this row
   *  has never had a piece sent to hand before — better than opening empty,
   *  because the hand bench is usually being asked to do the same work the
   *  machine was going to. */
  finishedEdges?: string | null;
  edgeFaces?: string | null;
  /** How many pieces of this row are still in progress, for the second button. */
  rowPieceCount?: number;
}

async function postJson(url: string, body: unknown) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: String(data?.error ?? `Failed (${res.status}).`) };
    return { ok: true as const, data };
  } catch {
    return { ok: false as const, error: "Could not reach the server — nothing was saved." };
  }
}

export function SendToHandDialog({
  target, onClose, onDone,
}: {
  target: HandTarget | null;
  onClose: () => void;
  /** Told how many pieces actually moved, so the caller can refresh. */
  onDone: (pieces: number) => void;
}) {
  const [faces, setFaces] = useState<FaceEdges>({});
  const [terms, setTerms] = useState<PolishTermsValue>({ pricingMode: null, rate: null, totalOverride: null, pairRate: null, rateTop: null, rateBottom: null, rateSide: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** WHERE THE PREFILL CAME FROM, or null when nothing was filled in.
   *  PREVIOUS_SEND  the last piece of this row sent to hand
   *  ROW_SPEC       the ordered row's own hand-polish specification
   *  The two are different promises and the banner has to say which. */
  const [prefilled, setPrefilled] = useState<null | "PREVIOUS_SEND" | "ROW_SPEC">(null);

  // Fetch the last spec used on this row. Falls back to the ROW's own edge
  // decision when nothing has been sent to hand from it yet.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setError(null);
    setPrefilled(null);
    setTerms({ pricingMode: null, rate: null, totalOverride: null, pairRate: null, rateTop: null, rateBottom: null, rateSide: null });
    setFaces(faceEdgesFromLegacy(parseEdges(target.finishedEdges ?? null), target.edgeFaces));

    (async () => {
      try {
        const res = await fetch(`/api/fab/send-to-hand?requirementId=${encodeURIComponent(target.requirementId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data?.prefill) return;
        const source = data?.source === "ROW_SPEC" ? "ROW_SPEC" as const : "PREVIOUS_SEND" as const;
        const p = data.prefill as { faces: { top: string | null; bottom: string | null; side: string | null }; rate: number | null; pairRate: number | null; rateTop: number | null; rateBottom: number | null; rateSide: number | null; pricingMode: string | null };
        if (!faceEdgesUnset(p.faces)) setFaces(parseFaceEdges(p.faces));
        setTerms({ pricingMode: p.pricingMode, rate: p.rate, totalOverride: null, pairRate: p.pairRate ?? null,
                   rateTop: p.rateTop ?? null, rateBottom: p.rateBottom ?? null, rateSide: p.rateSide ?? null });
        setPrefilled(source);
      } catch {
        // No prefill is not an error — it just means this is the first piece
        // off this row to go to hand.
      }
    })();
    return () => { cancelled = true; };
  }, [target]);

  // What this ONE piece comes to under the current answers. A row of one, so
  // the same function that prices everything else prices this — see
  // handPieceCharge, which builds exactly this input server-side.
  const priced = target
    ? priceRow({
        lengthIn: target.lengthIn, widthIn: target.widthIn,
        quantity: 1, sinkQuantity: 0,
        thicknessMm: target.thicknessMm, shape: target.shapeType,
        faceEdges: faces,
        rate: terms.rate, pricingMode: terms.pricingMode,
        edgeTotalOverride: terms.totalOverride,
        pairRate: terms.pairRate,
        rateTop: terms.rateTop,
        rateBottom: terms.rateBottom,
        rateSide: terms.rateSide,
      })
    : null;

  const send = useCallback(async (wholeRow: boolean) => {
    if (!target) return;
    setBusy(true);
    setError(null);
    const wire = serializeFaceEdges(faces);
    const res = await postJson("/api/fab/send-to-hand", {
      pieceIds: target.pieceIds,
      requirementId: target.requirementId,
      wholeRow,
      faces: {
        top: wire.top ? wire.top.split(",") : [],
        bottom: wire.bottom ? wire.bottom.split(",") : [],
        side: wire.side ? wire.side.split(",") : [],
      },
      rate: terms.rate,
      pairRate: terms.pairRate,
      rateTop: terms.rateTop,
      rateBottom: terms.rateBottom,
      rateSide: terms.rateSide,
      pricingMode: terms.pricingMode,
      totalOverride: terms.totalOverride,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onDone(Number(res.data?.pieces ?? 0));
    onClose();
  }, [target, faces, terms, onDone, onClose]);

  if (!target) return null;
  const rowCount = target.rowPieceCount ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
         role="dialog" aria-modal="true" aria-label="Send to hand polish">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">Send to hand polish</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {target.pieceLabel ?? "Row"}
              {/* The size, so the dialog names the piece and not just the row.
                  Whoever is being sent this work needs to know what it is. */}
              {target.lengthIn != null && (
                <span className="font-semibold text-slate-600">
                  {" "}{describeShapeSize(target.shapeType, { lengthIn: target.lengthIn, widthIn: target.widthIn }, target.dimUnit)}
                </span>
              )}
              {" "}&middot;{" "}
              {target.pieceIds.length > 0
                ? `${target.pieceIds.length} piece${target.pieceIds.length === 1 ? "" : "s"} selected`
                : "the whole row"}
              {" "}&middot; {thicknessLabel(target.thicknessMm)}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none disabled:opacity-40"
            aria-label="Close">&times;</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {prefilled && (
            // SAID OUT LOUD. A dialog that silently arrives filled in is one
            // somebody presses Send on without reading — and the figure it
            // carries was agreed for a different piece.
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1.5">
              {prefilled === "ROW_SPEC"
                ? "Filled in from this row's own hand-polish specification — the faces and rates already agreed for it. Change anything the bench is actually doing differently."
                : "Filled in from the last piece of this row sent to hand. Change anything that differs."}
            </p>
          )}

          <FacePolishPicker
            shape={target.shapeType}
            lengthIn={target.lengthIn}
            widthIn={target.widthIn}
            unit={target.dimUnit}
            value={faces}
            onChange={setFaces}
            disabled={busy}
          />

          <PolishTerms
            value={terms}
            onChange={setTerms}
            cardRate={priced?.rate?.edgePerFoot ?? null}
            calculated={priced?.calculatedEdgeCost ?? 0}
            disabled={busy}
            facesOn={{ top: !!faces.top, bottom: !!faces.bottom, side: !!faces.side }}
            pairApplies={!!faces.top && !!faces.bottom}
            pairedFeet={priced?.pairedFeet ?? 0}
            singleFeet={priced?.singleFeet ?? 0}
          />

          {/* What ONE piece comes to, so nobody presses Send on a figure they
              have not seen. */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs tabular-nums flex items-center justify-between">
            <span className="text-slate-500">Each piece</span>
            <span className="font-bold text-indigo-700">
              {priced?.unpriced
                ? <span className="text-amber-700 font-medium">not priced — {priced.unpricedReason?.toLowerCase()}</span>
                : <>{formatRupees(priced?.edgeCost ?? 0)}
                    <span className="ml-2 font-normal text-slate-400">{priced?.runningFeet ?? 0} ft</span></>}
            </span>
          </div>

          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy}
            className="text-[12px] px-3 py-1.5 rounded text-slate-500 hover:text-slate-700 disabled:opacity-40">
            Cancel
          </button>
          {(rowCount > target.pieceIds.length || target.pieceIds.length === 0) && (
            <button type="button" disabled={busy} onClick={() => void send(true)}
              title="Every piece of this row still in progress. Packaged and rejected pieces are left alone — one is finished and already charged, the other is not work anybody is doing."
              className={`text-[12px] font-semibold px-3 py-1.5 rounded transition disabled:opacity-40 ${
                target.pieceIds.length === 0
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100"
              }`}>
              {busy && target.pieceIds.length === 0 ? "Sending…" : `Send the whole row${rowCount ? ` (${rowCount})` : ""}`}
            </button>
          )}
          {target.pieceIds.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void send(false)}
              className="text-[12px] font-semibold px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition">
              {busy ? "Sending…" : `Send ${target.pieceIds.length} piece${target.pieceIds.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
