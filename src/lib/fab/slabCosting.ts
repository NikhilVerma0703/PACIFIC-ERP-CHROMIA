// WHAT IS THIS SLAB WORTH — the money, split the way the stone was.
//
// The owner: "in the ceo dashboard, show per slab whats the cost as we
// calculate."
//
// Everywhere else the charge is per ORDERED ROW: 60 pieces of 28 × 22.5 in,
// four edges, ₹7,575. But a row is not cut from one slab. Row A of PO 10026 is
// spread across whatever stone the supervisor put it on — 22 pieces here, 18
// there, 20 somewhere else — and "what did that slab cost us" is a different
// question from "what does that row cost", asked by a different person.
//
// So this apportions each priced row across the slabs its pieces were allocated
// to. It computes NOTHING about price itself: priceRow owns the rates, the
// faces and the pair discount, and this module only divides the answer up.
// Two modules that both decide money is two modules that can disagree.
//
// ─────────────────────── EDGE IS EXACT. SINK IS AN ESTIMATE. ────────────────
// AND THE DIFFERENCE IS SAID OUT LOUD, because one of these two numbers is
// defensible to a customer and the other is not.
//
//   EDGE  A row is homogeneous — every piece of it gets the same edge work, so
//         every piece carries the same share. 22 pieces on this slab is exactly
//         22 shares. Nothing is approximated.
//
//   SINK  A row of 60 with 30 sinks does NOT record WHICH thirty. The sink
//         decision is per row, and which physical pieces get the cutout is
//         settled later at the bench. So a slab holding 22 of those 60 pieces
//         might hold anywhere from 0 to 22 of the sinks.
//
//         Apportioning by quantity — 22/60 of the sink money — is the only
//         answer available, and it is an ESTIMATE. Every result carries
//         `sinkEstimated` so a screen can say so rather than presenting a guess
//         in the same typeface as a fact.
//
// ─────────────────────── THE REMAINDER IS A ROW, NOT A ROUNDING ─────────────
// Pieces not yet on any slab are their own bucket. Dropping them would make the
// slab totals silently fail to add up to the project total, and somebody would
// eventually spend an afternoon on the difference. A project half planned is
// SUPPOSED to show most of its money as not yet on stone.
//
//     sum(slab totals) + unallocated total === project total
//
// That reconciliation is the test worth having, and tests/fabSlabCosting.test.ts
// asserts it on every fixture.
//
// ─────────────────────── AN UNPRICED ROW CONTRIBUTES PIECES, NOT MONEY ──────
// A row with a blank width or an L-shaped outline has no figure to divide. Its
// pieces still sit on a slab and are still counted, and the slab reports
// `unpricedRows` so the zero is legible as "not costed yet" rather than free.
//
// PURE, AND IT IMPORTS NOTHING — the rule from shape.ts and pieceNaming.ts, so
// `node --test` reaches it and the CEO board can use it in the browser.

/** One slab a row's pieces were put on. */
export interface RowAllocation {
  slabId: string;
  slabCode: string | null;
  colour: string | null;
  /** Pieces of this row cut from that slab. */
  allocatedQuantity: number;
}

/**
 * A priced ordered row, as the board already has it.
 *
 * The money arrives ALREADY CALCULATED — from priceRow, through the same call
 * the row's own line is rendered from — so the slab panel and the row panel
 * cannot show two different answers for one row.
 */
export interface CostedRow {
  requirementId: string;
  rowLetter: string | null;
  /** THE SIZE, so a subdivision can name the piece and not just the letter.
   *
   *  The owner: "wherever you put row, put the L x width of that too next to
   *  it." A letter is a label somebody has to go and look up; "Row C" and
   *  "Row K" are indistinguishable on a screen until you know that one is a
   *  3 cm threshold at Rs45/ft and the other is an 11 cm one that is not
   *  polished at all.
   *
   *  INCHES, as everywhere. dimUnit says which unit to PRINT them in. */
  lengthIn?: number | null;
  widthIn?: number | null;
  /** RECTANGLE / CIRCLE / OVAL — so a circle reads as a diameter. */
  shapeType?: unknown;
  /** scripts/0068 — 'CM', or NULL/'IN'. Display only. */
  dimUnit?: string | null;
  /** Pieces ORDERED on this row. The divisor for the sink estimate. */
  quantity: number;
  edgeCost: number;
  sinkCost: number;
  /**
   * Pieces the EDGE money is spread over — priceRow's chargePieces, not
   * edgePieces. On a per-piece or lump-sum row those differ, and dividing by
   * the wrong one gives every slab a share of zero. See pieceCharge.rowShares,
   * which had exactly this bug.
   */
  chargePieces: number;
  /** Pieces of this row carrying a sink. */
  sinkPieces: number;
  /** True when priceRow refused this row. It contributes pieces, never money. */
  unpriced: boolean;
  allocations: RowAllocation[];
}

