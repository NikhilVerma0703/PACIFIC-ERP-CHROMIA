// POST /api/sampling/intake
//
// One addition of sample stock, from either of the two places it happens: the
// sampling incharge's own "Add stock" screen, and the Fabrication Supervisor's
// two controls on /fab/supervisor/slabs.
//
// GATED ON "addStock", so BOTH callers reach it — Role.SAMPLING, the ADMIN, and
// the FABRICATION SUPERVISOR, who may do this and nothing else in the module
// (lib/sampling/actions.ts). The gate is asked for the action by name rather
// than being left to default, because samplingGate()'s default is "view" and
// would refuse the supervisor with a 403 that reads as a bug.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SIZE IS THE INTERESTING PART, AND ITS REFUSALS ARE PASSED THROUGH WORD
// FOR WORD.
//
// There are no standard sample sizes. A size is typed the first time it is
// used, saved, and is a pick-list option for everybody from then on — and
// nobody curates the list, so every typo becomes a permanent second entry with
// its own stock count. lib/sampling/size.ts is the whole defence, and half of
// what it does is REFUSE:
//
//   * a thickness with no unit ("2" is 2 cm to a cutter and 2 mm to a parser),
//   * mm or cm on an edge (100 mm would become 3.94 in and sit next to 4 in
//     forever),
//   * a fractional millimetre, an edge longer than a slab.
//
// Every one of those comes back as `parseSampleSize`'s own sentence, unedited,
// with a 400. Rewording them here would mean two spellings of the same rule and
// the screen showing whichever one it happened to reach.
//
// EITHER AN EXISTING SIZE OR A TYPED ONE, never both: `sizeId` picks a row that
// already exists (no parsing, because a stored row is already normalised), and
// length/width/thickness create-or-find one. A typed size that matches an
// existing row lands ON that row — that is the point of the unique index on the
// triple, and of storing the longer edge as the length so 4x6 and 6x4 are one
// size.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS WRITTEN, AND IN ONE TRANSACTION
//
//   sampling_size    created if this triple is new
//   sampling_stock   the shelf's quantity incremented (created at 0 first time)
//   sampling_intake  one append-only row: how many, from where, off which slab
//
// The stock row and the intake row must not be able to disagree — a stock
// increment with no intake row behind it is a count nobody can explain, and an
// intake row with no increment is stock that was added and never appeared. So
// they are one transaction, and the increment is `{ increment: n }` rather than
// a read-then-write, so two tablets adding to the same shelf both land.

import { NextRequest } from "next/server";
import { prisma, type TxClient } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";
import { parseSampleSize, sampleSizeLabel } from "@/lib/sampling/size";
import { checkIntake } from "@/lib/sampling/lifecycle";
import { isIntakeSource } from "@/lib/sampling/fabIntake";
import { markQcSlabSample } from "@/lib/fab/markQcSlabSample";
import { FINISHES, canonicalFinish } from "@/lib/catalogue/colours";

export const dynamic = "force-dynamic";

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}
function bad(error: string) {
  return Response.json({ error }, { status: 400 });
}

/** Postgres unique violation, as Prisma reports it. Both find-or-create paths
 *  below can lose the race with another tablet; losing it means the row now
 *  exists, which is the outcome that was wanted. */
function isUniqueViolation(err: unknown): boolean {
  return String((err as { code?: string })?.code ?? "") === "P2002";
}

