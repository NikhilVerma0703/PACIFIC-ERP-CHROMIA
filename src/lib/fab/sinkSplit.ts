// SPLITTING A PO ROW BY SINK, AT THE ORDER — not on the shop floor.
//
// The owner: "on selecting the pieces with sink or not should be a bit earlier,
// because with sink and without sink can be separate a step ahead, while adding
// the PO itself right? So you get new rows as well — now same size and thickness
// and colour but a different row due to sink present or no. Default is full. The
// flow the same we follow with the supervisor page for the sink."
//
// ───────────────────────────────────── WHAT CHANGES, AND WHY IT IS BETTER ────
// Today one row of 60 can carry sink_quantity = 30, and every screen downstream
// has to keep asking "which 30?". Release picks the first 30 pieces; pricing
// counts feet over 30 of 60; the edge picker has to print both numbers so the
// figure reads. The row is not one thing.
//
// After the split there are two rows — 30 with sink, 30 without — each of them
// HOMOGENEOUS. Every piece in a row is now identical in size, thickness, colour
// AND routing, which is what "same row all have same" was always supposed to
// mean. The row letter then genuinely names a kind of piece, the edge picker
// prices a whole row, and nothing downstream has to split anything again.
//
// ───────────────────────────────────── WHICH ROW KEEPS THE LETTER ───────────
// THE ORIGINAL ROW STAYS WHERE IT IS; THE NEW ROW HOLDS THE PIECES THAT MOVED.
//
// That is the sink board's own gesture: a card sits in a column, and a partial
// number pushes part of it across while the card itself stays put. A plain row
// asked for 20 sinks keeps its 40 plain pieces and spawns a sink row; a sink row
// asked to drop to 10 keeps its 10 sink pieces and spawns a plain row. Doing it
// the other way would make a letter change meaning under a manager's hands.
//
// ───────────────────────────────────── WHEN IT IS REFUSED ───────────────────
// A split MOVES QUANTITY BETWEEN ROWS. Once pieces exist, or once the row is on
// a slab, that quantity is spoken for and moving it would strand allocations and
// piece codes. Both are refused with the sentence that says what to do instead —
// the same rule the row DELETE already applies, for the same reason.
//
// PURE, AND IT IMPORTS NOTHING — the rule from pricing.ts and pieceNaming.ts, so
// `node --test` can reach it and the manager screen can use it to grey out a
// button before the request is made.

/** Where a row sits today. A row is "sink" only when EVERY piece carries one —
 *  anything less is a legacy partial row, which this module treats as plain so
 *  the split carves the sink pieces out of it. */
export type SinkSide = "plain" | "sink";

export interface SinkSplitInput {
  /** fab_requirement.quantity — pieces ordered on the row. */
  quantity: number;
  /** fab_requirement.sink_quantity as stored. NULL = never decided. */
  currentSinkQuantity?: number | null;
  /** How many of the row's pieces should carry a sink after this. */
  wantSinkQuantity: number;
  /** Pieces already placed on slabs. Any at all blocks a split. */
  allocatedQuantity?: number | null;
  /** fab_piece rows already created by a release. Any at all blocks a split. */
  releasedPieces?: number | null;
}

export type SinkSplitPlan =
  /** Already right — the row is entirely on the side asked for. */
  | { ok: true; action: "none"; side: SinkSide }
  /** The WHOLE row moves. No new row: it is homogeneous either way. */
  | { ok: true; action: "mark"; side: SinkSide; sinkQuantity: number }
  /** Part of the row moves out into a row of its own. */
  | {
      ok: true;
      action: "split";
      /** What the ORIGINAL row is left holding. */
      keep: { quantity: number; side: SinkSide; sinkQuantity: number };
      /** The NEW row, which needs a fresh letter from the caller. */
      create: { quantity: number; side: SinkSide; sinkQuantity: number };
    }
  | { ok: false; reason: string };

/**
 * A whole number of pieces, or null.
 *
 * STRICT ABOUT NOTHINGNESS, because Number(null) and Number("") are both 0 and
 * a bare Number() would read "nobody said" as "no sinks" — which is the exact
 * distinction sink_quantity is nullable to preserve. A caller that wants a
 * default applies its own `?? 0`; this function does not choose one for it.
 *
 * ONLY A NUMBER OR A TYPED STRING gets through. Everything else JavaScript is
 * willing to turn into a count is a lie: `Number(true)` is 1, so `sink: true`
 * meaning "yes" would become a sink count of ONE PIECE; `Number([])` is 0, so a
 * stray empty array would read as "no sinks". Both are plausible enough to ship.
 */