/**
 * ONE ROW'S SHARE OF ONE SLAB — the subdivision under a slab's figure.
 *
 * The owner: "in the CEO dashboard, as we have project and slab wise, I need to
 * see the slab-wise cost AND THE SUBDIVISIONS also."
 *
 * A slab's total is a sum over the ordered rows whose pieces were cut from it,
 * and "where did Rs4,180 on slab 146837 come from" is the question a slab
 * figure immediately provokes. Without these lines the only way to answer it is
 * to open every row of the project and do the division by hand.
 *
 * THE SHARES ADD UP TO THE SLAB. Rounded once and reconciled, the same rule the
 * slab totals themselves follow.
 */
export interface SlabRowShare {
  requirementId: string;
  /** "A", "B" — the row letter every piece cut from it is named after. */
  rowLetter: string | null;
  /** The row's size, carried through so the line can print it beside the
   *  letter. Inches; dimUnit says what to print. */
  lengthIn: number | null;
  widthIn: number | null;
  shapeType: unknown;
  dimUnit: string | null;
  /** Pieces of this row cut from THIS slab. */
  pieces: number;
  /** Pieces ORDERED on the row, so a screen can say "22 of 60" and the reader
   *  can see at a glance that the rest is on other stone. */
  orderedQuantity: number;
  edgeCost: number;
  sinkCost: number;
  total: number;
  /** True when priceRow refused the row. It contributes pieces, never money. */
  unpriced: boolean;
  /** True when THIS share's sink money was apportioned rather than counted —
   *  the slab holds only part of a row that carries sinks, and which pieces
   *  carry the cutout is settled at the bench and not recorded. */
  sinkEstimated: boolean;
}

/** What one slab is worth. */
export interface SlabCost {
  slabId: string;
  slabCode: string | null;
  colour: string | null;
  /** Pieces of any row cut from this slab. */
  pieces: number;
  /** Ordered rows contributing to it. */
  rows: number;
  edgeCost: number;
  sinkCost: number;
  total: number;
  /** Rows on this slab that could not be priced — their pieces are counted and
   *  their money is not, and a screen should say which. */
  unpricedRows: number;
  /** TRUE WHEN ANY SINK MONEY HERE WAS APPORTIONED rather than counted. See the
   *  header: which pieces of a row carry the cutout is not recorded. */
  sinkEstimated: boolean;
  /** THE SUBDIVISIONS — which ordered rows made this figure, dearest first.
   *  Sums to `total`. */
  breakdown: SlabRowShare[];
}

/** Pieces nobody has put on stone yet — the rest of the project. */
export interface UnallocatedCost {
  pieces: number;
  rows: number;
  edgeCost: number;
  sinkCost: number;
  total: number;
  /** The same subdivisions, for the pieces still waiting for stone. */
  breakdown: SlabRowShare[];
}

export interface SlabCosting {
  /** Slabs, dearest first — the question is "where did the money go". */
  slabs: SlabCost[];
  unallocated: UnallocatedCost;
  /** Every slab plus the remainder. Equals the sum of the rows given. */
  total: number;
}

/** 2dp, half away from zero, and EPSILON-corrected so 0.615 does not round
 *  down through binary float. The same money() pricing.ts uses. */
