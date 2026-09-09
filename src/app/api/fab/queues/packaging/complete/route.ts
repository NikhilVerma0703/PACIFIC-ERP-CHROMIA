// PACKING A SAMPLE PIECE IS WHAT CREATES SAMPLE STOCK.
//
// The owner: "they create the request — catalogue requirement — and request the
// samples and send to supervisor. He the same way chooses the slab and adds
// pieces and quantity and sends to cutting, then polished (no sink and fabri in
// the samples) and pushed to package."
//
// So the end of the line is here. A piece on a SAMPLE project has been cut and
// polished; packing it is the moment it stops being stone in progress and
// becomes a sample on a shelf. Nothing else in the system makes that happen, and
// doing it anywhere earlier would count stock that could still be rejected.
//
// IN THE SAME TRANSACTION as the packing itself. A piece marked PACKAGED with no
// stock behind it is a sample nobody can find; stock with no packed piece behind
// it is a count nobody can explain. Neither is allowed to exist on its own.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { fabGate } from "@/lib/fab/access";
import { requireProcessSession } from "@/lib/fab/processSessionServer";
import { stampOperationWorker } from "@/lib/fab/stampWorker";
import { isSampleProject, planSampleCredit } from "@/lib/fab/sampleOrder";
import { isReadyForPackaging } from "@/lib/fab/routing";
import { parseEdges } from "@/lib/fab/pricing";
import {
  rowShares, pieceChargeWithHand, type RowShares, type HandSpec,
} from "@/lib/fab/pieceCharge";
import { parseFaceEdges, faceEdgesUnset } from "@/lib/fab/shape";

// Declared before use. They were below the handler, which works only because
// the handler runs after module evaluation — a detail nobody should have to
// know to read this file.
class AlreadyPackaged { constructor(readonly n: number) {} }
class MissingPieces { constructor(readonly n: number) {} }
/** Somebody rejected a piece while this packing queue was open. Its own class
 *  because the remedy differs: a rejected piece is not coming back, so telling
 *  the packer to refresh and retry would send him round a loop. */
class RejectedPieces { constructor(readonly n: number) {} }
class DuplicateCode {}
/** A piece the queue would not have offered: rejected, never cut, or still owing
 *  polish / sink / fabrication. The tablet holds its `selected` set across a queue
 *  refresh, so the packer can still be holding a piece a supervisor rejected two
 *  minutes ago. Same 409 as the other two — the answer is always "refresh". */
class NotPackable { constructor(readonly n: number) {} }

interface SampleCredit {
  /** Pieces that reached a shelf. */
  credited: number;
  /** Sample pieces whose row could not say WHICH shelf — packed, not counted.
   *  Reported rather than guessed at: crediting the wrong shelf makes a count
   *  wrong and nobody ever finds out. */
  unattributed: number;
}

/**
 * TURN PACKED SAMPLE PIECES INTO SAMPLE STOCK.
 *
 * ONE INTAKE ROW PER PIECE, quantity one. That is what makes a re-run safe:
 * fab_piece.sampling_intake_id is unique, so a piece can be the reason for
 * exactly one intake, ever. A package of forty writes forty ledger rows, which
 * is nothing for an append-only table and gives every sample on the shelf a
 * piece code it can be traced back to.
 *
 * THE STOCK INCREMENT IS GROUPED, because that table holds a count and not a
 * history: forty pieces of one colour+finish and size are one `increment: 40`,
 * not forty round trips.
 */