export async function POST(req: NextRequest) {
  const g = await samplingGate("addStock");
  if (!g.ok) return deny(g.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  // ---- WHICH COLOUR, IN WHICH FINISH ---------------------------------------
  //
  // EITHER an existing colour+finish row, OR a colour and one of the four
  // finishes — in which case the row is created here.
  //
  // The owner: "I need the finish type of all — polished, suede, matte,
  // leathered." The chart only ever printed the finish variants somebody had
  // photographed (three of 132 lines), so nearly every colour had exactly ONE
  // product_colour_finish row and the sample form could offer nothing else:
  // Carrara Royale showed "Polished" alone. But a sample can be cut in any
  // finish on request, so the four are always offered and the row appears the
  // first time one is used — the same find-or-create the size list has always
  // done, and for the same reason.
  const colourFinishIdRaw = String(body.colourFinishId ?? "").trim();
  const colourIdRaw = String(body.colourId ?? "").trim();
  const finishRaw = String(body.finish ?? "").trim();

  let colourFinishId = colourFinishIdRaw;
  let colourFinishCreated = false;

  if (!colourFinishId) {
    if (!colourIdRaw || !finishRaw) return bad("Choose a colour and finish.");
    // REFUSED, NOT COERCED. canonicalFinish folds the chart's spellings and the
    // ERP's own onto the owner's four words; a word outside them is a client
    // bug, and creating a fifth finish nobody can dispatch against would be
    // worse than saying no.
    const finish = canonicalFinish(finishRaw);
    if (!finish) {
      return bad(`"${finishRaw}" is not a finish. Use one of ${FINISHES.join(", ")}.`);
    }
    const colour = await prisma.productColour.findUnique({
      where: { id: colourIdRaw },
      select: { id: true },
    });
    if (!colour) return bad("That colour is not in the chart — reload the page.");

    let row = await prisma.productColourFinish.findUnique({
      where: { colourId_finish: { colourId: colour.id, finish } },
      select: { id: true },
    });
    if (!row) {
      try {
        row = await prisma.productColourFinish.create({
          data: { colourId: colour.id, finish },
          select: { id: true },
        });
        colourFinishCreated = true;
      } catch (err) {
        // Two tablets adding the same colour+finish at once: losing the race
        // means the row now exists, which is the outcome that was wanted.
        if (!isUniqueViolation(err)) throw err;
        row = await prisma.productColourFinish.findUnique({
          where: { colourId_finish: { colourId: colour.id, finish } },
          select: { id: true },
        });
      }
    }
    if (!row) return Response.json({ error: "Could not save that finish — try again." }, { status: 500 });
    colourFinishId = row.id;
  }

  const source = String(body.source ?? "");
  // NOT defaulted. The enum is the only record of WHY a piece exists — "how
  // much of our stock is offcut rather than cut-to-sample" is the question the
  // column exists to answer — and a default would answer it for whoever forgot
  // to say.
  if (!isIntakeSource(source)) {
    return bad(`Source must be SAMPLE_CUTTING or FAB_OFFCUT, not "${source}".`);
  }

  const quantity = Number(body.quantity);
  // checkIntake owns the whole-piece rule, and its wording. A separate test for
  // "is it a number" here would be a second spelling of the same refusal.
  const qtyCheck = checkIntake(0, quantity);
  if (!qtyCheck.ok) return bad(qtyCheck.reason);

  const sourceRefRaw = String(body.sourceRef ?? "").trim();
  const sourceRef = sourceRefRaw === "" ? null : sourceRefRaw;
  const noteRaw = String(body.note ?? "").trim();
  const note = noteRaw === "" ? null : noteRaw;

  // ---- WHICH SLAB. Refused, not defaulted, for the two fab sources --------
  //
  // Both fabrication controls sit on a slab card and send that card's number,
  // so a missing one means the slab reached the board without a number — and
  // pieces recorded against nothing can never be traced back once the stone has
  // gone. This used to be accepted silently: the field is locked and
  // un-typeable on those forms, so nobody could even have corrected it.
  //
  // The sampling desk's own additions are exempt: they legitimately have no
  // slab. That is the whole difference between the sources, so it is the source
  // that decides.
  const fromFab = source === "SAMPLE_CUTTING" || source === "FAB_OFFCUT";
  if (fromFab && !sourceRef) {
    return bad(
      "Which slab did these come off? A sample cut on the shop floor has to carry its " +
      "slab number, or the stock cannot be traced back to the stone once it has gone.",
    );
  }

  // polish_qc.id, when the slab has one. Verified rather than trusted: the id
  // arrives from the browser, and an unchecked one would write a link that
  // joins to nothing — worse than the null it replaced, because it LOOKS
  // traceable. A slab legitimately without a QC record stores null and keeps
  // the readable reference above.
  const sourceQcIdRaw = String(body.sourceQcId ?? "").trim();
  let sourceQcId: string | null = null;
  if (sourceQcIdRaw) {
    const qc = await prisma.polishQc.findUnique({
      where: { id: sourceQcIdRaw },
      select: { id: true },
    });
    if (!qc) return bad("That slab is no longer in QC — reload the board and try again.");
    sourceQcId = qc.id;
  }

  // fab_slab.id — the card these came off, and the column fabrication's
  // accounting groups by. computeSlabLoss sums sampledAreaSqft over it, so a
  // wrong id would move stone onto another slab's loss figure; verified for
  // that reason rather than trusted.
  const sourceSlabIdRaw = String(body.sourceSlabId ?? "").trim();
  let sourceSlabId: string | null = null;
  if (sourceSlabIdRaw) {
    const fabSlab = await prisma.fabSlab.findUnique({
      where: { id: sourceSlabIdRaw },
      select: { id: true },
    });
    if (!fabSlab) return bad("That slab is no longer on the board — reload and try again.");
    sourceSlabId = fabSlab.id;
  }

  // ---- the colour+finish has to exist; it is chart data, not typed here ----
  const colourFinish = await prisma.productColourFinish.findUnique({
    where: { id: colourFinishId },
    select: { id: true, finish: true, colour: { select: { name: true } } },
  });
  if (!colourFinish) return bad("That colour and finish is not in the chart — reload the page.");
  const itemName = `${colourFinish.colour.name} (${colourFinish.finish})`;

  // ---- the size: an existing row, or a typed one ----
  const pickedSizeId = String(body.sizeId ?? "").trim();
  let sizeId: string;
  let sizeLabel: string;
  let sizeCreated = false;

  if (pickedSizeId) {
    const existing = await prisma.samplingSize.findUnique({
      where: { id: pickedSizeId },
      select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true },
    });
    if (!existing) return bad("That size is no longer in the list — reload the page.");
    sizeId = existing.id;
    sizeLabel = sampleSizeLabel({
      lengthIn: Number(existing.lengthIn),
      widthIn: Number(existing.widthIn),
      thicknessMm: Number(existing.thicknessMm),
    });
  } else {
    const parsed = parseSampleSize({
      length: body.length as string | number | null | undefined,
      width: body.width as string | number | null | undefined,
      thickness: body.thickness as string | number | null | undefined,
    });
    // VERBATIM. See the note at the head of this file.
    if (!parsed.ok) return bad(parsed.reason);
    const { lengthIn, widthIn, thicknessMm } = parsed.size;
    sizeLabel = sampleSizeLabel(parsed.size);

    const key = { lengthIn, widthIn, thicknessMm };
    let row = await prisma.samplingSize.findUnique({
      where: { lengthIn_widthIn_thicknessMm: key },
      select: { id: true },
    });
    if (!row) {
      try {
        row = await prisma.samplingSize.create({
          // createdById records who typed a size nobody recognises. No hard FK
          // — the Sales/Chromia precedent, and this is not always sampling
          // staff: a Fabrication Supervisor adding offcuts may be the first
          // person ever to name a size.
          data: { ...key, createdById: (g.user as { id?: string })?.id ?? null },
          select: { id: true },
        });
        sizeCreated = true;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        row = await prisma.samplingSize.findUnique({
          where: { lengthIn_widthIn_thicknessMm: key },
          select: { id: true },
        });
      }
    }
    if (!row) return Response.json({ error: "Could not save that size — try again." }, { status: 500 });
    sizeId = row.id;
  }

  // ---- the shelf and the ledger, together ----
  const createdById = (g.user as { id?: string })?.id ?? null;
  const stockKey = { colourFinishId_sizeId: { colourFinishId, sizeId } };

  const result = await prisma.$transaction(async (tx: TxClient) => {
    let stock: { id: string; quantity: number } | null = null;
    try {
      stock = await tx.samplingStock.upsert({
        where: stockKey,
        create: { colourFinishId, sizeId, quantity },
        update: { quantity: { increment: quantity } },
        select: { id: true, quantity: true },
      });
    } catch (err) {
      // Two first-ever additions to the same shelf at once: one create wins,
      // the other must become the increment it meant to be.
      if (!isUniqueViolation(err)) throw err;
      stock = await tx.samplingStock.update({
        where: stockKey,
        data: { quantity: { increment: quantity } },
        select: { id: true, quantity: true },
      });
    }

    const intake = await tx.samplingIntake.create({
      data: { colourFinishId, sizeId, quantity, source, sourceRef, sourceQcId, sourceSlabId, note, createdById },
      select: { id: true, createdAt: true },
    });

    return { onHand: Number(stock?.quantity ?? 0), intakeId: intake.id };
  });

  // ---- and the slab itself is now marked -----------------------------------
  //
  // "Initially full slab; if fabrication happened, CTS; if it's pushed to
  // sample, sample." Until now this path recorded the PIECES and left the SLAB
  // reading as whole — so a slab cut down entirely for samples still showed as
  // dispatchable stock, and the CEO board counted it as untouched.
  //
  // AFTER the transaction, never inside it: the stock is physically on the
  // shelf the moment that commits, and an intake must not be rolled back
  // because a mark could not be written. Same reason nothing here can throw.
  //
  // A REFUSAL IS THE NORMAL CASE FOR OFFCUTS. setSlabMark only moves a slab
  // out of FULL_SLAB, so a FAB_OFFCUT coming off a slab fabrication already
  // cut leaves it CTS — which is right. That slab was cut for an order; the
  // samples are what was left over, not what it became. Only a slab taken
  // whole for sampling becomes SAMPLE, and that is what the guard decides,
  // not the source enum.
  // markQcSlabSample writes the mark AND the dispatch signal AND refreshes
  // inventory's mirror — "samples are always in cut pieces", so a slab that went
  // to the sample shelf must stop being sellable as a full slab. Before this it
  // stayed graded A and dispatchable.
  let slabMark: string | null = null;
  if (sourceQcId) {
    try {
      await markQcSlabSample(sourceQcId);
      const after = await prisma.polishQc.findUnique({
        where: { id: sourceQcId },
        select: { qualityGrade: true },
      });
      // Read back rather than assume: the write is refused for a slab
      // fabrication already cut, and the screen should say CTS in that case
      // rather than claim a sample took a slab it did not.
      const g = String(after?.qualityGrade ?? "").trim().toUpperCase();
      slabMark = g === "SAMPLE" || g === "CTS" ? g : null;
    } catch (err) {
      console.error("[sampling/intake] could not mark slab SAMPLE", sourceQcId, err);
    }
  }

  return Response.json({
    ok: true,
    intakeId: result.intakeId,
    sizeId,
    sizeLabel,
    /** What the source slab now reads as — SAMPLE when this intake took it,
     *  CTS when fabrication had already cut it and these are offcuts, null when
     *  no slab was linked or scripts/0057 is not applied yet. */
    slabMark,
    /** True when this typing is the first use of this size — the screens say so,
     *  because "it is now an option for everyone" is the consequence the person
     *  typing it has to know about. */
    sizeCreated,
    /** True when this is the first time anybody has cut this colour in this
     *  finish — the screens say so, because "it is now an option for everyone"
     *  is the consequence the person choosing it has to know about. */
    colourFinishCreated,
    item: itemName,
    quantity,
    onHand: result.onHand,
    source,
    sourceRef,
  }, { status: 201 });
}
