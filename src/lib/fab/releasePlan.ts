// Which slab each piece of a requirement gets cut from, at release time.
// Pure — no database, no Prisma — so `node --test` can reach it, and so the one
// rule that decides where physical work lands is written down once.
//
// A requirement is a piece type and a quantity ("3 of piece 2B"). Its
// allocations say which slabs those pieces come off, and there can be several:
// a CLO plan splits one piece type across slabs to use the material. Release
// used to read `allocations[0].slabId` and stamp it on every piece, so a split
// requirement released entirely onto its first slab — the cutter at the second
// slab was given nothing, and the first was asked for more than it holds.
//
// TWO SHAPES OF RELEASE LIVE HERE. buildReleasePlan below is the PROJECT-scoped
// one (/api/fab/supervisor/release-project): every requirement at once, each
// piece routed to the slab its allocations name. planSlabRelease at the foot of
// the file is the SLAB-scoped one (/api/fab/approve-slab): the pieces of exactly
// one slab, at the moment the supervisor sends it to the cutter. They share this
// file because they are the same decision at two scopes, and the piece-code
// numbering has to agree between them or the @unique on fab_piece.piece_code
// starts rejecting work.

// The ONE import, and it is by relative path with the extension spelled out —
// the same reason lib/fab/postJson.ts imports "../httpJson.ts": tests/*.test.ts
// load this file directly under `node --test`, which has no idea what "@/"
// means and will not guess an extension. resolveSinkQuantity is the single
// authority on "how many of this row's pieces carry a sink"; the slab planner
// must not hold a second opinion about it.
import { resolveSinkQuantity } from "./requirement-derive.ts";

export interface ReleaseAllocation {
  slabId: string;
  allocatedQuantity: number;
}

export interface ReleasePlanInput {
  /** How many pieces were ordered. */
  quantity: number;
  /** Slab allocations for this requirement, oldest first. */
  allocations: ReleaseAllocation[];
  /** Slab to use for pieces the allocations do not cover — normally the
   *  drawing's default slab. Null when there is none. */
  fallbackSlabId: string | null;
}

export interface ReleasePlan {
  /** One entry per piece to create, in cut order. Length is always the ordered
   *  quantity when the requirement is releasable at all. */
  slabIds: string[];
  /** Pieces the allocations claimed beyond what was ordered. Non-zero means the
   *  allocation data is wrong and someone has to look at it. */
  overAllocatedBy: number;
}

export function buildReleasePlan(input: ReleasePlanInput): ReleasePlan {
  const { quantity, allocations, fallbackSlabId } = input;

  const slabIds: string[] = [];
  for (const alloc of allocations) {
    // A negative or fractional allocatedQuantity would otherwise loop oddly or
    // forever; floor it at zero and to whole pieces.
    const n = Math.max(0, Math.floor(alloc.allocatedQuantity));
    for (let i = 0; i < n; i++) slabIds.push(alloc.slabId);
  }

  // Anything the allocations do not cover falls back — that is the ordinary
  // case when a drawing default is carrying the whole requirement, in which
  // case there are no allocations at all.
  const fallback = fallbackSlabId ?? allocations[0]?.slabId ?? null;
  while (slabIds.length < quantity && fallback) slabIds.push(fallback);

  // Over-allocation is a data problem, not an instruction to overproduce: the
  // order is for `quantity` pieces and that is what gets cut, labelled and
  // packed. The excess is dropped and counted so it can be reported.
  const overAllocatedBy = Math.max(0, slabIds.length - quantity);
  if (overAllocatedBy > 0) slabIds.length = Math.max(0, quantity);

  return { slabIds, overAllocatedBy };
}

/* -- Naming the requirements that block a release -------------------------- */

// The release guard used to say "7 requirement(s) have no slab" and stop there.
// On a 198-line project that sends the supervisor hunting through the board for
// seven rows the server has already identified. Name them.

export interface UnresolvedRequirement {
  /** fab_requirement.row_letter — the name every piece of this row carries
   *  ({projectCode}-{LETTER}-{n}). Preferred over pieceLabel wherever it
   *  exists, so a refusal names the row the way the floor does. */
  rowLetter?: string | null;
  drawingNumber?: string | null;
  /** The customer's purchase order number, for rows that came off a PO PDF
   *  rather than a drawing. Those have no drawing at all. */
  poNumber?: string | null;
  pieceLabel?: string | null;
  description?: string | null;
}

