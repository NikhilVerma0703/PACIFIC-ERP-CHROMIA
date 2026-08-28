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

import { useCallback, useEffect, useMemo, useState } from "react";
import { FabAlerts } from "@/components/fab/FabAlerts";
import { postJson } from "@/lib/fab/postJson";
import { rowLabel } from "@/lib/fab/pieceNaming";
import {
  draftCards, draftChanges, draftShape, draftValue, planSinkMerge, sideOf,
  type DraftCard, type SinkSide,
} from "@/lib/fab/sinkSplit";

export interface PoSinkRow {
  id: string;
  pieceLabel: string | null;
  rowLetter: string | null;
  length: number | null;
  width: number | null;
  quantity: number;
  /** NULL = nobody has decided. After a saved split this is 0 or the quantity. */
  sinkQuantity: number | null;
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
  if (r.length == null || r.width == null) return "—";
  return `${r.length} × ${r.width} in`;
}

/* -- One card -------------------------------------------------------------- */

function Card({
  card, row, busy, onSet, onMerge, mergeInto,
}: {
  card: DraftCard;
  row: PoSinkRow;
  busy: boolean;
  /** The row's new sink count, absolute. Draft only — nothing is written. */
  onSet: (rowId: string, sinkQuantity: number) => void;
  onMerge: (fromId: string, intoId: string) => void;
  /** A SAVED sibling of identical size this card could be folded back into. */
  mergeInto: PoSinkRow | null;
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
          </button>
        )}
      </div>
    </li>
  );
}

/* -- The board ------------------------------------------------------------- */

export function PoSinkBoard({
  poId, rows, busy: parentBusy = false, onChanged,
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
          <h3 className="text-sm font-bold text-slate-800">Sinks</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Click or drag a row to give its pieces a sink; type a number to split it.
            <strong className="text-slate-500"> Nothing is written until you save</strong> — move
            things around as much as you like, and a split you change your mind about simply
            disappears. Your unsaved work is kept if you reload.
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
                  onMerge={merge} mergeInto={mergeTargetFor(row)} />;
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
                  onMerge={merge} mergeInto={mergeTargetFor(row)} />;
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
