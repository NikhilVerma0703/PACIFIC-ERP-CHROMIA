// GET  /api/sampling/requests   the sample orders on the floor, and how far along
// POST /api/sampling/requests   raise one
//
// THE SAMPLING DESK ASKS THE FLOOR FOR SAMPLES.
//
// The owner: "sampling page, they create the request — catalogue requirement —
// and request the samples and send to supervisor. He the same way chooses the
// slab and adds pieces and quantity and sends to cutting, then polished (no sink
// and fabri in the samples) and pushed to package."
//
// A request becomes a fab_project with kind = 'SAMPLE' and one fab_requirement
// per line. From that moment it is on the supervisor's ordinary slab board,
// indistinguishable in handling from a purchase order except that its rows can
// have no sinks and therefore never reach fabrication.
//
// ─────────────────────────────────── A LINE IS A SHELF AND A COUNT ──────────
// Each line names a colour, a finish, a size and how many. Those four are what a
// shelf IS — sampling_stock is keyed on colour+finish and size — so a request
// line maps one-to-one onto the shelf its pieces will land on when they are
// packed. The requirement also stores the size in INCHES, because that is what
// the saw needs and what every fabrication screen already reads.
//
// SIZES AND FINISHES ARE CREATED ON DEMAND, exactly as the intake form does it:
// a size typed here is saved and becomes an option for everyone, and a colour
// cut in a finish for the first time gains its product_colour_finish row. The
// request would otherwise be able to ask for something the shelf cannot hold.
//
// ─────────────────────────────────── WHY NOT A NEW TABLE ────────────────────
// A sample_request table would need its own slab assignment, its own cutting
// queue and its own polishing queue — and an operator choosing between two
// screens depending on what is on the saw. Sampling work is not a different kind
// of work; it is the same work for a different customer.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";
import { parseSampleSize, sampleSizeLabel } from "@/lib/sampling/size";
import { FINISHES, canonicalFinish } from "@/lib/catalogue/colours";
import {
  nextSampleOrderCode, sampleRouting, SAMPLE_REQUIREMENT_SLAB_CODE,
} from "@/lib/fab/sampleOrder";
import { assignRowLetters } from "@/lib/fab/pieceNaming";
import { rowSqft } from "@/lib/fab/requirementRow";

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
function isUniqueViolation(err: unknown): boolean {
  return String((err as { code?: string })?.code ?? "") === "P2002";
}

// A NOTE ON UNITS, because they nearly always go wrong here. sampling_size
// stores the edges in INCHES and the thickness in MILLIMETRES; fab_requirement
// stores exactly the same way. So a size crosses from the shelf to the saw
// untouched — no conversion, and nothing here to get backwards.

interface LineInput {
  colourId?: unknown;
  finish?: unknown;
  sizeId?: unknown;
  length?: unknown;
  width?: unknown;
  thickness?: unknown;
  quantity?: unknown;
}

export async function GET() {
  const g = await samplingGate("addStock");
  if (!g.ok) return deny(g.status);

  const orders = await prisma.fabProject.findMany({
    where: { kind: "SAMPLE" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, projectCode: true, customerName: true, status: true,
      createdAt: true, remarks: true,
      requirements: {
        select: {
          id: true, pieceLabel: true, rowLetter: true, quantity: true,
          length: true, width: true, thickness: true,
          colourFinish: { select: { finish: true, colour: { select: { name: true } } } },
          samplingSize: { select: { lengthIn: true, widthIn: true, thicknessMm: true } },
          allocations: { select: { allocatedQuantity: true } },
          _count: { select: { pieces: true } },
        },
      },
      pieces: { select: { id: true, status: true, samplingIntakeId: true } },
    },
  });

  return Response.json(orders.map((o) => {
    const packed = o.pieces.filter((p) => p.status === "PACKAGED").length;
    return {
      id: o.id,
      code: o.projectCode,
      requestedFor: o.customerName,
      status: o.status,
      createdAt: o.createdAt,
      note: o.remarks,
      /** Pieces asked for, cut, packed, and actually on a shelf. The last two
       *  differ when a row could not say which shelf it was ordered against. */
      ordered: o.requirements.reduce((n, r) => n + r.quantity, 0),
      onSlabs: o.requirements.reduce((n, r) => n + r.allocations.reduce((a, x) => a + x.allocatedQuantity, 0), 0),
      released: o.pieces.length,
      packed,
      credited: o.pieces.filter((p) => p.samplingIntakeId != null).length,
      lines: o.requirements.map((r) => ({
        id: r.id,
        label: r.pieceLabel,
        rowLetter: r.rowLetter,
        colour: r.colourFinish?.colour?.name ?? null,
        finish: r.colourFinish?.finish ?? null,
        sizeLabel: r.samplingSize
          ? sampleSizeLabel({
              lengthIn: Number(r.samplingSize.lengthIn),
              widthIn: Number(r.samplingSize.widthIn),
              thicknessMm: Number(r.samplingSize.thicknessMm),
            })
          : null,
        quantity: r.quantity,
        onSlabs: r.allocations.reduce((a, x) => a + x.allocatedQuantity, 0),
        released: r._count.pieces,
      })),
    };
  }));
}