function whole(n: unknown): number | null {
  if (typeof n !== "number" && typeof n !== "string") return null;
  if (typeof n === "string" && n.trim() === "") return null;
  const v = Number(n);
  if (!Number.isFinite(v) || !Number.isInteger(v)) return null;
  return v;
}

/** Where the row sits now. Only an all-sink row counts as sink — see the type. */
export function sideOf(quantity: number, sinkQuantity: number | null | undefined): SinkSide {
  const q = Math.max(0, Math.floor(Number(quantity) || 0));
  const s = Math.max(0, Math.floor(Number(sinkQuantity) || 0));
  return q > 0 && s >= q ? "sink" : "plain";
}

/**
 * WHAT TO DO TO THIS ROW.
 *
 * Every refusal names the number it is refusing and what to do about it. "3 of
 * 10" and "12 of 10" are different mistakes and a shared "invalid quantity"
 * tells a manager which one he made in neither case.
 */
export function planSinkSplit(input: SinkSplitInput): SinkSplitPlan {
  const quantity = whole(input?.quantity);
  if (quantity === null || quantity <= 0) {
    return { ok: false, reason: "This row has no quantity to split." };
  }

  const want = whole(input?.wantSinkQuantity);
  if (want === null) {
    return { ok: false, reason: "How many pieces carry a sink? It has to be a whole number of pieces." };
  }
  if (want < 0) {
    return { ok: false, reason: "A sink count cannot be negative." };
  }
  if (want > quantity) {
    return {
      ok: false,
      reason: `This row has ${quantity} piece${quantity === 1 ? "" : "s"}, so ${want} of them cannot carry a sink. ` +
        `Raise the row's quantity first if the order really is for ${want}.`,
    };
  }

  const currentSink = Math.min(quantity, Math.max(0, whole(input?.currentSinkQuantity) ?? 0));
  const side = sideOf(quantity, currentSink);
  const releasedPieces = Math.max(0, whole(input?.releasedPieces) ?? 0);

  // ── ONCE IT IS ON THE FLOOR, THE SINK COUNT IS FROZEN ───────────────────
  //
  // This check used to sit further down, guarding only the SPLIT path, on the
  // reasoning that marking a whole row one way or the other moves no quantity
  // between rows and is therefore harmless. It is not harmless, and the reason
  // is money.
  //
  // has_sink is stamped onto each piece when it is released and never changes
  // again. sink_quantity on the row stayed editable. The two money screens then
  // read different columns: the Overview board prices from the ROW's current
  // count, the period report earns from each PIECE's frozen flag. Mark a
  // released 60/30 row "all sink" and one screen reads ₹21,375 while the other
  // reads ₹10,687.50 — two numbers for one row, both defensible, neither
  // checkable against the stone. Mark it the other way and thirty real sink
  // pieces become worth nothing.
  //
  // Scoped to the WHOLE-ROW moves only. A real split on a released row is
  // refused further down by a guard that explains the split-specific reason
  // better than this one could — that the pieces would be left on a row which
  // no longer describes them.
  //
  // An unchanged value still passes: re-saving the board without touching this
  // row must not start failing.
  if (releasedPieces > 0 && want !== currentSink && (want === 0 || want === quantity)) {
    return {
      ok: false,
      reason:
        `This row is already on the floor — ${releasedPieces} piece${releasedPieces === 1 ? "" : "s"} ` +
        `${releasedPieces === 1 ? "carries" : "carry"} its code, and ${currentSink} of them ` +
        `${currentSink === 1 ? "was cut" : "were cut"} with a sink. Changing the count now re-prices ` +
        `work that is already done without changing the stone. Edit the pieces instead.`,
    };
  }

  // The whole row, one way or the other. No new row, and no allocation check:
  // this is exactly what the supervisor's sink board already does and it moves
  // no quantity between rows.
  if (want === 0) {
    return side === "plain" && currentSink === 0
      ? { ok: true, action: "none", side: "plain" }
      : { ok: true, action: "mark", side: "plain", sinkQuantity: 0 };
  }
  if (want === quantity) {
    return side === "sink"
      ? { ok: true, action: "none", side: "sink" }
      : { ok: true, action: "mark", side: "sink", sinkQuantity: quantity };
  }

  // ---- a real split, which moves quantity ---------------------------------
  const released = Math.max(0, whole(input?.releasedPieces) ?? 0);
  if (released > 0) {
    return {
      ok: false,
      reason:
        `This row has already been sent to cutting — ${released} piece${released === 1 ? "" : "s"} ` +
        `carry its code. Splitting it now would leave those pieces on a row that no longer ` +
        `describes them. Decide sinks before the row goes to the floor.`,
    };
  }
  const allocated = Math.max(0, whole(input?.allocatedQuantity) ?? 0);
  if (allocated > 0) {
    return {
      ok: false,
      reason:
        `${allocated} piece${allocated === 1 ? " of this row is" : "s of this row are"} already on a slab. ` +
        `Take the row off the slab board first, then split it — otherwise the slab would be ` +
        `holding pieces of a row that has changed size underneath it.`,
    };
  }

  // The original stays on its own side; the movers become the new row.
  const movingOut = side === "sink" ? quantity - want : want;
  const staying = quantity - movingOut;
  const newSide: SinkSide = side === "sink" ? "plain" : "sink";

  return {
    ok: true,
    action: "split",
    keep: {
      quantity: staying,
      side,
      sinkQuantity: side === "sink" ? staying : 0,
    },
    create: {
      quantity: movingOut,
      side: newSide,
      sinkQuantity: newSide === "sink" ? movingOut : 0,
    },
  };
}