async function creditSampleStock(
  tx: Prisma.TransactionClient,
  pieceIds: string[],
): Promise<SampleCredit> {
  const pieces = await tx.fabPiece.findMany({
    where: { id: { in: pieceIds }, samplingIntakeId: null },
    select: {
      id: true,
      slabId: true,
      project: { select: { kind: true } },
      requirement: { select: { colourFinishId: true, samplingSizeId: true } },
      slab: { select: { slabCode: true, pacificQcId: true } },
    },
  });

  const out: SampleCredit = { credited: 0, unattributed: 0 };
  // colourFinishId + sizeId -> how many pieces landed on that shelf.
  const shelves = new Map<string, { colourFinishId: string; sizeId: string; n: number }>();

  for (const piece of pieces) {
    if (!isSampleProject(piece.project?.kind)) continue;   // a PO piece just ships

    const credit = planSampleCredit({
      colourFinishId: piece.requirement?.colourFinishId,
      samplingSizeId: piece.requirement?.samplingSizeId,
      quantity: 1,
      slabCode: piece.slab?.slabCode,
      pacificQcId: piece.slab?.pacificQcId,
      fabSlabId: piece.slabId,
    });
    // A sample row that cannot name its shelf. The piece is packed — it exists,
    // it is finished — and nothing is credited. See planSampleCredit.
    if (!credit) { out.unattributed++; continue; }

    const intake = await tx.samplingIntake.create({
      data: {
        colourFinishId: credit.colourFinishId,
        sizeId: credit.sizeId,
        quantity: credit.quantity,
        // SAMPLE_CUTTING, not FAB_OFFCUT: this stone was cut FOR samples on an
        // order, which is the distinction the column exists to record.
        source: "SAMPLE_CUTTING",
        sourceRef: credit.sourceRef,
        sourceQcId: credit.sourceQcId,
        sourceSlabId: credit.sourceSlabId,
        note: null,
        createdById: null,
      },
      select: { id: true },
    });
    await tx.fabPiece.update({
      where: { id: piece.id },
      data: { samplingIntakeId: intake.id },
    });

    const key = `${credit.colourFinishId}::${credit.sizeId}`;
    const seen = shelves.get(key);
    if (seen) seen.n += credit.quantity;
    else shelves.set(key, { colourFinishId: credit.colourFinishId, sizeId: credit.sizeId, n: credit.quantity });
    out.credited += credit.quantity;
  }

  for (const shelf of shelves.values()) {
    await tx.samplingStock.upsert({
      where: { colourFinishId_sizeId: { colourFinishId: shelf.colourFinishId, sizeId: shelf.sizeId } },
      create: { colourFinishId: shelf.colourFinishId, sizeId: shelf.sizeId, quantity: shelf.n },
      // increment, never a read-then-write: the sampling desk may be adding to
      // the same shelf by hand at this moment.
      update: { quantity: { increment: shelf.n } },
    });
  }

  return out;
}

/**
 * FREEZE WHAT THESE PIECES JUST EARNED.
 *
 * ─────────────────── WHY, AND WHY HERE ──────────────────────────────────────
 * The period report re-prices from the LIVE ordered row every time it is
 * opened, so editing a row in September changed what July earned — set
 * edge_faces to BOTH and a closed month silently doubles. Nothing was re-done
 * and nothing was re-billed; the number just moved. See scripts/0066.
 *
 * PACKING IS WHEN A PIECE EARNS — it is already the moment the report counts
 * the money — so this is the moment to write the figure down.
 *
 * ─────────────────── OUTSIDE THE TRANSACTION, AND BEST EFFORT ───────────────
 * DELIBERATELY. Packing a trolley of forty pieces is floor work that must not
 * fail because a reporting column is missing, so this runs AFTER the package is
 * committed and every path out of it is swallowed by the caller. A deploy
 * running ahead of scripts/0066 packs pieces exactly as it does today and
 * simply does not stamp them; the report then live-prices those pieces, which
 * is the behaviour that shipped before this existed.
 *
 * The cost of that choice is a piece that is packed and unstamped if this
 * throws. That is recoverable and visible — the last query in scripts/0066
 * lists them — where a failed pack in the middle of a shift is neither.
 *
 * ─────────────────── WRITTEN ONCE, EVER ─────────────────────────────────────
 * `AND charged_at IS NULL` in the UPDATE. A retried request, a re-scanned
 * trolley or a re-run of this function cannot move a figure that has already
 * been frozen — the same rule sampling_intake_id enforces for sample stock a
 * few lines above.
 */