/** How a single blocked requirement is written on screen: "D-101 piece 2B", or
 *  "PO 10026 Row 7" for a row that came off a purchase order. */
export function describeRequirement(r: UnresolvedRequirement): string {
  const drawing = r.drawingNumber?.trim();
  const po = r.poNumber?.trim();
  // The LETTER first: it is what the pieces are named after, so a message
  // that says "piece A" matches the sticker. "Row 3" only survives for rows
  // imported before scripts/0054.
  const letter = r.rowLetter?.trim().toUpperCase();
  const label = (letter && /^[A-Z]+$/.test(letter) ? letter : null) || r.pieceLabel?.trim() || r.description?.trim();
  if (drawing && label) return `${drawing} piece ${label}`;
  if (drawing) return `drawing ${drawing}`;
  // A PO row's handle is the customer's PO number and the PDF row number
  // ("PO 10026 Row 7") — it has no drawing to be named by, and "piece Row 7"
  // on a project holding four purchase orders names four different rows.
  if (po && label) return `PO ${po} ${label}`;
  if (po) return `PO ${po}`;
  if (label) return `piece ${label}`;
  return "an unnamed piece type";
}

/**
 * The operator-facing message for a release blocked on missing slabs. Names the
 * offenders rather than counting them, and caps the list so one bad import does
 * not produce a wall of text — the count still tells them the true size.
 */
export function describeUnresolvedRequirements(
  rows: UnresolvedRequirement[],
  max = 8,
): string {
  const n = rows.length;
  const head = rows.slice(0, max).map(describeRequirement);
  const shown = head.join(", ");
  const rest = n - head.length;
  const list = rest > 0 ? `${shown}, and ${rest} more` : shown;
  const noun = n === 1 ? "piece type has" : "piece types have";
  // The drawing-default escape hatch only exists for rows that HAVE a drawing.
  // Rows from a PO PDF have none, so offering it to a supervisor working the
  // new flow sends him looking for a screen that cannot help him: his only
  // move is to put each row on a slab.
  const anyDrawing = rows.some(r => !!r.drawingNumber?.trim());
  const fix = anyDrawing
    ? "Assign a slab to each, or give its drawing a default slab."
    : "Assign a slab to each on the slab board before releasing.";
  return `${n} ${noun} no slab: ${list}. ${fix}`;
}

/* -- Releasing ONE SLAB, at send-to-cutting -------------------------------- */

// WHY THIS EXISTS. The supervisor works a slab at a time: he stands at a slab,
// puts piece rows on it, marks which of them carry sinks, and sends THAT slab to
// the cutter. release-project cannot serve that flow — it is project-scoped and
// refuses unless every requirement in the project already has an allocation, so
// on slab 1 of 5 it blocks on the four slabs' worth of rows he has not placed
// yet. Sending a slab therefore has to create the pieces for exactly that slab's
// allocations, and this is the rule for which pieces those are.
//
// THE SUBTLE PART IS THE SINK. fab_requirement.sink_quantity is per ORDER ROW,
// not per slab: "30 of these 60 get a sink". If the row is cut 12 to a slab,
// then across every slab exactly the first 30 pieces created for it carry one —
// 12 on the first slab, 12 on the second, 6 of the third slab's 12 on the third,
// and none after that. Deciding it per slab instead ("30 sinks on every slab")
// puts 60 sinks on a 30-sink order and the shop cuts thirty holes nobody asked
// for. So the rule is a TOP-UP: count the sinks that already exist for the row,
// and only make up the balance.
//
// THE OTHER THING IT COUNTS is how much of the row is still unreleased. A slab
// may not mint pieces the order does not have left, whether because the row was
// released with the project, or because a second slab claims quantity the first
// already took. buildReleasePlan caps at the ordered quantity for the same
// reason; this caps at the ordered quantity MINUS what exists.

/** How the pieces of one requirement are numbered inside a project:
 *  `{projectCode}-{NNNN}`. Four digits pads a 902-piece project comfortably and
 *  a bigger one simply gets a longer number — it stays unique either way. */
// RETIRED 2026-08 — replaced by lib/fab/pieceNaming.ts.
//
// This minted {projectCode}-{NNNN} ("PRJ1-0007"), one sequence across a whole
// project, which said nothing about which ordered row a piece belonged to. The
// owner's format is {projectCode}-{LETTER}-{n} — a letter per row, a number per
// piece — so a cutter reading a piece of stone knows the row without a lookup.
//
// export function formatPieceCode(projectCode: string, n: number): string {
//   return `${projectCode}-${String(n).padStart(4, "0")}`;
// }