function money(n: number): number {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** A whole, non-negative count. A negative allocation is data corruption, not a
 *  credit, so it is floored to zero rather than subtracting money. */
function count(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Split every row across its slabs, and report the remainder.
 *
 * ROUNDED ONCE, AT THE END. Shares are accumulated unrounded and rounded when
 * the slab is finished, so a slab holding 22 pieces of a row at ₹126.25 each
 * reads ₹2,777.50 and not the ₹2,777.44 that rounding each piece first would
 * give. The same rule sumPricing follows, and for the same reason: a total that
 * does not equal the column above it is a bug report waiting to happen.
 */
/** One row's share of one slab, still unrounded. */
interface RawShare {
  requirementId: string;
  rowLetter: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  shapeType: unknown;
  dimUnit: string | null;
  pieces: number;
  orderedQuantity: number;
  edge: number;
  sink: number;
  unpriced: boolean;
  sinkEstimated: boolean;
}

/**
 * ROUND THE SHARES, THEN MAKE THEM ADD UP.
 *
 * Each share is money() on its own, which can leave the sum a paisa or two off
 * the figure the slab reports — the slab rounds ONE accumulated number and the
 * shares round several. The remainder goes onto the DEAREST share, where it is
 * proportionally smallest and where nobody is checking the last paisa of a
 * Rs4,000 line against a Rs12 one.
 *
 * Dearest first, then by row letter, so two shares that tie do not reshuffle
 * between refreshes.
 */
function settleShares(raw: RawShare[], edgeTotal: number, sinkTotal: number): SlabRowShare[] {
  const out: SlabRowShare[] = raw.map((r) => ({
    requirementId: r.requirementId,
    rowLetter: r.rowLetter,
    lengthIn: r.lengthIn,
    widthIn: r.widthIn,
    shapeType: r.shapeType,
    dimUnit: r.dimUnit,
    pieces: r.pieces,
    orderedQuantity: r.orderedQuantity,
    edgeCost: money(r.edge),
    sinkCost: money(r.sink),
    total: money(r.edge + r.sink),
    unpriced: r.unpriced,
    sinkEstimated: r.sinkEstimated,
  }));
  if (out.length) {
    let biggest = 0;
    for (let i = 1; i < out.length; i += 1) if (out[i].total > out[biggest].total) biggest = i;
    const edgeDrift = money(edgeTotal - out.reduce((t, x) => t + x.edgeCost, 0));
    const sinkDrift = money(sinkTotal - out.reduce((t, x) => t + x.sinkCost, 0));
    if (edgeDrift !== 0 || sinkDrift !== 0) {
      const b = out[biggest];
      out[biggest] = {
        ...b,
        edgeCost: money(b.edgeCost + edgeDrift),
        sinkCost: money(b.sinkCost + sinkDrift),
        total: money(b.edgeCost + edgeDrift + b.sinkCost + sinkDrift),
      };
    }
  }
  out.sort((x, y) => y.total - x.total
    || String(x.rowLetter ?? "").localeCompare(String(y.rowLetter ?? ""))
    || x.requirementId.localeCompare(y.requirementId));
  return out;
}

export function costPerSlab(rows: CostedRow[] | null | undefined): SlabCosting {
  const list = rows ?? [];

  const bySlab = new Map<string, {
    slabCode: string | null; colour: string | null;
    pieces: number; rows: Set<string>;
    edge: number; sink: number;
    unpricedRows: Set<string>; sinkEstimated: boolean;
    /** THE SUBDIVISIONS, held UNROUNDED. Rounded once when the slab is
     *  finished, and reconciled against the slab total, for the same reason the
     *  slab total is: a breakdown that does not add up to the line above it is
     *  an afternoon somebody spends on nothing. */
    shares: RawShare[];
  }>();

  let leftPieces = 0;
  let leftEdge = 0;
  let leftSink = 0;
  const leftRows = new Set<string>();
  const leftShares: RawShare[] = [];
  let grand = 0;

  for (const r of list) {
    const qty = count(r.quantity);
    const chargePieces = count(r.chargePieces);
    const sinkPieces = count(r.sinkPieces);

    // Per piece, UNROUNDED. An unpriced row has no money to divide — its
    // pieces are still counted below, which is the point.
    const edgePer = !r.unpriced && chargePieces > 0 ? Number(r.edgeCost) / chargePieces : 0;
    // The sink estimate: this row's sink money spread over ALL its pieces,
    // because which of them carry the cutout is not recorded anywhere.
    const sinkPer = !r.unpriced && qty > 0 ? Number(r.sinkCost) / qty : 0;
    const rowHasSinkMoney = !r.unpriced && sinkPieces > 0 && Number(r.sinkCost) > 0;

    grand += r.unpriced ? 0 : Number(r.edgeCost) + Number(r.sinkCost);

    let allocated = 0;
    for (const a of r.allocations ?? []) {
      const n = count(a.allocatedQuantity);
      if (n === 0) continue;
      allocated += n;

      let bucket = bySlab.get(a.slabId);
      if (!bucket) {
        bucket = {
          slabCode: a.slabCode ?? null, colour: a.colour ?? null,
          pieces: 0, rows: new Set(), edge: 0, sink: 0,
          unpricedRows: new Set(), sinkEstimated: false, shares: [],
        };
        bySlab.set(a.slabId, bucket);
      }
      bucket.pieces += n;
      bucket.rows.add(r.requirementId);
      bucket.edge += edgePer * n;
      bucket.sink += sinkPer * n;
      if (r.unpriced) bucket.unpricedRows.add(r.requirementId);
      // A slab holding only SOME of a row's pieces holds an unknown number of
      // its sinks. Holding all of them is exact, and is not flagged.
      const partial = rowHasSinkMoney && n < qty;
      if (partial) bucket.sinkEstimated = true;
      // THE SUBDIVISION. One entry per (row, slab) pair — a row allocated twice
      // to the same slab is two allocations and is merged below by the sum, not
      // here, because each allocation is its own record.
      const existing = bucket.shares.find((x) => x.requirementId === r.requirementId);
      if (existing) {
        existing.pieces += n;
        existing.edge += edgePer * n;
        existing.sink += sinkPer * n;
        existing.sinkEstimated = existing.sinkEstimated || partial;
      } else {
        bucket.shares.push({
          requirementId: r.requirementId, rowLetter: r.rowLetter ?? null,
          lengthIn: r.lengthIn ?? null, widthIn: r.widthIn ?? null,
          shapeType: r.shapeType ?? null, dimUnit: r.dimUnit ?? null,
          pieces: n, orderedQuantity: qty,
          edge: edgePer * n, sink: sinkPer * n,
          unpriced: r.unpriced, sinkEstimated: partial,
        });
      }
    }

    // WHAT IS NOT ON STONE YET. Clamped at zero: over-allocation is prevented
    // on write (scripts/0045) but a negative remainder here would read as a
    // credit against the project, which it is not.
    const rest = Math.max(0, qty - allocated);
    if (rest > 0) {
      leftPieces += rest;
      leftRows.add(r.requirementId);
      leftEdge += edgePer * rest;
      leftSink += sinkPer * rest;
      leftShares.push({
        requirementId: r.requirementId, rowLetter: r.rowLetter ?? null,
        lengthIn: r.lengthIn ?? null, widthIn: r.widthIn ?? null,
        shapeType: r.shapeType ?? null, dimUnit: r.dimUnit ?? null,
        pieces: rest, orderedQuantity: qty,
        edge: edgePer * rest, sink: sinkPer * rest,
        unpriced: r.unpriced,
        // A row PART of which is on stone has an unknown share of its sinks
        // waiting, for the same reason the slab side does.
        sinkEstimated: rowHasSinkMoney && rest < qty,
      });
    }
  }

  const slabs: SlabCost[] = [...bySlab.entries()].map(([slabId, b]) => ({
    slabId,
    slabCode: b.slabCode,
    colour: b.colour,
    pieces: b.pieces,
    rows: b.rows.size,
    edgeCost: money(b.edge),
    sinkCost: money(b.sink),
    total: money(b.edge + b.sink),
    unpricedRows: b.unpricedRows.size,
    sinkEstimated: b.sinkEstimated,
    breakdown: settleShares(b.shares, money(b.edge), money(b.sink)),
  }));

  // Dearest first, then by code, so the order is stable when two slabs tie —
  // a table that reshuffles between two refreshes is a table nobody trusts.
  slabs.sort((x, y) => y.total - x.total || String(x.slabCode ?? "").localeCompare(String(y.slabCode ?? "")));

  return {
    slabs,
    unallocated: {
      pieces: leftPieces,
      rows: leftRows.size,
      edgeCost: money(leftEdge),
      sinkCost: money(leftSink),
      total: money(leftEdge + leftSink),
      breakdown: settleShares(leftShares, money(leftEdge), money(leftSink)),
    },
    total: money(grand),
  };
}
