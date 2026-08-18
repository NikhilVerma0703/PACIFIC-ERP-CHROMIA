// The sink assignment board: which side of the board each requirement row sits
// on, how much of it moved, and whether the Sink column exists at all.
//
// PURE, AND IT IMPORTS NOTHING — same reason as slabLoss.ts and
// slabAssignment.ts: `node --test` resolves ESM strictly, so a relative import
// without a .ts extension fails at runtime while adding the extension fights the
// Next build.
//
// WHAT THE BOARD IS. One column of piece rows. Clicking a row — or dragging it —
// sends it to the right, where a Sink column APPEARS to hold it; that column
// does not exist before the first assignment and vanishes again when the last
// row leaves. Moving a row takes its full quantity by default, and a partial
// move (3 of 10) splits the row so both columns show their share. Every move
// saves immediately; there is no save button.
//
// WHAT IT WRITES. fab_requirement.sink_quantity, and nothing else:
//   NULL   the supervisor has not looked at this row yet
//   0      he looked and said no sinks
//   n      n of the row's pieces get a sink
//   = qty  all of them
// NULL and 0 route identically (resolveSinkQuantity in requirement-derive.ts)
// but they are different facts about a decision a human has to make, so the
// board never writes 0 over a NULL it did not touch.
//
// THE BOARD STARTS EMPTY ON THE RIGHT. Nothing is pre-filled — not from the
// piece width, not from the old sink_cuts column, not from anything. A row is
// on the right because the supervisor put it there.

/** A requirement row as the board holds it. */
export interface SinkRowInput {
  requirementId: string;
  /** fab_requirement.quantity — how many were ordered. */
  quantity: number;
  /** fab_requirement.sink_quantity. NULL = not looked at yet. */
  sinkQuantity: number | null | undefined;
}

/** Where one row's pieces actually are, once the stored value is believed. */
export interface SinkRowSplit {
  requirementId: string;
  quantity: number;
  /** Pieces with a sink — the Sink column's share. */
  sinkQuantity: number;
  /** Pieces without — the left column's share. */
  plainQuantity: number;
  /** True when both columns hold part of this row: 3 of 10. */
  split: boolean;
  /** True when the row has been touched at all (sink_quantity is not NULL). */
  decided: boolean;
}