/* ── DOING A WHOLE PURCHASE ORDER AT ONCE ─────────────────────────────────────
 *
 * The owner: "current model feels so heavy work to do — make it easy for apply
 * and splitting the sink and non sink."
 *
 * He was right. A 28-row PO meant 28 separate decisions before anything could
 * move, and on a real order most rows are plain and a handful have sinks. The
 * work is not the deciding, it is the clicking.
 *
 * So the shape below: count what is left, let one button clear the backlog, and
 * leave the manager touching only the exceptions.
 */

export interface SinkDecisionRow {
  quantity: number;
  sinkQuantity?: number | null;
  /** Already sent to cutting. Counted, never changed. */
  locked?: boolean;
}

export interface SinkTally {
  total: number;
  /** sink_quantity IS NULL — nobody has been asked about these yet. */
  undecided: number;
  plain: number;
  sink: number;
  /** Decided, but not all-or-nothing. Only possible on rows predating the
   *  split; worth naming because it is the state this whole change removes. */
  mixed: number;
  locked: number;
  /** Rows a bulk action would actually touch. Drives the button's label, so it
   *  can say "9 rows" rather than leaving a manager to guess. */
  changeable: number;
}

/** What a PO's rows currently say about sinks. */
export function tallySinkDecisions(rows: SinkDecisionRow[]): SinkTally {
  const t: SinkTally = { total: 0, undecided: 0, plain: 0, sink: 0, mixed: 0, locked: 0, changeable: 0 };
  for (const r of rows ?? []) {
    t.total++;
    if (r?.locked) t.locked++;
    const q = Math.max(0, Math.floor(Number(r?.quantity) || 0));
    if (r?.sinkQuantity == null) {
      t.undecided++;
      if (!r?.locked) t.changeable++;
      continue;
    }
    const s = Math.max(0, Math.min(q, Math.floor(Number(r.sinkQuantity) || 0)));
    if (s === 0) t.plain++;
    else if (s >= q) t.sink++;
    else t.mixed++;
  }
  return t;
}

/**
 * WHICH ROWS A BULK ACTION WOULD TOUCH.
 *
 * "undecided" is the one a manager reaches for: the PDF landed, most rows are
 * plain, and he wants the backlog gone in one click without disturbing the three
 * he has already marked. "all" is the blunt one, and it still refuses locked
 * rows — those pieces exist and carry their row's code.
 *
 * A row that is already what is being asked for is NOT included: doing nothing
 * to it is not a change, and counting it would make the button promise more
 * than it delivers.
 */
export function rowsForBulkSink<T extends SinkDecisionRow>(
  rows: T[],
  target: SinkSide,
  scope: "undecided" | "all",
): T[] {
  return (rows ?? []).filter((r) => {
    if (r?.locked) return false;
    const undecided = r?.sinkQuantity == null;
    if (scope === "undecided" && !undecided) return false;
    if (undecided) return true;

    // ALREADY THERE? Then this is not a change.
    //
    // Compared against the COUNT, not against sideOf(). sideOf calls a partial
    // row "plain" — it is the answer to "which column does this card sit in",
    // and for a row of 30 with 12 sinks the honest answer is the left one. But
    // it is NOT already plain: a bulk "all plain" genuinely takes those 12 sinks
    // off it. Filtering by side would skip exactly the rows the bulk action
    // exists to clean up, and leave a manager to find them one at a time.
    const q = Math.max(0, Math.floor(Number(r.quantity) || 0));
    const s = Math.max(0, Math.min(q, Math.floor(Number(r.sinkQuantity) || 0)));
    return target === "plain" ? s !== 0 : s < q;
  });
}

