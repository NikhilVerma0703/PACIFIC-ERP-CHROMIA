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
//   3. sinks for those pieces — READ ONLY. Decided on the PO, shown here.
//   4. finished edges      — the supervisor's own charge to make
//   5. send to cutting     — last, once the pieces are on the slab
//
// ON A SAMPLE ORDER IT IS THREE STEPS, not five. "No sink and fabri in the
// samples": a sample is a flat piece of stone, so there is no sink count to show
// and no edge charge to make — edge work IS fabrication work (pricing.ts). Steps
// 3 and 4 are ABSENT rather than disabled, and a line in their place says why;
// a greyed-out sink board invites somebody to wonder what is wrong with it.
// Which order it is comes from the project's kind — lib/fab/sampleOrder.ts.
//
// STEP 3 STOPPED BEING A DECISION. The owner: "remove this decision from the
// supervisor itself about sink. If he wants to change he can edit them manually,
// because having this and that changes the complete flow."
//
// It had already moved twice: a separate screen (/fab/supervisor/sinks) over the
// whole project, then a board on this card scoped to the slab in front of him.
// Both let him set a PARTIAL — 30 of a row of 60 — which is the mixed row the
// PO-time split now exists to remove. Two screens deciding one thing, one able
// to undo what the other made homogeneous, is not a second chance; it is two
// answers. So the sink count is set once, on the PO, where a partial splits the
// row in two, and this screen only shows it.
//
// The board is commented out in place, and components/fab/SinkBoard.tsx is left
// in the tree with a note at its head.
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
import { SampleCutControl, type SamplingPickLists } from "@/components/fab/SampleCutControl";
// THE SINK BOARD IS RETIRED FROM THIS SCREEN.
//
// The owner: "remove this decision from the supervisor itself about sink. If he
// wants to change he can edit them manually, because having this and that
// changes the complete flow."
//
// Sinks are decided ONCE now, on the PO (manager/[projectId]/PoRequirementTable
// -> api/fab/manager/pos/rows/[id]/sink), where a partial SPLITS the row in two
// so every row downstream is one size, one thickness, one routing. This screen
// still SHOWS the answer — the supervisor has to know which pieces on the slab
// carry a sink — but it no longer sets it. The type is still imported because
// SinkSummary reads the same row shape.
//
// import { SinkBoard } from "@/components/fab/SinkBoard";
import { type SinkBoardRow } from "@/components/fab/SinkBoard";
// THE GRAPHICAL EDGE PICKER. This one IS the supervisor's to make, and it is the
// only place finished_edges is written.
import { EdgeBoard, type EdgePickerRow } from "@/components/fab/EdgePicker";
import { isSampleProject } from "@/lib/fab/sampleOrder";
import { useSamplingPickLists } from "@/components/sampling/SampleIntakeForm";
import { deleteJson, getJson, patchJson, postJson, type PostResult } from "@/lib/fab/postJson";
import { useQcSlabs } from "@/lib/fab/qcSlabs";
import { computeSlabLoss } from "@/lib/fab/slabLoss";
import { assignedPieceCount, decideAllocation, decideSendToCutting, slabLossPieces } from "@/lib/fab/slabAssignment";
import { describeRequirement } from "@/lib/fab/releasePlan";
import { rowLabel } from "@/lib/fab/pieceNaming";
import { offersReason } from "@/lib/sampling/fabIntake";

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
  /** A, B, C … The row's letter, and what its pieces are stickered with. */
  rowLetter: string | null;
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
  /** fab_requirement.finished_edges — also the ORDER ROW's decision, and the
   *  other half of what this row is worth. NULL = nobody has marked the edges,
   *  which is NOT the same as "no edges finished". */
  finishedEdges: string | null;
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
  /** Square feet already cut off this slab for samples — spent, not scrap,
   *  and not available to the purchase order. */
  sampledAreaSqft?: number | null;
  slabJobId: string | null;
  slabJobStatus: string | null;
  sent: boolean;
  rows: BoardSlabRow[];
}

/* -- Helpers --------------------------------------------------------------- */

