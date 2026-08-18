"use client";

// SLAB ASSIGNMENT — the supervisor's board, slab first.
//
// ONE SCREEN, WORKED SLAB BY SLAB. The owner's words: "the supervisor send to
// cutting slab wise, once after assigning pieces and sink for pieces then he
// send to cutting." So every slab card reads top to bottom as the four steps he
// actually performs, in that order:
//
//   1. the slab            — which one he is standing at, and how full it is
//   2. pieces on this slab — add piece rows to it, with quantities
//   3. sinks for those pieces — the sink board, scoped to THIS slab's rows
//   4. send to cutting     — last, once 2 and 3 are both decided
//
// Step 3 used to be a separate screen (/fab/supervisor/sinks). It was the same
// board, over the whole project, decided in a different sitting — which is not
// how the work happens: he decides sinks for the pieces he is about to cut out
// of the slab in front of him. That route now redirects here and the board lives
// in components/fab/SinkBoard.tsx, unchanged in behaviour.
//
// WHY IT IS NOT THE PLANNING BOARD. That board works requirement-first: pick a
// piece row, hand it a slab. The shop works the other way round. A slab is a
// physical object standing against a wall; the supervisor walks up to it and
// decides what to get out of it, filling it from whatever is outstanding across
// every purchase order on the job until there is no useful space left. Asking
// him to name a slab once per piece row is asking him to hold the slab's
// remaining space in his head across two hundred separate decisions.
//
// So: pick a slab, then drop rows onto it with quantities, watching the loss
// figure as it fills. One requirement can be split across several slabs — that
// is the point — and the sum of those splits may never exceed what was ordered.
// The server enforces that inside a transaction; see the route. This screen
// greys the button using the SAME pure rule (decideAllocation), so what it
// offers and what the server accepts cannot drift.
//
// The loss is computeSlabLoss and only computeSlabLoss — the one function that
// knows the slab is stored in millimetres and the pieces in inches. It is
// recomputed here on every keystroke for the display, and again server-side at
// send-to-cutting, which is where the figure is persisted.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FabAlerts } from "@/components/fab/FabAlerts";
import { FabProjectSelect, useFabBoardProjects } from "@/components/fab/FabProjectSelect";
import { SinkBoard, type SinkBoardRow } from "@/components/fab/SinkBoard";
import { deleteJson, getJson, patchJson, postJson, type PostResult } from "@/lib/fab/postJson";
import { useQcSlabs } from "@/lib/fab/qcSlabs";
import { computeSlabLoss } from "@/lib/fab/slabLoss";
import { assignedPieceCount, decideAllocation, decideSendToCutting, slabLossPieces } from "@/lib/fab/slabAssignment";
import { describeRequirement } from "@/lib/fab/releasePlan";

/* -- Types ----------------------------------------------------------------- */

interface BoardAllocation {
  id: string;
  allocatedQuantity: number;
  slabId: string | null;
  slabCode: string | null;
  slabColour: string | null;
}
interface BoardRequirement {
  id: string;
  poId: string | null;
  poNumber: string | null;
  drawingNumber: string | null;
  pieceLabel: string | null;
  description: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  quantity: number;
  sinkQuantity: number | null;
  status: string;
  allocations: BoardAllocation[];
  allocatedQuantity: number;
  remainingQuantity: number;
}
interface BoardSlabRow {
  allocationId: string;
  requirementId: string;
  poNumber: string | null;
  drawingNumber: string | null;
  pieceLabel: string | null;
  description: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  orderedQuantity: number;
  /** fab_requirement.sink_quantity — the ORDER ROW's decision, carried on the
   *  slab view so step 3 sits under step 2. NULL = not looked at yet. */
  sinkQuantity: number | null;
  allocatedQuantity: number;
}
interface BoardSlab {
  id: string;
  slabCode: string;
  colour: string | null;
  thicknessMm: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  pacificQcId: string | null;
  slabJobId: string | null;
  slabJobStatus: string | null;
  sent: boolean;
  rows: BoardSlabRow[];
}