/**
 * Where the piece counter resumes.
 *
 * fab_piece.piece_code is @unique GLOBALLY (schema.prisma), so numbering from 1
 * on every slab would collide with the slab before it the moment two slabs of
 * one project are sent. Given every piece code the project already carries, this
 * returns the first number that is free.
 *
 * Codes that do not fit the release format are ignored rather than parsed:
 * the cutting queue used to mint `{projectCode}-{label}-{NNN}-{slabSuffix}`,
 * and a tail like "2B-003-9f1c" is not a number this counter can continue.
 */
// RETIRED 2026-08 — superseded by nextPieceNumberInRow in
// lib/fab/pieceNaming.ts, which resumes a ROW rather than a project.
//
// export function nextPieceNumber(projectCode: string, existingPieceCodes: string[]): number {
//   const prefix = `${projectCode}-`;
//   let next = 1;
//   for (const code of existingPieceCodes ?? []) {
//     if (typeof code !== "string" || !code.startsWith(prefix)) continue;
//     const tail = code.slice(prefix.length);
//     if (/^\d+$/.test(tail)) next = Math.max(next, Number(tail) + 1);
//   }
//   return next;
// }

/** Whole, non-negative pieces. Junk (NaN, null, -1, 1.6) can never widen a loop
 *  or mint a piece nobody ordered. */
