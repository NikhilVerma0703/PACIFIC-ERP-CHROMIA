// POST /api/fab/manager/pos/rows/[id]/sink
// Body: { sinkQuantity: number }
//
// THE SINK DECISION, AT THE ORDER. The owner: "on selecting the pieces with sink
// or not should be a bit earlier, because with sink and without sink can be
// separate a step ahead, while adding the PO itself right? So you get new rows
// as well — now same size and thickness and colour but a different row due to
// sink present or no. Default is full."
//
// So this endpoint does what the supervisor's sink board does, ONE STEP EARLIER
// and with one addition: a PARTIAL SPLITS THE ROW IN TWO. After it runs, every
// row is homogeneous — one size, one thickness, one routing — which is what
// makes a row letter genuinely name a kind of piece.
//
// THE WHOLE RULE LIVES IN lib/fab/sinkSplit.ts, which imports nothing and is
// covered by tests/fabSinkSplit.test.ts. This route reads the row, asks it what
// to do, and writes. It decides nothing itself — the manager screen calls the
// same planner to grey out a button before the request is even made, and the
// two must not be able to disagree about what is allowed.
//
// ─────────────────────────────────── THE PIECE COUNT DOES NOT MOVE ──────────
// A split preserves the row's total quantity: 60 becomes 40 + 20. So
// fab_project.number_of_pieces is NOT touched — unlike add-row and delete-row,
// which do move it. Incrementing here would inflate every project that has ever
// had a row split.
//
// ─────────────────────────────────── AND THE NEW ROW NEEDS A LETTER ─────────
// Read FOR UPDATE inside the transaction, exactly as the add-row route does:
// two managers splitting rows of the same project at the same moment must not
// both be handed the same letter. Two rows sharing a letter is not a cosmetic
// problem — the piece codes built from it collide on a UNIQUE column and the
// send to cutting fails.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import { rowSqft } from "@/lib/fab/requirementRow";
import { nextRowLetter, rowLabel } from "@/lib/fab/pieceNaming";
import { planSinkSplit, describeSinkSplit } from "@/lib/fab/sinkSplit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { id } = await params;
  let body: { sinkQuantity?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const existing = await prisma.fabRequirement.findUnique({
    where: { id },
    select: {
      id: true, projectId: true, poId: true,
      pieceLabel: true, rowLetter: true,
      length: true, width: true, thickness: true,
      quantity: true, sinkQuantity: true, notes: true, slabCode: true,
      allocations: { select: { allocatedQuantity: true } },
      _count: { select: { pieces: true } },
      po: { select: { pdfImportedAt: true } },
    },
  });
  if (!existing?.poId) return Response.json({ error: "That row no longer exists." }, { status: 404 });
  if (!existing.po?.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then decide sinks." }, { status: 409 });
  }

  const label = rowLabel(existing.rowLetter, existing.pieceLabel);
  const plan = planSinkSplit({
    quantity: existing.quantity,
    currentSinkQuantity: existing.sinkQuantity,
    wantSinkQuantity: body.sinkQuantity as number,
    allocatedQuantity: existing.allocations.reduce((s, a) => s + a.allocatedQuantity, 0),
    releasedPieces: existing._count.pieces,
  });

  // 409, not 400: nothing is malformed. The row is in a state that refuses this,
  // and the reason says which state and what to do about it.
  if (!plan.ok) return Response.json({ error: plan.reason }, { status: 409 });

  // Already true. No write, and no pretending one happened.
  if (plan.action === "none") {
    return Response.json({
      success: true, changed: false,
      message: describeSinkSplit(plan, label),
    });
  }

  // ---- the whole row, one way or the other ---------------------------------
  if (plan.action === "mark") {
    const flags = deriveRoutingFlags({ sinkQuantity: plan.sinkQuantity, quantity: existing.quantity });
    await prisma.fabRequirement.update({
      where: { id },
      data: {
        sinkQuantity: plan.sinkQuantity,
        sinkRequired: flags.sinkRequired,
        fabricationRequired: flags.fabricationRequired,
        polishRequired: flags.polishRequired,
      },
    });
    return Response.json({
      success: true, changed: true, split: false,
      message: describeSinkSplit(plan, label),
    });
  }

  // ---- a real split --------------------------------------------------------
  const lengthIn = existing.length ?? 0;
  const widthIn = existing.width ?? 0;
  const keepSq = rowSqft(lengthIn, widthIn, plan.keep.quantity);
  const createSq = rowSqft(lengthIn, widthIn, plan.create.quantity);
  const keepFlags = deriveRoutingFlags({ sinkQuantity: plan.keep.sinkQuantity, quantity: plan.keep.quantity });
  const createFlags = deriveRoutingFlags({ sinkQuantity: plan.create.sinkQuantity, quantity: plan.create.quantity });

  const result = await prisma.$transaction(async (tx) => {
    // A LETTER FOR THE NEW ROW, read inside the transaction. See the header.
    let taken: string[] = [];
    try {
      const used = await tx.$queryRaw<Array<{ row_letter: string | null }>>`
        SELECT row_letter FROM fab_requirement
        WHERE project_id = ${existing.projectId} AND row_letter IS NOT NULL
        FOR UPDATE
      `;
      taken = used.map((u) => u.row_letter).filter((l): l is string => !!l);
    } catch {
      taken = [];   // scripts/0054 not applied — the new row keeps a label only
    }
    const letter = taken.length ? nextRowLetter(taken) : null;

    await tx.fabRequirement.update({
      where: { id },
      data: {
        quantity: plan.keep.quantity,
        sinkQuantity: plan.keep.sinkQuantity,
        sqftPerPiece: keepSq.sqftPerPiece,
        totalSqft: keepSq.totalSqft,
        sinkRequired: keepFlags.sinkRequired,
        fabricationRequired: keepFlags.fabricationRequired,
        polishRequired: keepFlags.polishRequired,
      },
    });

    const created = await tx.fabRequirement.create({
      data: {
        projectId: existing.projectId,
        poId: existing.poId,
        // The size, the stone and the note come across UNCHANGED — the two rows
        // differ in exactly one thing, and that is the point of the split.
        length: existing.length,
        width: existing.width,
        thickness: existing.thickness,
        slabCode: existing.slabCode,
        notes: existing.notes,
        // SUFFIXED so the two are never ambiguous on a screen that has no
        // letters — a database without scripts/0054 would otherwise show two
        // rows both reading "Row 3".
        pieceLabel: existing.pieceLabel
          ? `${existing.pieceLabel} (${plan.create.side === "sink" ? "sink" : "plain"})`
          : null,
        rowLetter: letter,
        quantity: plan.create.quantity,
        sinkQuantity: plan.create.sinkQuantity,
        sqftPerPiece: createSq.sqftPerPiece,
        totalSqft: createSq.totalSqft,
        sinkRequired: createFlags.sinkRequired,
        fabricationRequired: createFlags.fabricationRequired,
        polishRequired: createFlags.polishRequired,
        // finished_edges is deliberately NOT copied. Nobody has chosen the new
        // row's edges — and a plain row never reaches fabrication, so there is
        // nothing to choose. NULL is the honest value.
      },
      select: { id: true, rowLetter: true, pieceLabel: true, quantity: true, sinkQuantity: true },
    });

    // fab_project.number_of_pieces is NOT touched. 60 became 40 + 20; the
    // project still has 60. See the header.
    return created;
  });

  return Response.json({
    success: true,
    changed: true,
    split: true,
    message: describeSinkSplit(plan, label),
    keep: { id: existing.id, quantity: plan.keep.quantity, sinkQuantity: plan.keep.sinkQuantity },
    created: {
      id: result.id,
      rowLetter: result.rowLetter,
      pieceLabel: result.pieceLabel,
      quantity: result.quantity,
      sinkQuantity: result.sinkQuantity,
    },
  }, { status: 201 });
}