/* -- Helpers --------------------------------------------------------------- */

/** "PO 10026 Row 7" / "D-101 piece 2B" — the same naming the blocked-release
 *  message uses, so a row is called the same thing everywhere. */
function nameOf(r: {
  drawingNumber?: string | null; poNumber?: string | null;
  pieceLabel?: string | null; description?: string | null;
}): string {
  return describeRequirement({
    drawingNumber: r.drawingNumber,
    poNumber: r.poNumber,
    pieceLabel: r.pieceLabel,
    description: r.description,
  });
}

function dims(lengthIn: number | null, widthIn: number | null): string {
  if (lengthIn == null || widthIn == null) return "—";
  return `${lengthIn} × ${widthIn} in`;
}

function WastePill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] text-gray-400">waste unknown</span>;
  const [bg, txt] = pct < 0 ? ["bg-red-100", "text-red-700"]
    : pct > 40 ? ["bg-amber-100", "text-amber-700"]
    : pct > 20 ? ["bg-yellow-100", "text-yellow-700"]
    : ["bg-green-100", "text-green-700"];
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bg} ${txt}`}>{pct.toFixed(1)}% waste</span>;
}

/* -- Slab picker ----------------------------------------------------------- */

/** Reuses useQcSlabs / qcSlabsUrl — the picker plumbing that already knows
 *  PolishQc.slabThickness is free text ("3 cm", "2cm to 8mm") and that the list
 *  has to be searched server-side because the whole QC history is 8.4 MB. */
function AddSlabPicker({ busy, onPick }: { busy: boolean; onPick: (qcId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [thickness, setThickness] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const { search, setSearch, slabs, loading, error, capped } = useQcSlabs(open, thickness);

  function openPicker() {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  }
  function close() { setOpen(false); setSearch(""); }

  const panelStyle: React.CSSProperties = rect
    ? { position: "fixed", top: rect.bottom + 6, left: Math.max(8, rect.left), width: 340, zIndex: 9999 }
    : {};

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPicker}
        disabled={busy}
        className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition">
        + Add a slab
      </button>

      {open && typeof window !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={close} />
          <div style={panelStyle} className="bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <span className="text-xs font-bold text-gray-700">
                QC-passed slabs
                {/* "200+" not "200": a full page means the newest 200 matched,
                    not that the factory holds 200 slabs. */}
                <span className="ml-1 text-gray-400 font-normal">
                  ({capped ? `${slabs.length}+` : slabs.length} available)
                </span>
              </span>
              <button onClick={close} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Search slab number, colour or batch..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
              />
              <select
                aria-label="Thickness"
                value={thickness ?? ""}
                onChange={e => setThickness(e.target.value ? Number(e.target.value) : null)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="">Any</option>
                <option value="20">2 cm</option>
                <option value="30">3 cm</option>
              </select>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {/* "Nothing matched" and "the lookup failed" must not render as
                  the same empty list. */}
              {error && <p className="px-4 py-4 text-xs text-red-600">{error}</p>}
              {loading && !error && <p className="px-4 py-4 text-xs text-gray-400 italic">Searching...</p>}
              {!loading && !error && slabs.length === 0 && (
                <p className="px-4 py-4 text-xs text-gray-400 italic">No matching slabs</p>
              )}
              {slabs.map(q => (
                <button
                  key={q.pacificQcId}
                  onClick={async () => { await onPick(q.pacificQcId); close(); }}
                  className="w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition">
                  <span className="text-sm font-bold text-gray-900">Slab {q.slabCode}</span>
                  <span className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400">
                    {q.colour && <span>{q.colour}</span>}
                    {q.thicknessMm && <span>&middot; {q.thicknessMm}mm</span>}
                    {q.qualityGrade && <span>&middot; Grade {q.qualityGrade}</span>}
                    {q.batchKey && <span>&middot; {q.batchKey}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/* -- One slab -------------------------------------------------------------- */

function SlabCard({
  slab, outstanding, projectId, busy,
  onAddRow, onChangeRow, onRemoveRow, onSend, onRemoveSlab, onSinkQuantityChange,
}: {
  slab: BoardSlab;
  outstanding: BoardRequirement[];
  projectId: string;
  busy: boolean;
  onAddRow: (slabId: string, requirementId: string, quantity: number) => Promise<void>;
  onChangeRow: (allocationId: string, quantity: number) => Promise<void>;
  onRemoveRow: (allocationId: string) => Promise<void>;
  onSend: (slab: BoardSlab) => Promise<void>;
  onRemoveSlab: (slab: BoardSlab) => Promise<void>;
  onSinkQuantityChange: (requirementId: string, sinkQuantity: number | null) => void;
}) {
  const [pickedId, setPickedId] = useState("");
  const [qty, setQty] = useState("");

  // LIVE, on every render — this is the figure the supervisor watches while he
  // fills the slab. computeSlabLoss takes the slab in MILLIMETRES and the rows
  // in INCHES; slabLossPieces only renames allocatedQuantity, which is the
  // quantity that actually consumes material (a row split 3-and-7 must not be
  // charged 10 to each slab).
  const loss = useMemo(
    () => computeSlabLoss({
      slabLengthMm: slab.lengthMm,
      slabWidthMm: slab.widthMm,
      pieces: slabLossPieces(slab.rows),
    }),
    [slab.lengthMm, slab.widthMm, slab.rows],
  );

  const pieces = assignedPieceCount(slab.rows);
  const send = decideSendToCutting({
    slabLabel: `Slab ${slab.slabCode}`,
    assignedPieceCount: pieces,
    overCommitted: loss.overCommitted,
    usedAreaSqft: loss.usedAreaSqft,
    slabAreaSqft: loss.slabAreaSqft,
  });

  // STEP 3's rows: the requirement rows on THIS slab, and only those. One card
  // per requirement — an allocation is unique per (requirement, slab) on the
  // write path, but if two ever arrived the board would emit duplicate React
  // keys and duplicate input ids, so they are folded and their shares summed.
  const sinkRows = useMemo<SinkBoardRow[]>(() => {
    const byRequirement = new Map<string, SinkBoardRow>();
    for (const row of slab.rows) {
      const seen = byRequirement.get(row.requirementId);
      if (seen) { seen.onThisSlab += row.allocatedQuantity; continue; }
      byRequirement.set(row.requirementId, {
        requirementId: row.requirementId,
        poNumber: row.poNumber,
        drawingNumber: row.drawingNumber,
        pieceLabel: row.pieceLabel,
        description: row.description,
        lengthIn: row.lengthIn,
        widthIn: row.widthIn,
        orderedQuantity: row.orderedQuantity,
        sinkQuantity: row.sinkQuantity,
        onThisSlab: row.allocatedQuantity,
      });
    }
    return [...byRequirement.values()];
  }, [slab.rows]);

  const picked = outstanding.find(r => r.id === pickedId) ?? null;
  const wanted = Number(qty);
  // The same rule the server applies inside its transaction.
  const addCheck = picked
    ? decideAllocation({
        orderedQuantity: picked.quantity,
        existing: picked.allocations.map(a => ({ id: a.id, allocatedQuantity: a.allocatedQuantity })),
        allocationId: null,
        requestedQuantity: wanted,
        label: nameOf(picked),
      })
    : null;

  function pick(id: string) {
    setPickedId(id);
    const r = outstanding.find(x => x.id === id);
    // Default to everything that is left — filling a slab from one row is the
    // common case, and typing the number every time is friction on a tablet.
    setQty(r ? String(r.remainingQuantity) : "");
  }

  async function add() {
    if (!picked || !addCheck?.ok) return;
    await onAddRow(slab.id, picked.id, addCheck.allocatedQuantity);
    setPickedId("");
    setQty("");
  }

  return (
    <div className={`rounded-2xl border ${slab.sent ? "border-blue-200 bg-blue-50/20" : "border-gray-200 bg-white"}`}>
      <div className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {/* STEP 1 — the slab he is standing at. */}
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
            Step 1 &middot; The slab
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-gray-900">Slab {slab.slabCode}</span>
            {slab.colour && <span className="text-sm text-gray-500">{slab.colour}</span>}
            {slab.thicknessMm && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                {Math.round(slab.thicknessMm)}mm
              </span>
            )}
            {slab.sent && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600">
                {slab.slabJobStatus === "COMPLETED" ? "Cut complete"
                  : slab.slabJobStatus === "IN_PROGRESS" ? "Cutting"
                  : "Sent to cutter"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-gray-500">
            <span><b className="text-gray-800">{loss.usedAreaSqft}</b> sqft used</span>
            <span>
              <b className={loss.remainingAreaSqft < 0 ? "text-red-700" : "text-gray-800"}>
                {loss.remainingAreaSqft}
              </b> sqft left of {loss.slabAreaSqft}
            </span>
            <WastePill pct={loss.totalWastagePct} />
            <span>{pieces} piece{pieces === 1 ? "" : "s"} &middot; {slab.rows.length} row{slab.rows.length === 1 ? "" : "s"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!slab.sent && slab.rows.length === 0 && (
            <button
              onClick={() => onRemoveSlab(slab)}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-red-600 underline underline-offset-2 disabled:opacity-40">
              Remove slab
            </button>
          )}
          {/* Send to Cutter is NOT here. It is step 4 and it lives at the foot
              of the card, under the pieces and under the sinks, because that is
              the order he does them in. */}
        </div>
      </div>

      {/* Over-commitment is stated, not clamped: the pieces on this slab do not
          fit on it, and the fix is to move rows off rather than to round the
          number down and send a cutter to a slab that cannot hold the work. */}
      {!send.ok && slab.rows.length > 0 && (
        <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {send.error}
        </div>
      )}

      {/* STEP 2 — the pieces coming off this slab. */}
      <div className="border-t border-gray-100 px-5 py-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Step 2 &middot; Pieces on this slab
        </h3>
      </div>

      {slab.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {["Piece row", "Size", "On this slab", "Ordered", ""].map(h => (
                  <th key={h} scope="col" className="px-5 py-2 text-left text-gray-400 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {slab.rows.map(row => (
                <tr key={row.allocationId} className="hover:bg-gray-50/60">
                  <td className="px-5 py-2 font-mono font-bold text-gray-800">{nameOf(row)}</td>
                  <td className="px-5 py-2 font-mono text-gray-600">{dims(row.lengthIn, row.widthIn)}</td>
                  <td className="px-5 py-2">
                    {slab.sent ? (
                      <span className="font-bold text-gray-800">{row.allocatedQuantity}</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        max={row.orderedQuantity}
                        defaultValue={row.allocatedQuantity}
                        disabled={busy}
                        aria-label={`Pieces of ${nameOf(row)} on slab ${slab.slabCode}`}
                        // Committed on blur / Enter rather than per keystroke:
                        // every change is a round trip that has to pass the
                        // over-allocation check, and firing one per digit means
                        // "1" is checked before "12" is finished being typed.
                        onBlur={e => {
                          const next = Number(e.target.value);
                          if (next !== row.allocatedQuantity) onChangeRow(row.allocationId, next);
                        }}
                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs"
                      />
                    )}
                  </td>
                  <td className="px-5 py-2 text-gray-500">{row.orderedQuantity}</td>
                  <td className="px-5 py-2 text-right">
                    {!slab.sent && (
                      <button
                        onClick={() => onRemoveRow(row.allocationId)}
                        disabled={busy}
                        className="text-red-500 hover:text-red-700 underline underline-offset-2 disabled:opacity-40">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!slab.sent && (
        <div className="border-t border-gray-100 px-5 py-3 flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <label htmlFor={`add-${slab.id}`} className="block text-[11px] font-medium text-gray-500 mb-1">
              Add a piece row to this slab
            </label>
            <select
              id={`add-${slab.id}`}
              value={pickedId}
              disabled={busy || outstanding.length === 0}
              onChange={e => pick(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white disabled:opacity-50">
              <option value="">
                {outstanding.length === 0 ? "Every piece row already has a slab" : "Choose a piece row…"}
              </option>
              {outstanding.map(r => (
                <option key={r.id} value={r.id}>
                  {nameOf(r)} · {dims(r.lengthIn, r.widthIn)} · {r.remainingQuantity} of {r.quantity} left
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`qty-${slab.id}`} className="block text-[11px] font-medium text-gray-500 mb-1">
              Quantity
            </label>
            <input
              id={`qty-${slab.id}`}
              type="number"
              min={1}
              max={picked?.remainingQuantity ?? undefined}
              value={qty}
              disabled={busy || !picked}
              onChange={e => setQty(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && addCheck?.ok) add(); }}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-xs disabled:opacity-50"
            />
          </div>
          <button
            onClick={add}
            disabled={busy || !addCheck?.ok}
            title={addCheck && !addCheck.ok ? addCheck.error : undefined}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 transition">
            Add
          </button>
          {addCheck && !addCheck.ok && picked && (
            <p className="w-full text-[11px] text-amber-700">{addCheck.error}</p>
          )}
        </div>
      )}

      {/* STEP 3 — sinks for the pieces that are now on this slab, and only
          those. Same board as the retired /fab/supervisor/sinks screen: click
          or drag, the Sink column appearing on first use and gone again when
          the last row leaves, full quantity by default, partial typed, saved on
          every move, undoable. It writes against the ORDERED quantity, which is
          why every row carries both numbers. */}
      <div className="border-t border-gray-100 px-5 py-3">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
          Step 3 &middot; Sinks for these pieces
        </h3>
        <SinkBoard
          boardId={slab.id}
          slabLabel={`Slab ${slab.slabCode}`}
          projectId={projectId}
          rows={sinkRows}
          busy={busy}
          onSinkQuantityChange={onSinkQuantityChange}
        />
      </div>

      {/* STEP 4 — and only now. */}
      {!slab.sent && (
        <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Step 4 &middot; Send to cutting
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {send.ok
                ? "Pieces and sinks are decided — this creates the cutting job and records the slab's used area and wastage."
                : slab.rows.length > 0
                  // The over-commitment banner at the top of the card is already
                  // saying it in full; repeating it here reads as two problems.
                  ? "This slab cannot go yet — see the note at the top of the card."
                  : send.error}
            </p>
          </div>
          <button
            onClick={() => onSend(slab)}
            disabled={busy || !send.ok}
            title={send.ok ? "Create the cutting job for this slab" : send.error}
            className="shrink-0 text-xs font-bold bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition">
            Send to Cutter
          </button>
        </div>
      )}
    </div>
  );
}

/* -- The board ------------------------------------------------------------- */

export default function FabSlabAssignmentPage() {
  const { projects, projectId, setProjectId, loading: loadingProjects, error: projectsError } = useFabBoardProjects();

  const [requirements, setRequirements] = useState<BoardRequirement[]>([]);
  const [slabs, setSlabs] = useState<BoardSlab[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) { setRequirements([]); setSlabs([]); return; }
    setLoading(true);
    const [reqs, sl] = await Promise.all([
      getJson<BoardRequirement>(`/api/fab/supervisor/board?view=requirements&projectId=${encodeURIComponent(projectId)}`),
      getJson<BoardSlab>(`/api/fab/supervisor/board?view=slabs&projectId=${encodeURIComponent(projectId)}`),
    ]);
    setRequirements(reqs.data);
    setSlabs(sl.data);
    // Either failure makes the whole board untrustworthy: outstanding
    // quantities are the difference between the two lists.
    setLoadError(reqs.error ?? sl.error);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /** Every write goes through here: run it, report its own words on failure,
   *  then re-read the board. Re-reading rather than patching state locally is
   *  deliberate — the whole reason the server refuses over-allocation is that
   *  another tablet may have moved underneath this one, so after any write the
   *  only trustworthy numbers are the server's.
   *
   *  `success` may be a function of the reply, because send-to-cutting has
   *  something to report that only the server knows: how many pieces it created,
   *  and any row it could only release short. A fixed string there would have
   *  read the same for a slab that produced sixty pieces and one that produced
   *  none. */
  async function run(fn: () => Promise<PostResult>, success?: string | ((res: PostResult) => string)) {
    setBusy(true); setActionError(null); setNotice(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error);
    else if (success) setNotice(typeof success === "function" ? success(res) : success);
    setBusy(false);
    await load();
  }

  /**
   * ONE SINK DECISION, APPLIED EVERYWHERE IT SHOWS.
   *
   * sink_quantity belongs to the REQUIREMENT, not to the slab — so a row split
   * across five slabs is the same decision on all five, and the board under
   * slab 1 has just changed what the board under slab 4 must show. Holding the
   * rows here rather than inside each SinkBoard is what makes that true on
   * screen the instant it is true in the database: the row is already in the
   * Sink column when he scrolls down to the next slab.
   *
   * It is called twice per save — optimistically, then with what the server
   * actually stored (or with the old value, if the write failed and SinkBoard
   * is putting the row back).
   */
  const onSinkQuantityChange = useCallback((requirementId: string, sinkQuantity: number | null) => {
    setRequirements(rs => rs.map(r => (r.id === requirementId ? { ...r, sinkQuantity } : r)));
    setSlabs(ss => ss.map(s => ({
      ...s,
      rows: s.rows.map(row => (row.requirementId === requirementId ? { ...row, sinkQuantity } : row)),
    })));
  }, []);

  const outstanding = useMemo(
    () => requirements.filter(r => r.remainingQuantity > 0),
    [requirements],
  );
  const totals = useMemo(() => {
    const ordered = requirements.reduce((s, r) => s + r.quantity, 0);
    const allocated = requirements.reduce((s, r) => s + r.allocatedQuantity, 0);
    return { ordered, allocated, remaining: Math.max(0, ordered - allocated) };
  }, [requirements]);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Slab &amp; Sink Assignment</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Pick a slab, fill it from what is outstanding, mark the sinks, then send it to the cutter
          </p>
        </div>
        <button onClick={load} disabled={loading || busy}
          className="text-xs text-gray-500 border border-gray-200 hover:border-gray-300 disabled:opacity-40 px-3 py-1.5 rounded-lg transition">
          Refresh
        </button>
      </div>

      <FabProjectSelect
        projects={projects}
        projectId={projectId}
        onChange={setProjectId}
        disabled={loadingProjects || busy}
      />

      <FabAlerts
        loadError={projectsError ?? loadError}
        actionError={actionError}
        onDismiss={() => setActionError(null)}
        noun="board"
      />

      {notice && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start justify-between gap-4">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"
            className="shrink-0 font-bold text-green-400 hover:text-green-700">✕</button>
        </div>
      )}

      {loadingProjects || loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          Loading...
        </div>
      ) : !projectId ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200">
          No projects waiting to be planned. One appears here as soon as the manager imports a purchase order.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "Pieces ordered", value: totals.ordered },
              { label: "On a slab", value: totals.allocated },
              { label: "Still to place", value: totals.remaining },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className="text-lg font-semibold text-slate-900">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">
              Slabs on this project <span className="text-slate-400 font-normal">({slabs.length})</span>
            </h2>
            <AddSlabPicker
              busy={busy}
              onPick={qcId => run(
                () => postJson("/api/fab/supervisor/slab-assignment", {
                  action: "add-slab", projectId, pacificQcId: qcId,
                }),
              )}
            />
          </div>

          {slabs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200 mb-6">
              No slabs on this project yet. Add the slab you are standing at, then put piece rows on it.
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {slabs.map(slab => (
                <SlabCard
                  key={slab.id}
                  slab={slab}
                  outstanding={outstanding}
                  projectId={projectId}
                  busy={busy}
                  onSinkQuantityChange={onSinkQuantityChange}
                  onAddRow={(slabId, requirementId, quantity) => run(
                    () => postJson("/api/fab/supervisor/slab-assignment", {
                      action: "assign", slabId, requirementId, allocatedQuantity: quantity,
                    }),
                  )}
                  onChangeRow={(allocationId, quantity) => run(
                    () => patchJson("/api/fab/supervisor/slab-assignment", { allocationId, allocatedQuantity: quantity }),
                  )}
                  onRemoveRow={allocationId => run(
                    () => deleteJson(`/api/fab/supervisor/slab-assignment?allocationId=${encodeURIComponent(allocationId)}`),
                  )}
                  onRemoveSlab={s => run(
                    () => deleteJson(`/api/fab/supervisor/slab-assignment?slabId=${encodeURIComponent(s.id)}`),
                  )}
                  // STEP 4 is where the pieces are born. Sending the slab
                  // creates one fab_piece per allocated piece with its route
                  // sheet, then the cutting job, in one transaction — so the
                  // count below is what the cutter will actually find in his
                  // queue, and a slab that produced none never gets sent at all.
                  onSend={s => run(
                    () => postJson("/api/fab/approve-slab", { slabId: s.id }),
                    res => {
                      // created:false means a cutting job was already there —
                      // two taps on a slow tablet. Nothing was made and nothing
                      // was changed, and saying "0 pieces created" for that
                      // reads as a failure.
                      if (res.data?.created === false) {
                        return `Slab ${s.slabCode} had already been sent to the cutter — nothing was changed.`;
                      }
                      const made = Number(res.data?.piecesCreated ?? 0);
                      const already = Number(res.data?.piecesAlreadyPresent ?? 0);
                      const warnings: string[] = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
                      const pieces = already > 0
                        // The pieces were already there — an earlier send, or a
                        // project released the old way. Say so rather than
                        // reporting "0 pieces", which reads like a failure.
                        ? `Its ${already} piece${already === 1 ? "" : "s"} were already created.`
                        : `${made} piece${made === 1 ? "" : "s"} created with their route sheets.`;
                      return `Slab ${s.slabCode} sent to the cutter. ${pieces} Its used area and wastage are recorded against the cutting job.${
                        warnings.length ? ` ${warnings.join(" ")}` : ""
                      }`;
                    },
                  )}
                />
              ))}
            </div>
          )}

          <h2 className="text-sm font-bold text-slate-800 mb-3">
            Outstanding piece rows <span className="text-slate-400 font-normal">({outstanding.length})</span>
          </h2>
          {requirements.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200">
              This project has no piece rows yet. The manager uploads each purchase order&apos;s PDF to create them.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {["PO", "Piece row", "Size", "Ordered", "On slabs", "Left", "Slabs"].map(h => (
                      <th key={h} scope="col" className="px-4 py-2 text-left text-gray-400 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {requirements.map(r => (
                    <tr key={r.id} className={r.remainingQuantity === 0 ? "bg-green-50/40" : "hover:bg-gray-50/60"}>
                      <td className="px-4 py-2 text-gray-400">{r.poNumber ?? r.drawingNumber ?? "—"}</td>
                      <td className="px-4 py-2 font-mono font-bold text-gray-800">
                        {r.pieceLabel ?? r.description ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-600">{dims(r.lengthIn, r.widthIn)}</td>
                      <td className="px-4 py-2 text-gray-700">{r.quantity}</td>
                      <td className="px-4 py-2 text-gray-700">{r.allocatedQuantity}</td>
                      <td className={`px-4 py-2 font-bold ${r.remainingQuantity ? "text-amber-700" : "text-green-700"}`}>
                        {r.remainingQuantity}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {r.allocations.length === 0
                          ? <span className="text-gray-300">—</span>
                          : r.allocations.map(a => `${a.slabCode ?? "?"} ×${a.allocatedQuantity}`).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