export async function POST(req: NextRequest) {
  const g = await samplingGate("addStock");
  if (!g.ok) return deny(g.status);

  let body: { requestedFor?: unknown; note?: unknown; lines?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return bad("A sample request needs at least one line — a colour, a finish, a size and how many.");
  }
  const requestedFor = String(body.requestedFor ?? "").trim() || "Sampling";
  const note = String(body.note ?? "").trim() || null;

  // ---- RESOLVE EVERY LINE BEFORE WRITING ANYTHING ------------------------
  //
  // A request half-created is worse than none: the sampling desk would have to
  // work out which lines landed before it could trust the order. So each line is
  // resolved to a real shelf and a real size first, and any refusal comes back
  // naming the line — "line 3" is findable on a screen, "invalid input" is not.
  interface Resolved {
    colourFinishId: string;
    samplingSizeId: string;
    lengthIn: number;
    widthIn: number;
    thicknessMm: number;
    quantity: number;
    label: string;
  }
  const resolved: Resolved[] = [];
  let sizesCreated = 0;
  let finishesCreated = 0;

  for (const [i, raw] of (body.lines as LineInput[]).entries()) {
    const n = i + 1;
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return bad(`Line ${n}: how many pieces? It has to be a whole number, at least one.`);
    }

    // -- the shelf: colour + finish, created if this pairing is new ---------
    const colourId = String(raw?.colourId ?? "").trim();
    const finish = canonicalFinish(raw?.finish as string);
    if (!colourId) return bad(`Line ${n}: choose a colour.`);
    if (!finish) {
      return bad(`Line ${n}: "${String(raw?.finish ?? "")}" is not a finish. Use one of ${FINISHES.join(", ")}.`);
    }
    const colour = await prisma.productColour.findUnique({ where: { id: colourId }, select: { id: true, name: true } });
    if (!colour) return bad(`Line ${n}: that colour is not in the chart — reload the page.`);

    let cf = await prisma.productColourFinish.findUnique({
      where: { colourId_finish: { colourId: colour.id, finish } },
      select: { id: true },
    });
    if (!cf) {
      try {
        cf = await prisma.productColourFinish.create({ data: { colourId: colour.id, finish }, select: { id: true } });
        finishesCreated++;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        cf = await prisma.productColourFinish.findUnique({
          where: { colourId_finish: { colourId: colour.id, finish } },
          select: { id: true },
        });
      }
    }
    if (!cf) return Response.json({ error: `Line ${n}: could not save that finish — try again.` }, { status: 500 });

    // -- the size: an existing shelf size, or a typed one -------------------
    const pickedSizeId = String(raw?.sizeId ?? "").trim();
    let size: { id: string; lengthIn: number; widthIn: number; thicknessMm: number };

    if (pickedSizeId) {
      const row = await prisma.samplingSize.findUnique({
        where: { id: pickedSizeId },
        select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true },
      });
      if (!row) return bad(`Line ${n}: that size is no longer in the list — reload the page.`);
      size = {
        id: row.id,
        lengthIn: Number(row.lengthIn),
        widthIn: Number(row.widthIn),
        thicknessMm: Number(row.thicknessMm),
      };
    } else {
      // VERBATIM refusals — parseSampleSize owns the wording, and rewording it
      // here would mean two spellings of one rule.
      const parsed = parseSampleSize({
        length: raw?.length as string | number | null | undefined,
        width: raw?.width as string | number | null | undefined,
        thickness: raw?.thickness as string | number | null | undefined,
      });
      if (!parsed.ok) return bad(`Line ${n}: ${parsed.reason}`);
      const key = parsed.size;
      let row = await prisma.samplingSize.findUnique({
        where: { lengthIn_widthIn_thicknessMm: key },
        select: { id: true },
      });
      if (!row) {
        try {
          row = await prisma.samplingSize.create({
            data: { ...key, createdById: (g.user as { id?: string })?.id ?? null },
            select: { id: true },
          });
          sizesCreated++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          row = await prisma.samplingSize.findUnique({
            where: { lengthIn_widthIn_thicknessMm: key },
            select: { id: true },
          });
        }
      }
      if (!row) return Response.json({ error: `Line ${n}: could not save that size — try again.` }, { status: 500 });
      size = { id: row.id, ...key };
    }

    resolved.push({
      colourFinishId: cf.id,
      samplingSizeId: size.id,
      lengthIn: size.lengthIn,
      widthIn: size.widthIn,
      thicknessMm: size.thicknessMm,
      quantity,
      // THE LABEL IS THE SHELF, NOT THE SIZE. It used to end with
      // sampleSizeLabel(size) as well, and the supervisor's board then printed
      // "Cappuccino Dark Polished 11 x 11 in · 20 mm" in a column standing
      // directly beside the size column saying "11 × 11 in". The row carries
      // its length, width and thickness as their own fields and its size as a
      // foreign key; a label that repeats all three is three chances for the
      // screen to contradict itself.
      //
      // Colour and finish stay, because a sample order's rows really do differ
      // by them and no board has a column for either.
      label: `${colour.name} ${finish}`,
    });
  }

  // ---- ONE ORDER, ONE TRANSACTION ----------------------------------------
  const routing = sampleRouting();

  const created = await prisma.$transaction(async (tx) => {
    // The next SR- number, read inside the transaction so two desks raising a
    // request at the same moment cannot both be handed it. Reads the MAXIMUM
    // rather than counting: a deleted order's number is spent, because piece
    // codes carrying it may still be written on stone.
    const existing = await tx.fabProject.findMany({
      where: { kind: "SAMPLE" },
      select: { projectCode: true },
    });
    const projectCode = nextSampleOrderCode(existing.map((p) => p.projectCode));

    const project = await tx.fabProject.create({
      data: {
        projectCode,
        kind: "SAMPLE",
        customerName: requestedFor,
        remarks: note,
        numberOfPieces: resolved.reduce((n, r) => n + r.quantity, 0),
      },
      select: { id: true, projectCode: true },
    });

    // Letters for the whole request in one call — a loop of nextRowLetter would
    // read a list it has not written yet and hand two lines the same letter.
    const letters = assignRowLetters([], resolved.length);

    for (const [i, line] of resolved.entries()) {
      const sq = rowSqft(line.lengthIn, line.widthIn, line.quantity);
      await tx.fabRequirement.create({
        data: {
          projectId: project.id,
          // No poId: a sample order has no purchase order behind it, which is
          // the whole difference between the two kinds.
          colourFinishId: line.colourFinishId,
          samplingSizeId: line.samplingSizeId,
          // REQUIRED BY THE COLUMN, not by anything that reads it. slab_code is
          // NOT NULL with no default; omitting it made every sample request die
          // with a database error naming no field. The supervisor's allocation
          // is what actually says which slab this row is cut from.
          slabCode: SAMPLE_REQUIREMENT_SLAB_CODE,
          pieceLabel: line.label,
          rowLetter: letters[i] ?? null,
          length: line.lengthIn,
          width: line.widthIn,
          thickness: line.thicknessMm,
          quantity: line.quantity,
          sqftPerPiece: sq.sqftPerPiece,
          totalSqft: sq.totalSqft,
          // NEVER A SINK. sink_quantity stays 0 rather than null: on a sample it
          // is not an unanswered question, it is answered by what a sample is.
          sinkQuantity: 0,
          sinkRequired: routing.sinkRequired,
          fabricationRequired: routing.fabricationRequired,
          polishRequired: routing.polishRequired,
        },
      });
    }

    return project;
  });

  return Response.json({
    success: true,
    id: created.id,
    code: created.projectCode,
    lines: resolved.length,
    pieces: resolved.reduce((n, r) => n + r.quantity, 0),
    /** "It is now an option for everyone" is the consequence of typing a new
     *  size or picking a new finish, and the person who did it is the only one
     *  who can still catch a typo. */
    sizesCreated,
    finishesCreated,
    message:
      `${created.projectCode} raised — ${resolved.length} line${resolved.length === 1 ? "" : "s"}, ` +
      `${resolved.reduce((n, r) => n + r.quantity, 0)} pieces. ` +
      `The supervisor picks slabs for it on his own board.`,
  }, { status: 201 });
}