async function stampPieceCharges(pieceIds: string[]): Promise<void> {
  const pieces = await prisma.fabPiece.findMany({
    where: { id: { in: pieceIds } },
    // hasSink decides the SINK share, and it is per PIECE — half a row can have
    // one. The EDGE share is per ROW, because a row is homogeneous, so it is
    // read from the requirement below rather than from the piece.
    select: { id: true, hasSink: true, requirementId: true },
  });
  if (!pieces.length) return;

  // ── WHAT WENT TO THE HAND BENCH, AND THE STONE IT WAS CUT FROM ──────────
  //
  // scripts/0067. A piece pulled off the machine carries its own faces, rate
  // and mode, and they override its row for that piece alone. Wrapped, because
  // a deploy running ahead of 0067 has no such columns and must still stamp the
  // ordinary rows — losing the hand-bench refinement is a far smaller failure
  // than stamping nothing.
  const handByPiece = new Map<string, HandSpec>();
  const stoneByPiece = new Map<string, { lengthIn: number | null; widthIn: number | null; thicknessMm: number | null; shape: string | null }>();
  try {
    const hand = await prisma.$queryRaw<Array<{
      id: string;
      hand_edges_top: string | null; hand_edges_bottom: string | null;
      hand_edges_side: string | null; hand_rate: number | null;
      // scripts/0069 + 0070 — the bench's own pair rate and per-face rates.
      // MISSING THESE MEANT FREEZING A PIECE AT THE WRONG FIGURE: the spec was
      // read without them, so priceRow fell back to the flat hand_rate and the
      // discount the bench was quoted never reached the invoice.
      hand_pair_rate: number | null;
      hand_rate_top: number | null; hand_rate_bottom: number | null; hand_rate_side: number | null;
      hand_pricing_mode: string | null; hand_total_override: number | null;
      length: number | null; width: number | null; thickness: number | null;
      shape_type: string | null;
    }>>`
      SELECT pc.id,
             pc.hand_edges_top, pc.hand_edges_bottom, pc.hand_edges_side,
             pc.hand_rate, pc.hand_pair_rate,
             pc.hand_rate_top, pc.hand_rate_bottom, pc.hand_rate_side,
             pc.hand_pricing_mode, pc.hand_total_override,
             r.length, r.width, r.shape_type::text AS shape_type, s.thickness
      FROM   fab_piece pc
      LEFT   JOIN fab_requirement r ON r.id = pc.requirement_id
      LEFT   JOIN fab_slab s        ON s.id = pc.slab_id
      WHERE  pc.id = ANY(${pieces.map((p) => p.id)}::text[])
        AND  pc.polish_by_hand = true
    `;
    for (const h of hand) {
      const faces = { top: h.hand_edges_top, bottom: h.hand_edges_bottom, side: h.hand_edges_side };
      handByPiece.set(h.id, {
        byHand: true,
        faceEdges: faceEdgesUnset(faces) ? null : parseFaceEdges(faces),
        rate: h.hand_rate == null ? null : Number(h.hand_rate),
        pairRate: h.hand_pair_rate == null ? null : Number(h.hand_pair_rate),
        rateTop: h.hand_rate_top == null ? null : Number(h.hand_rate_top),
        rateBottom: h.hand_rate_bottom == null ? null : Number(h.hand_rate_bottom),
        rateSide: h.hand_rate_side == null ? null : Number(h.hand_rate_side),
        pricingMode: h.hand_pricing_mode ?? null,
        totalOverride: h.hand_total_override == null ? null : Number(h.hand_total_override),
      });
      stoneByPiece.set(h.id, {
        lengthIn: h.length == null ? null : Number(h.length),
        widthIn: h.width == null ? null : Number(h.width),
        thicknessMm: h.thickness == null ? null : Number(h.thickness),
        shape: h.shape_type ?? null,
      });
    }
  } catch {
    // scripts/0067 not applied — nothing has ever been sent to hand.
  }

  const reqIds = [...new Set(
    pieces.map((p) => p.requirementId).filter((id): id is string => !!id),
  )];

  // Raw, and the same statement the CEO route prices from, so the stamp written
  // here and the fallback computed there cannot disagree. edge_faces and
  // shape_type arrive in scripts/0065 and 0063; if they are absent this throws
  // and the caller logs it, which is the correct outcome — a charge frozen
  // without the face multiplier would be half an invoice, permanently.
  const shares = new Map<string, RowShares>();
  if (reqIds.length) {
    const priceInputs = await prisma.$queryRaw<Array<{
      id: string; length: number | null; width: number | null; quantity: number;
      sink_quantity: number | null; finished_edges: string | null;
      thickness: number | null; shape_type: string | null; edge_faces: string | null;
    }>>`
      SELECT r.id, r.length, r.width, r.quantity, r.sink_quantity,
             r.finished_edges, r.edge_faces,
             r.shape_type::text AS shape_type,
             -- The thickness of any slab this row is cut from. MAX rather than
             -- an arbitrary pick, so the answer is stable.
             MAX(s.thickness) AS thickness
      FROM   fab_requirement r
      LEFT   JOIN fab_requirement_allocation ra ON ra.requirement_id = r.id
      LEFT   JOIN fab_slab s ON s.id = ra.slab_id
      WHERE  r.id = ANY(${reqIds}::text[])
      GROUP  BY r.id
    `;
    const spec0067 = new Map<string, {
      edges_top: string | null; edges_bottom: string | null; edges_side: string | null;
      edge_rate: number | null; pair_rate: number | null;
        edge_rate_top: number | null; edge_rate_bottom: number | null; edge_rate_side: number | null;
        pricing_mode: string | null;
      edge_total_override: number | null;
    }>();
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string } & {
        edges_top: string | null; edges_bottom: string | null; edges_side: string | null;
        edge_rate: number | null; pair_rate: number | null;
        edge_rate_top: number | null; edge_rate_bottom: number | null; edge_rate_side: number | null;
        pricing_mode: string | null;
        edge_total_override: number | null;
      }>>`
        SELECT id, edges_top, edges_bottom, edges_side,
               edge_rate, pair_rate, edge_rate_top, edge_rate_bottom, edge_rate_side,
               pricing_mode, edge_total_override
        FROM   fab_requirement WHERE id = ANY(${reqIds}::text[])
      `;
      for (const r of rows) spec0067.set(r.id, r);
    } catch { /* 0067 not applied — legacy specification stands */ }

    for (const r of priceInputs) {
      const x = spec0067.get(r.id);
      const faces = { top: x?.edges_top ?? null, bottom: x?.edges_bottom ?? null, side: x?.edges_side ?? null };
      shares.set(r.id, rowShares({
        faceEdges: faceEdgesUnset(faces) ? null : parseFaceEdges(faces),
        rate: x?.edge_rate ?? null,
        // scripts/0069 — the pair rate is part of what this row is quoted at, so
        // it must be here too: the figure frozen onto a packaged piece has to be
        // the figure the board showed, not a version of it computed without the
        // discount.
        pairRate: x?.pair_rate ?? null,
        // scripts/0070 — the frozen figure must be the figure the board showed,
        // which means the per-face rates too.
        rateTop: x?.edge_rate_top ?? null,
        rateBottom: x?.edge_rate_bottom ?? null,
        rateSide: x?.edge_rate_side ?? null,
        pricingMode: x?.pricing_mode ?? null,
        edgeTotalOverride: x?.edge_total_override ?? null,
        lengthIn: r.length == null ? null : Number(r.length),
        widthIn: r.width == null ? null : Number(r.width),
        quantity: Number(r.quantity ?? 0),
        sinkQuantity: r.sink_quantity == null ? null : Number(r.sink_quantity),
        thicknessMm: r.thickness == null ? null : Number(r.thickness),
        edges: parseEdges(r.finished_edges),
        shape: r.shape_type,
        edgeFace: r.edge_faces,
      }));
    }
  }

  // GROUPED BY THE FIGURE, not one UPDATE per piece. A package is usually one
  // or two ordered rows, so forty pieces are one or two statements.
  //
  // ONLY ROWS THAT PRICED CLEANLY ARE FROZEN — see mayFreeze. A row with a blank
  // width, an off-card thickness or an L-shaped outline prices to 0 with
  // `unpriced: true`, and stamping that 0 would make it PERMANENT: the UPDATE
  // below writes once and never rewrites, so the manager filling in the width
  // next week could never reach it. scripts/0061 is the precedent — slab
  // thicknesses of 120 and 70 mm were stored and repaired later, and a trolley
  // packed in between would have been frozen at ₹0 for good.
  //
  // An unfrozen piece is not a lost piece: charged_at stays NULL and the report
  // live-prices it, which is exactly the behaviour that shipped before any of
  // this existed. The figure simply keeps correcting itself until the row is
  // fixed and a later package freezes a real one.
  const groups = new Map<string, { edge: number; sink: number; ids: string[] }>();
  let skipped = 0;
  for (const p of pieces) {
    const rowShare = p.requirementId ? shares.get(p.requirementId) : null;
    const stone = stoneByPiece.get(p.id)
      ?? { lengthIn: null, widthIn: null, thicknessMm: null, shape: null };

    // THE GATE IS THE PIECE'S OWN ANSWER, NOT ITS ROW'S — and that matters for
    // exactly the piece this change is about. A hand-bench piece with an agreed
    // figure is freezable even when its ROW cannot be priced (an odd outline, a
    // blank width), because somebody settled the question for THIS piece. And a
    // piece sent to hand with nothing agreed is refused even when its row is
    // perfectly priceable, because the figure that would be frozen is not the
    // one it will eventually be worth.
    const c = pieceChargeWithHand(
      rowShare ?? null, p.hasSink === true, handByPiece.get(p.id) ?? null, stone,
    );
    if (!rowShare || c.unpriced) { skipped++; continue; }

    const key = `${c.edge}::${c.sink}`;
    const g = groups.get(key) ?? { edge: c.edge, sink: c.sink, ids: [] };
    g.ids.push(p.id);
    groups.set(key, g);
  }
  if (skipped > 0) {
    // Said out loud rather than swallowed: these pieces ARE packed and they DO
    // still earn, they are just still being priced live. The last query in
    // scripts/0066 lists them.
    console.warn(
      `[fab/packaging] ${skipped} piece(s) packed without a frozen charge — ` +
      `their row could not be priced in full (blank size, off-card thickness, ` +
      `or an outline with no perimeter). The report will live-price them.`,
    );
  }

  for (const g of groups.values()) {
    await prisma.$executeRaw`
      UPDATE fab_piece
         SET charged_edge = ${g.edge},
             charged_sink = ${g.sink},
             charged_at   = now()
       WHERE id = ANY(${g.ids}::text[])
         AND charged_at IS NULL`;
  }
}

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const gate = await requireProcessSession("PACKAGING");
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  const sess = gate.session;

  const body = await req.json().catch(() => null);
  const { pieceIds: rawIds, packageCode, remarks } = body ?? {};

  // Array.isArray, not `?.length`: a bare string passes a length check and then
  // reaches Prisma as `{ in: "abc" }`, which is a 500 rather than a 400.
  if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((x) => typeof x === "string" && x))
    return Response.json({ error: "pieceIds must be a non-empty array of ids" }, { status: 400 });

  // Deduplicated, because the claim below compares a row COUNT against this
  // length — the same id twice would look like a piece someone else had taken.
  const pieceIds: string[] = [...new Set(rawIds as string[])];

  if (packageCode != null && typeof packageCode !== "string")
    return Response.json({ error: "packageCode must be text" }, { status: 400 });

  // A user-supplied code that already exists is a collision the operator can
  // fix; without this it surfaced as a raw 500 from the unique constraint.
  // The generated fallback carries a random suffix because Date.now() alone
  // collides when two packages are closed in the same millisecond.
  const code = packageCode || `PKG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const result = await prisma.$transaction(async (tx) => {
    // CLAIM THE PIECES FIRST, CONDITIONALLY. This was a count() before the
    // transaction, which two concurrent submits both passed — each then created
    // a package, and the same piece ended up in two of them. Filtering the write
    // on "not already PACKAGED" makes the database pick the winner: whoever
    // updates 0 rows never had the pieces.
    //
    // REJECTED and PENDING are excluded here for the same reason PACKAGED is:
    // the queue GET refuses to offer them (isDroppedFromQueues), but the tablet
    // never prunes its `selected` set when the queue reloads, so a piece a
    // supervisor rejected mid-shift was still submitted — and became PACKAGED,
    // got a package row, completed its PACKAGING operation, counted towards CEO
    // packaging throughput, and if it was a sample piece put rejected stone on
    // the sampling shelf. PENDING (never cut) walked in the same door on a
    // hand-made request.
    //
    // AND SINCE THE CHARGE IS FROZEN AT PACKING, the same stale tick would have
    // stamped a hand-polish and sink charge onto stone that was scrapped. The
    // claim is this route's concurrency guard, so the rule belongs in it:
    // whoever updates 0 rows never had the pieces, for any of the three reasons.
    const claimed = await tx.fabPiece.updateMany({
      where: { id: { in: pieceIds }, status: { notIn: ["PACKAGED", "REJECTED", "PENDING"] } },
      data:  { status: "PACKAGED" },
    });
    if (claimed.count !== pieceIds.length) {
      // Roll the whole thing back rather than shipping a partial package — but
      // say WHICH failure it was. A short count means either "someone packaged
      // it first" or "that id does not exist", and telling an operator to
      // refresh when the real problem is a bad id sends them round a loop.
      const exists = await tx.fabPiece.count({ where: { id: { in: pieceIds } } });
      // A THIRD REASON NOW: somebody rejected one while this queue was open.
      // Named separately because the fix is different — a rejected piece is not
      // coming back, so "refresh and try again" would send him round a loop.
      const rejected = await tx.fabPiece.count({
        where: { id: { in: pieceIds }, status: "REJECTED" },
      });
      if (rejected > 0) {
        throw new RejectedPieces(rejected);
      }
      if (exists < pieceIds.length) throw new MissingPieces(pieceIds.length - exists);
      // The claim has ALREADY flipped the rows it won, so this count is "packaged
      // before us" plus "packaged by us" — everything not in it is a piece the
      // notIn refused: rejected or never cut. That reads differently to a packer
      // than "someone beat you to it", so it gets its own line.
      const packagedNow = await tx.fabPiece.count({ where: { id: { in: pieceIds }, status: "PACKAGED" } });
      const dropped = pieceIds.length - packagedNow;
      if (dropped > 0) throw new NotPackable(dropped);
      throw new AlreadyPackaged(pieceIds.length - claimed.count);
    }

    // AND THE ROUTING RULE, RE-CHECKED ON THE ROWS WE JUST TOOK. Status alone
    // does not say a piece is finished: a piece that still owes polishing, a
    // sink cut or fabrication sits at CUT/POLISHED, which the claim above
    // happily accepts. isReadyForPackaging is the SAME predicate the queue GET
    // filters on, so what this rejects is exactly what the queue would no
    // longer be offering — the flags moved under the packer, or the request
    // never came from the queue at all. Inside the transaction, so the throw
    // takes the claim, the package and the operations back with it.
    const claimedRows = await tx.fabPiece.findMany({
      where: { id: { in: pieceIds } },
      select: {
        id: true,
        polishRequired: true, polishingCompleted: true,
        hasSink: true, sinkCompleted: true,
        fabricationRequired: true, fabricationCompleted: true,
      },
    });
    const notReady = claimedRows.filter((p) => !isReadyForPackaging(p)).length;
    if (notReady > 0) throw new NotPackable(notReady);

    const p = await tx.fabPackage.create({
      data: {
        packageCode: code,
        remarks: remarks ?? null,
        pieces: { create: pieceIds.map((pid: string) => ({ pieceId: pid })) },
      },
    });
    await tx.fabPieceOperation.updateMany({
      where: { pieceId: { in: pieceIds }, operationType: "PACKAGING", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    const now = new Date();
    for (const pid of pieceIds) {
    const op = await tx.fabOperation.create({
        data: {
          pieceId: pid,
          operatorId: g.user.id as string,
          machineId: sess.machineId,
          operationType: "PACKAGING",
          status: "COMPLETED",
          startTime: now,
          endTime: now,
        },
      });
      await stampOperationWorker(tx, op.id, sess.workerId, sess.shift);
    }

    // ---- AND IF THESE WERE SAMPLES, THEY ARE NOW STOCK -------------------
    //
    // Read AFTER the claim, so only pieces this request actually took are
    // credited. sampling_intake_id is the guard: a piece that already has one
    // was credited by an earlier run — a re-scanned trolley, a retried request —
    // and must not be counted a second time. The column is UNIQUE, so even a
    // race that got past this check would fail rather than double the shelf.
    const sampleCredit = await creditSampleStock(tx, pieceIds);

    return { pkg: p, sampleCredit };
  }).catch((e: unknown) => {
    if (e instanceof AlreadyPackaged || e instanceof MissingPieces || e instanceof NotPackable || e instanceof RejectedPieces) return e;
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") return new DuplicateCode();
    throw e;
  });

  if (result instanceof RejectedPieces)
    return Response.json(
      { error: `${result.n} piece(s) were rejected while this queue was open — they cannot be packed. Refresh to drop them, then pack the rest.` },
      { status: 409 },
    );
  if (result instanceof AlreadyPackaged)
    return Response.json({ error: `${result.n} piece(s) already packaged — refresh and try again` }, { status: 409 });
  if (result instanceof MissingPieces)
    return Response.json({ error: `${result.n} piece(s) no longer exist — refresh the queue` }, { status: 409 });
  if (result instanceof NotPackable)
    return Response.json({ error: `${result.n} piece(s) are not ready to pack — rejected, not cut, or still in polish/sink/fabrication. Refresh and try again` }, { status: 409 });
  if (result instanceof DuplicateCode)
    return Response.json({ error: `Package code "${code}" is already used — choose another` }, { status: 409 });

  const { pkg, sampleCredit } = result;

  // ---- AND WHAT THEY EARNED IS NOW A FACT, NOT A CALCULATION -------------
  //
  // After the commit and never blocking it — see stampPieceCharges. The pieces
  // are packed whatever happens here; the only thing at stake is whether the
  // report reads a frozen figure or re-computes one from the live row.
  await stampPieceCharges(pieceIds).catch((e: unknown) => {
    console.error(
      "[fab/packaging] charge stamp failed — the pieces ARE packed; the period " +
      "report will live-price them, which is the pre-scripts/0066 behaviour",
      e,
    );
  });

  return Response.json({
    success: true,
    packageCode: pkg.packageCode,
    /** Sample pieces that reached a shelf in this package, and any that could
     *  not. Both are said out loud: "40 packed" and "40 packed, 3 not counted"
     *  are different afternoons for the sampling desk. */
    samplesCredited: sampleCredit.credited,
    samplesUnattributed: sampleCredit.unattributed,
    message:
      sampleCredit.credited > 0 || sampleCredit.unattributed > 0
        ? `${sampleCredit.credited} sample piece${sampleCredit.credited === 1 ? "" : "s"} added to stock` +
          (sampleCredit.unattributed > 0
            ? `. ${sampleCredit.unattributed} could not be counted — the row does not say which colour, finish and size it was ordered against.`
            : ".")
        : undefined,
  });
}