/* ── THE MANAGER COMPOSES, THEN SAVES ────────────────────────────────────────
 *
 * The owner: "if I'm adding it, make nothing — even manually edit the row, it
 * gives you a real row newly. But you make it again to unsink or no sink, it
 * doesn't go to original, instead stays where they are. It should be like
 * manager do these things and then save to send to supervisor."
 *
 * He found the flaw in saving on every click. Writing each move straight to the
 * database means a SPLIT CREATES A ROW THE MOMENT YOU TYPE IT — and dragging
 * that row back to "no sink" only marks it plain. It does not go home. Row C of
 * 60 split into 40 + 20 and then changed its mind stayed TWO ROWS OF PLAIN
 * PIECES, 40 and 20, where the order has one row of 60. Every hesitation left
 * litter behind.
 *
 * Merging on the way back could have patched it, but the model was wrong
 * underneath: the manager is not making standing decisions one at a time, he is
 * WORKING OUT the breakdown. So nothing is written until he says so.
 *
 * ───────────────────────────────────────── THE DRAFT IS ONE NUMBER PER ROW ──
 * However much dragging and typing happens, the whole intent is: for each
 * ORDERED ROW, how many of its pieces carry a sink? A number between 0 and the
 * quantity. Everything on screen is DERIVED from that number:
 *
 *     0            one card, all plain
 *     quantity     one card, all sink
 *     in between   two cards — and the second one is marked "new on save"
 *
 * Which means moving a provisional card back is just that number changing, so
 * it merges itself and there is nothing to clean up. The bug cannot happen: a
 * row that was never created cannot be left behind.
 */

export interface DraftRow {
  id: string;
  label: string;
  quantity: number;
  /** As STORED. Null = nobody has decided. */
  sinkQuantity: number | null;
  locked?: boolean;
}

export interface DraftCard {
  /** Stable across renders so React does not remount a card mid-drag. */
  key: string;
  /** The ordered row this came from. */
  sourceId: string;
  label: string;
  side: SinkSide;
  quantity: number;
  /** True for the half that does not exist yet — it appears on save. */
  isNew: boolean;
  /** True while nobody has answered for this row at all. */
  undecided: boolean;
  locked: boolean;
}

/** The sink count in force for a row: the draft's if it has one, else stored. */
export function draftValue(row: DraftRow, draft: Map<string, number> | undefined): number | null {
  const d = draft?.get(row?.id);
  return d === undefined ? (row?.sinkQuantity ?? null) : d;
}

/**
 * THE CARDS ON THE BOARD, derived from the draft rather than from the database.
 *
 * A locked row is shown as it actually is and never split — its pieces exist
 * and carry its code.
 */
export function draftCards(rows: DraftRow[], draft?: Map<string, number>): DraftCard[] {
  const out: DraftCard[] = [];
  for (const row of rows ?? []) {
    const q = Math.max(0, Math.floor(Number(row?.quantity) || 0));
    const storedSide = sideOf(q, row?.sinkQuantity);
    const undecided = row?.sinkQuantity == null && draft?.get(row.id) === undefined;

    if (row?.locked) {
      out.push({
        key: row.id, sourceId: row.id, label: row.label, side: storedSide,
        quantity: q, isNew: false, undecided: false, locked: true,
      });
      continue;
    }

    const raw = draftValue(row, draft);
    const s = Math.max(0, Math.min(q, Math.floor(Number(raw) || 0)));

    if (s <= 0 || s >= q) {
      out.push({
        key: row.id, sourceId: row.id, label: row.label,
        side: s >= q && q > 0 ? "sink" : "plain",
        quantity: q, isNew: false, undecided, locked: false,
      });
      continue;
    }

    // A split in the draft. The original keeps the side it is on today; the
    // other half is the one that appears on save — the same rule planSinkSplit
    // applies when the write finally happens, so what is drawn is what lands.
    const newSide: SinkSide = storedSide === "sink" ? "plain" : "sink";
    const keepQty = storedSide === "sink" ? s : q - s;
    const newQty = q - keepQty;
    out.push({
      key: row.id, sourceId: row.id, label: row.label, side: storedSide,
      quantity: keepQty, isNew: false, undecided: false, locked: false,
    });
    out.push({
      key: `${row.id}:new`, sourceId: row.id, label: row.label, side: newSide,
      quantity: newQty, isNew: true, undecided: false, locked: false,
    });
  }
  return out;
}