function wholePieces(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * The stored sink quantity, believed but bounded.
 *
 * Deliberately tolerant of a stale value: sink_quantity is written by this board
 * and `quantity` by the PO import, and a quantity that was reduced afterwards
 * leaves a sink count larger than the row it belongs to. Showing "12 of 10 have
 * sinks" is worse than showing 10, and the release path clamps the same way
 * (resolveSinkQuantity), so the board must not disagree with what will actually
 * be cut.
 */
export function resolveSinkRow(row: SinkRowInput): SinkRowSplit {
  const quantity = wholePieces(row.quantity);
  const decided = typeof row.sinkQuantity === "number" && Number.isFinite(row.sinkQuantity);
  const sinkQuantity = Math.min(quantity, wholePieces(row.sinkQuantity));
  return {
    requirementId: row.requirementId,
    quantity,
    sinkQuantity,
    plainQuantity: quantity - sinkQuantity,
    split: sinkQuantity > 0 && sinkQuantity < quantity,
    decided,
  };
}

/**
 * DOES THE SINK COLUMN EXIST?
 *
 * It is not a piece of chrome that is always there and sometimes empty: the
 * owner asked for a board that is one column until the first row is assigned,
 * and one column again when the last one leaves. An empty Sink column left on
 * screen says "these rows have no sinks" about a project nobody has looked at
 * yet, which is exactly the assertion sink_quantity's NULL exists to avoid.
 *
 * A row with sink_quantity 0 does NOT keep the column alive — 0 means he looked
 * and said none, so that row belongs on the left with everything else.
 */
export function sinkColumnVisible(rows: SinkRowInput[]): boolean {
  return (rows ?? []).some(r => resolveSinkRow(r).sinkQuantity > 0);
}

/** The rows the Sink column shows, in board order. Empty when the column
 *  should not be there at all. */
export function sinkColumnRows(rows: SinkRowInput[]): SinkRowSplit[] {
  return (rows ?? []).map(resolveSinkRow).filter(r => r.sinkQuantity > 0);
}

/** The rows the left column shows: everything with pieces that have no sink.
 *  A fully-assigned row drops out of it entirely; a split row stays, showing
 *  only its remainder. */
export function plainColumnRows(rows: SinkRowInput[]): SinkRowSplit[] {
  return (rows ?? []).map(resolveSinkRow).filter(r => r.plainQuantity > 0);
}

/**
 * What a row gets when it is moved across with no quantity named — the full
 * ordered quantity. The owner was explicit: full quantity is the default, and
 * the partial split is the exception he types.
 */
export function defaultSinkQuantity(orderedQuantity: number): number {
  return wholePieces(orderedQuantity);
}

export type SinkAssignment =
  | { ok: true; sinkQuantity: number }
  | { ok: false; error: string };

/**
 * Validate one move of the board.
 *
 * REJECTS a quantity above the ordered one rather than quietly clamping it: the
 * supervisor typing 12 into a row of 10 has misread something, and a screen
 * that answers "done" while writing 10 has told him he got what he asked for.
 * Everything it returns is already inside [0, quantity], so the route can write
 * it as-is — it still passes the value through resolveSinkQuantity, which is
 * the single authority on what a stored sink count means and is what the
 * release path reads it back with.
 *
 * 0 is a legitimate answer, not an error: it is how a row comes back from the
 * Sink column, and how the supervisor says "none of these".
 */
export function planSinkAssignment(input: {
  requested: number | null | undefined;
  orderedQuantity: number;
}): SinkAssignment {
  const ordered = wholePieces(input.orderedQuantity);
  if (ordered <= 0) {
    return { ok: false, error: "This row has no ordered quantity, so no piece of it can take a sink." };
  }

  const raw = Number(input.requested);
  if (input.requested === null || input.requested === undefined || !Number.isFinite(raw)) {
    return { ok: false, error: "How many pieces get a sink? Give a whole number." };
  }

  const wanted = Math.floor(raw);
  if (wanted < 0) {
    return { ok: false, error: "A sink count cannot be negative." };
  }
  if (wanted > ordered) {
    return {
      ok: false,
      error: `Only ${ordered} piece(s) were ordered on this row, so ${wanted} of them cannot have sinks.`,
    };
  }

  return { ok: true, sinkQuantity: wanted };
}

/* -- The same board, scoped to ONE SLAB ------------------------------------ */

// WHY THERE IS A SECOND LAYER HERE RATHER THAN A SECOND MODULE. The supervisor
// does not sit down and decide sinks for a whole project; he decides them for
// the pieces he is about to cut out of the slab standing in front of him. So the
// board that matters is the one BELOW that slab's piece rows — same two columns,
// same click, same drag, same stored column — but the rows it holds are the ones
// on that slab.
//
// THE DECISION IS STILL THE ORDER ROW'S, NOT THE SLAB'S, and that is the whole
// reason this layer exists. A requirement of 60 tops being cut 12 to a slab is
// ONE order line: marking it writes sink_quantity = 60 — the full ordered
// quantity — and it is 60 on every other slab that row touches. So the number
// the supervisor is looking at (12 on this slab) and the number he is changing
// (60 ordered) are different numbers, and a card that showed only the first
// while writing the second would be lying to him. describeSlabSinkRow puts both
// on every row, on both sides of the board, for exactly that reason.
//
// AND IT IS WHY A ROW ARRIVES ALREADY IN THE SINK COLUMN. Slab 1 is where he
// decides; on slabs 2 to 5 the same row is already on the right, because the
// decision was made once and is stored against the row. Nothing re-asks him.

/** A row on the slab being prepped: the requirement, plus this slab's share. */
export interface SlabSinkRowInput extends SinkRowInput {
  /** fab_requirement_allocation.allocated_quantity for THIS slab — how many of
   *  the row are being cut here. It is NOT what the sink decision is written
   *  against; sink_quantity is written against the ordered quantity. */
  onThisSlab: number;
}

export interface SlabSinkRowSplit extends SinkRowSplit {
  /** This slab's share of the row. */
  onThisSlab: number;
  /**
   * True when the sink count covers pieces this slab does not hold — the
   * decision reaches past the slab being prepped, which is the ordinary case
   * for a row split across five slabs. The card says so out loud, because the
   * supervisor's next click changes all 60 and only 12 are in front of him.
   */
  appliesBeyondThisSlab: boolean;
}

/** One row of the slab-scoped board: the stored split, plus this slab's share. */
export function resolveSlabSinkRow(row: SlabSinkRowInput): SlabSinkRowSplit {
  const base = resolveSinkRow(row);
  const onThisSlab = wholePieces(row.onThisSlab);
  return { ...base, onThisSlab, appliesBeyondThisSlab: base.sinkQuantity > onThisSlab };
}

/**
 * DOES THE SINK COLUMN EXIST ON THIS SLAB?
 *
 * The same rule as the project-wide board (sinkColumnVisible) asked of one
 * slab's rows: the column is not chrome that is always there and sometimes
 * empty. It appears on the first assignment and is gone again when the last row
 * leaves it. A row whose sink count is 0 does not hold it open — 0 means he
 * looked and said none.
 */
export function slabSinkColumnVisible(rows: SlabSinkRowInput[]): boolean {
  return (rows ?? []).some(r => resolveSlabSinkRow(r).sinkQuantity > 0);
}

/** The rows the Sink column shows for this slab. Empty when the column should
 *  not be on screen at all. */
export function slabSinkColumnRows(rows: SlabSinkRowInput[]): SlabSinkRowSplit[] {
  return (rows ?? []).map(resolveSlabSinkRow).filter(r => r.sinkQuantity > 0);
}

/** The rows the left column shows for this slab: everything with ordered pieces
 *  that have no sink. A fully marked row drops out of it; a split row stays on
 *  both sides, showing its share on each. */
export function slabPlainColumnRows(rows: SlabSinkRowInput[]): SlabSinkRowSplit[] {
  return (rows ?? []).map(resolveSlabSinkRow).filter(r => r.plainQuantity > 0);
}

/**
 * "12 on this slab · 60 ordered · sink 60/60".
 *
 * The caption that makes the two quantities impossible to confuse. It is a pure
 * function and not a template inside the component so that the wording is
 * pinned by a test: the failure it guards against is silent — a card that reads
 * 12 while the click writes 60 looks perfectly reasonable and is wrong.
 */
export function describeSlabSinkRow(row: SlabSinkRowInput): string {
  const r = resolveSlabSinkRow(row);
  return `${r.onThisSlab} on this slab · ${r.quantity} ordered · sink ${r.sinkQuantity}/${r.quantity}`;
}