/** "PO 10026 A" / "D-101 piece B" — the same naming the blocked-release
 *  message uses, so a row is called the same thing everywhere.
 *
 *  THE LETTER IS PASSED IN. describeRequirement leads with it deliberately —
 *  "piece A" is what is written on the stone — and this function used to drop
 *  it on the floor, so every row here was named by its piece_label instead. On
 *  a sample row that label is the colour, the finish AND the size, printed
 *  next to the size column. */
function nameOf(r: {
  drawingNumber?: string | null; poNumber?: string | null;
  pieceLabel?: string | null; rowLetter?: string | null; description?: string | null;
}): string {
  return describeRequirement({
    drawingNumber: r.drawingNumber,
    poNumber: r.poNumber,
    pieceLabel: r.pieceLabel,
    rowLetter: r.rowLetter,
    description: r.description,
  });
}

/**
 * WHAT THE ROW IS OF, when the letter does not say.
 *
 * A sample order's rows are each a different colour and finish and there is no
 * column for either, so "A" alone would make three rows indistinguishable. This
 * returns the piece_label only when it adds something the letter has not
 * already said — so a PO row shows its PDF row number, a sample row shows its
 * colour and finish, and a row whose label IS its letter shows nothing twice.
 */
function qualifierOf(r: { rowLetter?: string | null; pieceLabel?: string | null }): string | null {
  const letter = String(r.rowLetter ?? "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(letter)) return null;   // no letter — the label is the name
  const labelText = String(r.pieceLabel ?? "").trim();
  return labelText && labelText.toUpperCase() !== letter ? labelText : null;
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
function AddSlabPicker({ busy, onPick }: { busy: boolean; onPick: (qcId: string) => Promise<PostResult> }) {
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

/* -- What the order says about sinks. READ ONLY ----------------------------- *
 *
 * The supervisor no longer decides this — the PO does, and a partial there
 * splits the row — but he still has to know which pieces on the slab in front of
 * him carry a sink, because it changes what he is looking at and which rows go
 * on to fabrication.
 *
 * A PARTIAL ROW IS CALLED OUT rather than quietly averaged. After the PO-time
 * split a row is homogeneous, so "18 of 60" can only be a row that predates the
 * split — and that is worth a manager's attention, not a silent rounding.
 */
function SinkSummary({ rows }: { rows: SinkBoardRow[] }) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-gray-400">No pieces on this slab yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {rows.map(r => {
          const q = r.orderedQuantity;
          const s = Math.max(0, Math.min(q, r.sinkQuantity ?? 0));
          const all = s > 0 && s >= q;
          const none = s === 0;
          const skin = all
            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
            : none
              ? "bg-white text-gray-500 border-gray-200"
              : "bg-amber-50 text-amber-700 border-amber-200";
          return (
            <span key={r.requirementId}
              title={
                all ? `All ${q} pieces of this row carry a sink`
                  : none ? `No sinks on this row — it does not go to fabrication`
                    : `${s} of ${q} pieces carry a sink. Rows are meant to be all or nothing since sinks moved to the PO — split this one there.`
              }
              className={`text-[10px] font-bold px-2 py-1 rounded border whitespace-nowrap ${skin}`}>
              <span className="font-mono">{r.pieceLabel ?? "?"}</span>
              {" · "}
              {all ? "Sink" : none ? "Plain" : `${s} of ${q} — mixed`}
            </span>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400">
        {/* Where it IS changed, said plainly — otherwise the first reaction to a
            wrong sink count is to look for a control that is no longer here. */}
        Set on the purchase order, not here. To change one, open the project&apos;s PO
        rows and use the Sink column &mdash; a partial there splits the row in two.
      </p>
    </div>
  );
}

/* -- The "on this slab" quantity box --------------------------------------- */

/** One row's allocated quantity, as a box that CANNOT disagree with the database.
 *
 *  WHY IT IS ITS OWN COMPONENT AND WHY IT SNAPS BACK. It used to be an uncontrolled
 *  `defaultValue` input in the row map. When the server REFUSED the new figure — the
 *  over-allocation check, which exists precisely because another tablet may have taken
 *  the rest of the row a second earlier — the board was re-read, the refusal was
 *  printed at the top of the page (out of sight on a phone, and out of sight on a
 *  tablet once there are three slabs on the screen), and React left this box showing
 *  the number the database had just rejected: `defaultValue` only seeds a mounted
 *  input, so nothing put it back. The supervisor then filled the rest of the slab
 *  against a quantity that does not exist, and the next blur re-sent the same rejected
 *  figure. So the box follows the server's figure, and a refusal snaps it back to what
 *  is stored and says why HERE, under the number that was refused.
 *
 *  A ref holds the server's figure because the reset happens after the write resolved,
 *  and by then the board has been re-read — snapping back to the value captured when
 *  the blur fired would undo a change another tablet legitimately made in between. */
function AllocationQuantityBox({ row, slabCode, busy, onChangeRow }: {
  row: BoardSlabRow;
  slabCode: string;
  busy: boolean;
  onChangeRow: (allocationId: string, quantity: number) => Promise<PostResult>;
}) {
  const [text, setText] = useState(String(row.allocatedQuantity));
  const [refusal, setRefusal] = useState<string | null>(null);
  const stored = useRef(row.allocatedQuantity);
  useEffect(() => {
    // The stored figure moved — this write landing, or another tablet's. Either way
    // the box shows what is on the server, and any refusal it was carrying is spent.
    if (stored.current !== row.allocatedQuantity) {
      stored.current = row.allocatedQuantity;
      setText(String(row.allocatedQuantity));
      setRefusal(null);
    }
  }, [row.allocatedQuantity]);

  // One write at a time. `busy` disables this box the moment the write starts, and a
  // browser blurs an element it has just disabled — a second blur, with the new number
  // still typed and the stored one not yet re-read, is how the same change gets PATCHed
  // twice from one keystroke.
  const sending = useRef(false);
  const commit = async () => {
    const next = Number(text);
    if (sending.current || next === stored.current) return;
    sending.current = true;
    setRefusal(null);
    try {
      const res = await onChangeRow(row.allocationId, next);
      if (!res.ok) {
        setText(String(stored.current));
        setRefusal(res.error ?? "The change was refused — the slab still holds the figure shown.");
      }
    } finally {
      sending.current = false;
    }
  };

  return (
    <>
      <input
        type="number"
        min={1}
        max={row.orderedQuantity}
        value={text}
        disabled={busy}
        aria-label={`Pieces of ${nameOf(row)} on slab ${slabCode}`}
        onChange={e => setText(e.target.value)}
        // Committed on blur / Enter rather than per keystroke:
        // every change is a round trip that has to pass the
        // over-allocation check, and firing one per digit means
        // "1" is checked before "12" is finished being typed.
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`w-20 border rounded-lg px-2 py-1 text-xs ${refusal ? "border-red-300 bg-red-50" : "border-gray-200"}`}
      />
      {refusal && <p className="mt-1 max-w-[16rem] text-[11px] text-red-700">{refusal}</p>}
    </>
  );
}

/* -- One slab -------------------------------------------------------------- */

function SlabCard({
  slab, outstanding, projectId, busy,
  onAddRow, onChangeRow, onRemoveRow, onSend, onRemoveSlab,
  onFinishedEdgesChange, isSample,
  samplingLists, onSampleOpen, onSampleSaved,
}: {
  slab: BoardSlab;
  outstanding: BoardRequirement[];
  projectId: string;
  busy: boolean;
  onAddRow: (slabId: string, requirementId: string, quantity: number) => Promise<PostResult>;
  /** Returns the server's own reply, because a REFUSED quantity has to be undone on
   *  screen and explained beside the box — see AllocationQuantityBox. */
  onChangeRow: (allocationId: string, quantity: number) => Promise<PostResult>;
  onRemoveRow: (allocationId: string) => Promise<PostResult>;
  onSend: (slab: BoardSlab) => Promise<PostResult>;
  onRemoveSlab: (slab: BoardSlab) => Promise<PostResult>;
  // onSinkQuantityChange: retired with the sink board — the PO owns the sink
  // decision now, and this screen only displays it. See the import note.
  /** The edge decision is the ROW'S, not the slab's, so it must land on every
   *  slab the row sits on — the same contract the sink handler used to have. */
  onFinishedEdgesChange: (requirementId: string, finishedEdges: string | null) => void;
  /** This project is a sample order — cut, polish, pack, and nothing else. */
  isSample: boolean;
  /** The sampling colour chart and size list, loaded ONCE for the whole board.
   *  See the note where the page calls useSamplingPickLists. */
  samplingLists: SamplingPickLists;
  onSampleOpen: () => void;
  onSampleSaved: (message: string) => void;
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
      sampledAreaSqft: slab.sampledAreaSqft ?? 0,
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
    // So the greyed-out button explains the sample take-off rather than blaming
    // rows the supervisor can see and count for himself.
    sampledAreaSqft: loss.sampledAreaSqft,
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

  // STEP 3b's rows: the same requirement rows, plus what they are worth. The
  // THICKNESS comes from the SLAB, not the row — a requirement does not know
  // what stone it will be cut from until it is on one, and the rate card is
  // keyed on the stone (2 cm ₹15/ft, 3 cm ₹20/ft). Folded the same way, for the
  // same reason: one card per requirement, never two.
  const edgeRows = useMemo<EdgePickerRow[]>(() => {
    const byRequirement = new Map<string, EdgePickerRow>();
    for (const row of slab.rows) {
      if (byRequirement.has(row.requirementId)) continue;
      byRequirement.set(row.requirementId, {
        requirementId: row.requirementId,
        pieceLabel: row.pieceLabel,
        lengthIn: row.lengthIn,
        widthIn: row.widthIn,
        orderedQuantity: row.orderedQuantity,
        sinkQuantity: row.sinkQuantity,
        finishedEdges: row.finishedEdges,
        thicknessMm: slab.thicknessMm,
      });
    }
    return [...byRequirement.values()];
  }, [slab.rows, slab.thicknessMm]);

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

  // THE PICKED ROW CAN VANISH UNDER HIM. The board is re-read after every write and
  // whenever the project changes, and the row he had chosen may have been filled,
  // removed or rejected from another tablet in between. Nothing cleared pickedId, so
  // the dropdown went on naming a row that is no longer offered while the Add button
  // sat greyed out with no reason given — and the quantity beside it still showed how
  // many of that dead row to add. Dropping the pick the moment it leaves `outstanding`
  // puts the select back to "Choose a piece row…", which is the truth.
  useEffect(() => {
    if (pickedId && !outstanding.some(r => r.id === pickedId)) { setPickedId(""); setQty(""); }
  }, [outstanding, pickedId]);

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

      {/* STILL STEP 1 — the other thing that can be decided about a slab the
          moment it is picked: send it to the saw FOR SAMPLES instead of putting
          purchase-order pieces on it. It sits here, at the tail of step 1,
          because that is when the choice is made — not at the foot with step 4,
          which is about the PO work this slab would then not be doing.
          Deliberately NOT a numbered step: the four-step flow below is
          unchanged, and this is an alternative to it rather than a fifth thing
          to do. Nothing here creates a cutting job or touches an allocation. */}
      {offersReason("SPECIAL_CUT", slab) && (
        <div className="px-5 pb-3">
          <SampleCutControl
            reason="SPECIAL_CUT"
            slab={{ id: slab.id, slabCode: slab.slabCode, colour: slab.colour, thicknessMm: slab.thicknessMm, pacificQcId: slab.pacificQcId }}
            lists={samplingLists}
            onOpen={onSampleOpen}
            onSaved={onSampleSaved}
          />
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
                      <AllocationQuantityBox
                        row={row}
                        slabCode={slab.slabCode}
                        busy={busy}
                        onChangeRow={onChangeRow}
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
                  {[
                    nameOf(r),
                    qualifierOf(r),
                    dims(r.lengthIn, r.widthIn),
                    `${r.remainingQuantity} of ${r.quantity} left`,
                  ].filter(Boolean).join(" · ")}
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

      {/* STEP 3 — WHAT THE ORDER SAYS ABOUT SINKS. READ ONLY.
          The owner: "remove this decision from the supervisor itself about sink.
          If he wants to change he can edit them manually, because having this
          and that changes the complete flow."

          The sink board used to live here and could set a PARTIAL — 30 of a row
          of 60 — which is exactly the mixed row the PO-time split exists to
          remove. Two screens deciding the same thing, one of them able to undo
          what the other just made homogeneous, is not a second chance; it is two
          answers to one question.

          So it is now decided ONCE, on the PO, where a partial splits the row in
          two. This panel SHOWS the answer, because the supervisor still has to
          know which pieces on the slab in front of him carry a sink — he just no
          longer changes it here.

          The old board is commented out below rather than deleted, and
          components/fab/SinkBoard.tsx is left in the tree with a note. */}
      {!isSample && (
        <div className="border-t border-gray-100 px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
            Step 3 &middot; Sinks &mdash; as ordered
          </h3>
          <SinkSummary rows={sinkRows} />
        </div>
      )}
      {/*
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
      */}

      {/* STEP 4 — THE EDGES, and what they are worth.
          The owner's rule: "same row all have same, so let it be — we show them
          a graphical piece, they choose sides, and feet is calculated and paid."
          So one diagram per ORDERED ROW, not per piece, and the running feet and
          rupees move as he clicks. It writes fab_requirement.finished_edges, the
          same column the CEO board bills from, through the same pricing module —
          so what he sees here and what the CEO sees are one calculation.

          Deliberately AFTER the sinks and BEFORE Send to cutting: this IS the
          supervisor's charge to make, unlike the sink count above which the
          order settled. It does not block the send — a row with no edge decision
          is reported unpriced, not free. */}
      {isSample ? (
        /* THE TWO MISSING STEPS, NAMED. "No sink and fabri in the samples" — so
           there is no sink count to show and no edge charge to make, because
           edge work IS fabrication work. Saying so is the difference between a
           board that is deliberately shorter and one that looks broken. */
        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
            <strong>Sample order.</strong> No sinks and no fabrication on these pieces — they are
            cut, polished and packed. Packing one puts it on the sample shelf.
          </p>
        </div>
      ) : (
        <div className="border-t border-gray-100 px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
            Step 4 &middot; Finished edges &mdash; click the sides that get polished
          </h3>
          <EdgeBoard rows={edgeRows} busy={busy} onChange={onFinishedEdgesChange} />
        </div>
      )}

      {/* STEP 5 — and only now. */}
      {!slab.sent && (
        <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Step {isSample ? 3 : 5} &middot; Send to cutting
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

      {/* AFTER THE CUT — and only after it, which is why this is not up with the
          other control. A slab that has not been sent has no leftovers; it has
          unused space, which is the loss figure's business. Once it HAS been
          cut, the usable pieces that remain are the fab supervisor's to send to
          samples, and he is the only person who knows they exist.

          It replaces nothing: step 4 has already gone from this card by the time
          this appears (the block above renders only while !slab.sent), so the
          four steps still read 1, 2, 3, 4 in order and this is what the card
          says afterwards. */}
      {offersReason("OFFCUT", slab) && (
        <div className="border-t border-gray-100 px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
            After the cut &middot; Leftovers
          </h3>
          <SampleCutControl
            reason="OFFCUT"
            slab={{ id: slab.id, slabCode: slab.slabCode, colour: slab.colour, thicknessMm: slab.thicknessMm, pacificQcId: slab.pacificQcId }}
            lists={samplingLists}
            onOpen={onSampleOpen}
            onSaved={onSampleSaved}
          />
        </div>
      )}
    </div>
  );
}

/* -- The board ------------------------------------------------------------- */

export default function FabSlabAssignmentPage() {
  const { projects, projectId, setProjectId, loading: loadingProjects, error: projectsError } = useFabBoardProjects();
  // A SAMPLE ORDER RUNS THIS SAME BOARD, minus the two steps a flat sample
  // never sees: "no sink and fabri in the samples". The steps are not disabled,
  // they are absent — a greyed-out sink board on a sample order invites somebody
  // to wonder what is wrong with it.
  const isSample = isSampleProject(projects.find(p => p.id === projectId)?.kind);

  const [requirements, setRequirements] = useState<BoardRequirement[]>([]);
  const [slabs, setSlabs] = useState<BoardSlab[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // THE SAMPLING PICK-LISTS, LOADED ONCE FOR THE WHOLE BOARD AND ONLY ON
  // DEMAND. Every slab card carries a sample-stock control, so a per-card hook
  // would fetch the 56-colour chart once per card; and most visits to this
  // screen never open one at all, so nothing is fetched until the first control
  // is opened (wantSamples). It is held here rather than inside SampleCutControl
  // for the same reason the sink decision is held here: one copy, shared by
  // every card.
  const [wantSamples, setWantSamples] = useState(false);
  const samplingLists = useSamplingPickLists(wantSamples);
  const onSampleOpen = useCallback(() => setWantSamples(true), []);

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
   *  none.
   *
   *  The reply is RETURNED as well as reported: the page-level banner is the wrong
   *  and only place for a refusal that belongs to one box on one row three slabs
   *  down, so a caller that owns such a box gets the server's words to put beside
   *  it. Returned AFTER the reload, so a caller acting on a refusal is acting on a
   *  board that has already been re-read. */
  async function run(fn: () => Promise<PostResult>, success?: string | ((res: PostResult) => string)): Promise<PostResult> {
    setBusy(true); setActionError(null); setNotice(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error);
    else if (success) setNotice(typeof success === "function" ? success(res) : success);
    setBusy(false);
    await load();
    return res;
  }

  /*
   * RETIRED WITH THE SINK BOARD. Nothing on this screen writes sink_quantity any
   * more — the PO does, and a partial there splits the row. Kept rather than
   * deleted because it is the exact pattern onFinishedEdgesChange below follows,
   * and the reasoning in it is the reason that one exists.
   *
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
   *
   * const onSinkQuantityChange = useCallback((requirementId: string, sinkQuantity: number | null) => {
   *   setRequirements(rs => rs.map(r => (r.id === requirementId ? { ...r, sinkQuantity } : r)));
   *   setSlabs(ss => ss.map(s => ({
   *     ...s,
   *     rows: s.rows.map(row => (row.requirementId === requirementId ? { ...row, sinkQuantity } : row)),
   *   })));
   * }, []);
   */

  /**
   * ONE EDGE DECISION, APPLIED EVERYWHERE IT SHOWS.
   *
   * Identical to the sink handler above, and for the identical reason:
   * finished_edges belongs to the REQUIREMENT. A row split across five slabs
   * gets its edges polished once, so the picker under slab 1 has just changed
   * what the picker under slab 4 must show — and the running feet under slab 4
   * with it, or the same row would appear to be worth two different amounts on
   * one screen.
   */
  const onFinishedEdgesChange = useCallback((requirementId: string, finishedEdges: string | null) => {
    setSlabs(ss => ss.map(s => ({
      ...s,
      rows: s.rows.map(row => (row.requirementId === requirementId ? { ...row, finishedEdges } : row)),
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
                  onFinishedEdgesChange={onFinishedEdgesChange}
                  isSample={isSample}
                  samplingLists={samplingLists}
                  onSampleOpen={onSampleOpen}
                  // The board is NOT reloaded after a sample intake: nothing on
                  // it changes. No allocation is written, no slab state moves,
                  // and the loss figure is about the PO pieces on the slab. A
                  // refresh here would only make the screen flicker and hide the
                  // confirmation the supervisor is reading.
                  onSampleSaved={setNotice}
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
                      {/* THE LETTER, then what the row is of. The letter is what
                          the stone is stickered with, so it leads; the colour
                          and finish sit under it in grey because on a sample
                          order three rows would otherwise read A, B, C with
                          nothing to tell them apart. */}
                      <td className="px-4 py-2">
                        <span className="font-mono font-bold text-gray-800">
                          {rowLabel(r.rowLetter, r.pieceLabel ?? r.description)}
                        </span>
                        {qualifierOf(r) && (
                          <span className="block text-[11px] text-gray-400 font-normal">
                            {qualifierOf(r)}
                          </span>
                        )}
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