export interface DraftShape {
  /** ORDERED ROWS on the purchase order, as the database holds them. This is
   *  the number that must reconcile with the rows table below the board. */
  rows: number;
  /** Pieces ordered across those rows. Also reconcilable, and the figure that
   *  catches a split having invented or lost something. */
  pieces: number;
  /** Rows whose pieces all go plain / all carry a sink, once the draft is
   *  applied. Rows, not cards. */
  plainRows: number;
  sinkRows: number;
  /** Rows the draft would SPLIT — each shows two cards but is still ONE ordered
   *  row until the save runs. Counting these as rows is what made the board's
   *  header disagree with the order. */
  splitRows: number;
  /** Nobody has answered for these yet. */
  undecidedRows: number;
  lockedRows: number;
  /** Pieces that will carry a sink once the draft is saved. */
  sinkPieces: number;
  /** Cards currently drawn, which is rows + splitRows. Named so nothing can
   *  print it under the word "rows" by accident. */
  cards: number;
}

/**
 * THE ORDER'S TRUE SHAPE, so the board can be checked against the table.
 *
 * A CARD IS NOT A ROW. A row split in the draft draws two cards and is still one
 * ordered row until save — so a column header showing `cards.length` beside the
 * word "rows" reports an order that does not exist, and every count on the board
 * reads as out of sync with the PO. That is what this exists to stop: rows are
 * counted here, cards are counted where cards are drawn, and the two are never
 * the same variable.
 */
export function draftShape(rows: DraftRow[], draft?: Map<string, number>): DraftShape {
  const s: DraftShape = {
    rows: 0, pieces: 0, plainRows: 0, sinkRows: 0, splitRows: 0,
    undecidedRows: 0, lockedRows: 0, sinkPieces: 0, cards: 0,
  };
  for (const row of rows ?? []) {
    const q = Math.max(0, Math.floor(Number(row?.quantity) || 0));
    s.rows++;
    s.pieces += q;

    if (row?.locked) {
      s.lockedRows++;
      const side = sideOf(q, row.sinkQuantity);
      if (side === "sink") { s.sinkRows++; s.sinkPieces += q; } else s.plainRows++;
      s.cards++;
      continue;
    }

    if (row?.sinkQuantity == null && draft?.get(row.id) === undefined) s.undecidedRows++;

    const raw = draftValue(row, draft);
    const n = Math.max(0, Math.min(q, Math.floor(Number(raw) || 0)));
    s.sinkPieces += n;

    if (n <= 0) { s.plainRows++; s.cards++; }
    else if (n >= q) { s.sinkRows++; s.cards++; }
    else { s.splitRows++; s.cards += 2; }
  }
  return s;
}

export interface DraftChange {
  id: string;
  label: string;
  from: number | null;
  to: number;
  /** True when saving this one makes a second row. */
  splits: boolean;
}

/**
 * WHAT SAVE WILL ACTUALLY DO — the list behind the button's count.
 *
 * Only rows whose number has moved. A draft entry equal to what is already
 * stored is not a change, and counting it would make the button promise work it
 * is not going to do.
 */
export function draftChanges(rows: DraftRow[], draft?: Map<string, number>): DraftChange[] {
  const out: DraftChange[] = [];
  for (const row of rows ?? []) {
    if (row?.locked) continue;
    const d = draft?.get(row.id);
    if (d === undefined) continue;
    const q = Math.max(0, Math.floor(Number(row.quantity) || 0));
    const to = Math.max(0, Math.min(q, Math.floor(Number(d) || 0)));
    const from = row.sinkQuantity == null ? null : Math.max(0, Math.min(q, Math.floor(row.sinkQuantity)));
    if (from === to) continue;
    out.push({ id: row.id, label: row.label, from, to, splits: to > 0 && to < q });
  }
  return out;
}