function whole(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export interface SinkTopUpInput {
  /** fab_requirement.sink_quantity, raw. NULL = the supervisor has not looked
   *  at the row; 0 = he looked and said none. Both mean no sink. */
  sinkQuantity: number | null | undefined;
  /** fab_requirement.quantity — the whole order for the row, every slab. */
  orderedQuantity: number;
  /** fab_piece rows for this requirement that already carry has_sink, on any
   *  slab, from any earlier release. */
  sinksAlreadyCreated: number;
  /** How many pieces of this row this slab is about to create. */
  piecesOnThisSlab: number;
}

/**
 * How many of the pieces this slab is about to create carry a sink — the
 * balance of the row's sink count, never more than the slab is making.
 *
 * The sinks always land on the FIRST pieces created, so a row of 60 with 30
 * sinks cut 12 to a slab gives 12, 12, then 6-of-12 and nothing after.
 */
export function sinkPiecesForSlab(input: SinkTopUpInput): number {
  // resolveSinkQuantity, not a local clamp: a stale sink_quantity left behind
  // after someone reduced the order must be capped the same way here as it is
  // on the sink board and in release-project.
  const wanted = resolveSinkQuantity(input.sinkQuantity, input.orderedQuantity);
  const owed = Math.max(0, wanted - whole(input.sinksAlreadyCreated));
  return Math.min(whole(input.piecesOnThisSlab), owed);
}

export interface SlabReleaseRow {
  /** fab_requirement.id. */
  requirementId: string;
  /** How the row is named in anything the supervisor has to read —
   *  describeRequirement's output. */
  name: string;
  /** fab_requirement.quantity: the whole order, across every slab. */
  orderedQuantity: number;
  /** Sum of fab_requirement_allocation.allocated_quantity for this row on THIS
   *  slab. A row folded across two allocations of the same slab is summed. */
  allocatedOnThisSlab: number;
  /** fab_piece rows that already exist for this requirement, on ANY slab. */
  piecesAlreadyCreated: number;
  /** How many of those already carry a sink. */
  sinksAlreadyCreated: number;
  /** fab_requirement.sink_quantity, raw. */
  sinkQuantity: number | null | undefined;
  /** fab_requirement.row_letter — the row's letter in {project}-{LETTER}-{n}.
   *  See lib/fab/pieceNaming.ts. */
  rowLetter: string;
  /** Where THIS ROW's numbering resumes: nextPieceNumberInRow(...). A row is
   *  not cut in one go — 28 pieces can be 12 on one slab and 16 on the next —
   *  and piece_code is @unique globally, so a restart at 1 fails to insert. */
  nextNumberInRow: number;
}

export interface SlabReleaseInput {
  /** The rows on this slab, in the order they were put on it. Each carries its
   *  OWN letter and its own resume number: numbering is per row now, not one
   *  sequence across the project. */
  rows: SlabReleaseRow[];
}

export interface PlannedSlabPiece {
  requirementId: string;
  /** The row's letter in {projectCode}-{LETTER}-{n}. */
  rowLetter: string;
  /** This piece's number WITHIN ITS ROW. */
  n: number;
  hasSink: boolean;
}

// THE PLAN EMITS THE PARTS, NOT THE STRING, and that is deliberate.
//
// This module imports nothing (the rule at the top of the file), so it cannot
// call formatPieceCode in lib/fab/pieceNaming.ts — and writing the format out a
// second time here is precisely how the shop floor ended up carrying two
// incompatible piece codes at once. The caller has both modules in scope and
// does the formatting, so the format lives in exactly one place.

export interface SlabReleasePlan {
  /** One entry per fab_piece to create, in cut order. */
  pieces: PlannedSlabPiece[];
  /** Rows released short of what the slab claimed — the allocation data is
   *  wrong and someone has to look at it, but the rest of the slab still goes. */
  warnings: string[];
  /** Rows with nothing left to release at all. Named, with quantities, so a
   *  refusal can say which. */
  blocked: { name: string; orderedQuantity: number }[];
}

/**
 * The pieces one slab creates when it is sent to the cutter.
 *
 * IDEMPOTENCE IS A PROPERTY OF THE INPUT, not of a flag. Feed it the counts that
 * exist after a previous release of the same slab and every row's headroom is
 * zero, so it plans nothing — running it twice cannot produce two sets of
 * pieces. The route still takes a row lock before reading those counts, because
 * two concurrent sends would otherwise both read the pre-release numbers.
 */
export function planSlabRelease(input: SlabReleaseInput): SlabReleasePlan {
  const pieces: PlannedSlabPiece[] = [];
  const warnings: string[] = [];
  const blocked: { name: string; orderedQuantity: number }[] = [];

  for (const row of input.rows ?? []) {
    const ordered = whole(row.orderedQuantity);
    const created = whole(row.piecesAlreadyCreated);
    const wanted = whole(row.allocatedOnThisSlab);
    if (wanted === 0) continue;

    // What the order still has left to give, anywhere. Pieces already made for
    // this row — on this slab or another — have spent it.
    const headroom = Math.max(0, ordered - created);
    const toCreate = Math.min(wanted, headroom);

    if (toCreate === 0) {
      blocked.push({ name: row.name, orderedQuantity: ordered });
      continue;
    }
    if (toCreate < wanted) {
      warnings.push(
        `${row.name}: this slab claims ${wanted} piece(s) but only ${headroom} of the ${ordered} ` +
        `ordered were still unreleased — ${toCreate} created, ${wanted - toCreate} not. ` +
        `Check where the rest of this row was released.`,
      );
    }

    const sinksHere = sinkPiecesForSlab({
      sinkQuantity: row.sinkQuantity,
      orderedQuantity: ordered,
      sinksAlreadyCreated: row.sinksAlreadyCreated,
      piecesOnThisSlab: toCreate,
    });

    // Per row, resuming where this row left off on any earlier slab.
    let n = Number.isFinite(row.nextNumberInRow) ? Math.max(1, Math.floor(row.nextNumberInRow)) : 1;
    for (let i = 0; i < toCreate; i++) {
      pieces.push({
        requirementId: row.requirementId,
        rowLetter: row.rowLetter,
        n: n++,
        // The sinks go on the first pieces this slab makes, which is what makes
        // the top-up across slabs come out at exactly sink_quantity.
        hasSink: i < sinksHere,
      });
    }
  }

  return { pieces, warnings, blocked };
}

/**
 * The refusal when a slab has rows on it but none of them have a piece left to
 * give — every one was already released somewhere else. Sending it would create
 * a cutting job with nothing in it, which is the exact state that used to make
 * the cutting queue invent its own pieces.
 */
export function describeAlreadyReleasedRows(
  slabLabel: string,
  rows: { name: string; orderedQuantity: number }[],
  max = 8,
): string {
  const n = rows.length;
  const head = rows.slice(0, max).map(r => `${r.name} (all ${r.orderedQuantity} already released)`);
  const rest = n - head.length;
  const list = rest > 0 ? `${head.join(", ")}, and ${rest} more` : head.join(", ");
  const those = n === 1 ? "that row" : "those rows";
  return (
    `${slabLabel} has nothing left to cut: ${list}. Every piece of ${those} was released on ` +
    `another slab — take ${n === 1 ? "it" : "them"} off this slab, or check whether it has ` +
    `already been sent to the cutter. Nothing was sent.`
  );
}
