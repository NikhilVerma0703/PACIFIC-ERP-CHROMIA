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

// Declared before use. They were below the handler, which works only because
// the handler runs after module evaluation — a detail nobody should have to
// know to read this file.
class AlreadyPackaged { constructor(readonly n: number) {} }
class MissingPieces { constructor(readonly n: number) {} }
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
    if (e instanceof AlreadyPackaged || e instanceof MissingPieces || e instanceof NotPackable) return e;
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") return new DuplicateCode();
    throw e;
  });

  if (result instanceof AlreadyPackaged)
    return Response.json({ error: `${result.n} piece(s) already packaged — refresh and try again` }, { status: 409 });
  if (result instanceof MissingPieces)
    return Response.json({ error: `${result.n} piece(s) no longer exist — refresh the queue` }, { status: 409 });
  if (result instanceof NotPackable)
    return Response.json({ error: `${result.n} piece(s) are not ready to pack — rejected, not cut, or still in polish/sink/fabrication. Refresh and try again` }, { status: 409 });
  if (result instanceof DuplicateCode)
    return Response.json({ error: `Package code "${code}" is already used — choose another` }, { status: 409 });

  const { pkg, sampleCredit } = result;
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