/* ── PUTTING A SPLIT BACK ────────────────────────────────────────────────────
 *
 * The board's promise is "undo, and dragging back, both work". A whole-row move
 * undoes itself — it is one number going back to what it was. A SPLIT does not:
 * it made a second row, and undoing it means merging that row away again.
 *
 * Without this, one mis-typed partial leaves a PO permanently one row longer
 * than the order, and the only repair is deleting a row by hand and retyping a
 * quantity — which is exactly the "heavy" the owner was complaining about.
 */

export interface SinkMergeRow {
  id: string;
  quantity: number;
  lengthIn?: number | null;
  widthIn?: number | null;
  poId?: string | null;
  allocatedQuantity?: number | null;
  releasedPieces?: number | null;
}

export type SinkMergePlan =
  | { ok: true; intoId: string; fromId: string; quantity: number }
  | { ok: false; reason: string };

function sameNumber(a: unknown, b: unknown): boolean {
  const x = a == null ? null : Number(a);
  const y = b == null ? null : Number(b);
  if (x === null && y === null) return true;
  if (x === null || y === null) return false;
  return Math.abs(x - y) < 1e-9;
}

/**
 * MAY `from` BE FOLDED BACK INTO `into`?
 *
 * Only two rows that are genuinely the same piece may merge — same PO, same
 * length, same width. Merging two different sizes would not undo anything, it
 * would silently reprice a customer's order, so the check is on the dimensions
 * themselves rather than on a "these were split from each other" flag nobody
 * would maintain.
 *
 * And neither row may have moved on: pieces cut against it, or a slab holding
 * part of it, means the quantity is spoken for. Same rule the split applies in
 * the other direction, for the same reason.
 */
export function planSinkMerge(into: SinkMergeRow, from: SinkMergeRow): SinkMergePlan {
  if (!into?.id || !from?.id) return { ok: false, reason: "Two rows are needed to merge." };
  if (into.id === from.id) return { ok: false, reason: "A row cannot be merged into itself." };
  if (into.poId != null && from.poId != null && into.poId !== from.poId) {
    return { ok: false, reason: "Those rows are on different purchase orders." };
  }
  if (!sameNumber(into.lengthIn, from.lengthIn) || !sameNumber(into.widthIn, from.widthIn)) {
    return {
      ok: false,
      reason:
        "Those two rows are not the same size, so merging them would change what was ordered. " +
        "Only rows split from one another can be put back together.",
    };
  }
  for (const r of [into, from]) {
    const released = Math.max(0, Number(r.releasedPieces) || 0);
    if (released > 0) {
      return {
        ok: false,
        reason:
          `One of these rows has already been sent to cutting — ${released} ` +
          `piece${released === 1 ? "" : "s"} carry its code. It cannot be merged away.`,
      };
    }
    const allocated = Math.max(0, Number(r.allocatedQuantity) || 0);
    if (allocated > 0) {
      return {
        ok: false,
        reason:
          `One of these rows is already on a slab (${allocated} piece${allocated === 1 ? "" : "s"}). ` +
          `Take it off the slab board first.`,
      };
    }
  }
  const a = Math.max(0, Math.floor(Number(into.quantity) || 0));
  const b = Math.max(0, Math.floor(Number(from.quantity) || 0));
  if (a + b <= 0) return { ok: false, reason: "There is no quantity to merge." };
  return { ok: true, intoId: into.id, fromId: from.id, quantity: a + b };
}

/**
 * What the screen says a plan will do, before it is done.
 *
 * A manager is about to turn one row into two, permanently, and "Split" on a
 * button does not say that. This is the sentence beside it.
 */
export function describeSinkSplit(plan: SinkSplitPlan, rowLabel: string): string {
  if (!plan.ok) return plan.reason;
  if (plan.action === "none") {
    return plan.side === "sink"
      ? `${rowLabel} is already all sink pieces.`
      : `${rowLabel} already has no sinks.`;
  }
  if (plan.action === "mark") {
    return plan.side === "sink"
      ? `All ${plan.sinkQuantity} piece${plan.sinkQuantity === 1 ? "" : "s"} of ${rowLabel} will carry a sink.`
      : `${rowLabel} will carry no sinks.`;
  }
  const kept = `${rowLabel} keeps ${plan.keep.quantity} ${plan.keep.side === "sink" ? "with sink" : "plain"}`;
  const made = `a new row takes ${plan.create.quantity} ${plan.create.side === "sink" ? "with sink" : "plain"}`;
  return `${kept}, and ${made}. Same size, thickness and colour — a different row because the routing differs.`;
}
