// POST /api/fab/manager/pos/[poId]/sinks/commit
// Body: { rows: Array<{ id: string; sinkQuantity: number }> }
//
// THE MANAGER'S WHOLE SINK BREAKDOWN, SAVED IN ONE GO.
//
// The owner: "it should be like manager do these things and then save to send to
// supervisor."
//
// The board used to write on every click, which meant a SPLIT CREATED A ROW THE
// MOMENT IT WAS TYPED. Dragging that row back to "no sink" only marked it plain
// — it did not go home — so row C of 60, split into 40 + 20 and then thought
// better of, stayed two plain rows of 40 and 20 where the order has one row of
// 60. Every hesitation left litter behind.
//
// Now nothing is written until this runs. The manager works the board, the
// screen shows what the save WILL do, and a row that was never created cannot be
// left behind.
//
// ─────────────────────────────────── ONE TRANSACTION, ALL OR NOTHING ────────
// Half a breakdown saved is worse than none: the manager would have to work out
// which of his twelve decisions landed before he could trust any of them. So one
// bad row fails the lot, and the message names the row.
//
// ─────────────────────────────────── THE RULES ARE NOT RESTATED HERE ────────
// planSinkSplit decides mark-vs-split and every refusal, the same module the
// board draws its preview from. If the two could disagree, the manager would
// press Save on a board that promised something the server then refused.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import { rowSqft } from "@/lib/fab/requirementRow";
import { nextRowLetter, rowLabel } from "@/lib/fab/pieceNaming";
import { planSinkSplit } from "@/lib/fab/sinkSplit";

interface Wanted { id: string; sinkQuantity: number }

/** The row shape this route needs, named rather than inferred: `rows` comes back
 *  untyped whenever the Prisma client is stale, and an inferred element type
 *  collapses to {} — so every field below fails to compile over a column that is
 *  plainly in the select. Saying it once fixes it and documents the query. */
interface CommitRow {
  id: string;
  pieceLabel: string | null;
  rowLetter: string | null;
  length: number | null;
  width: number | null;
  thickness: number | null;
  slabCode: string | null;
  notes: string | null;
  quantity: number;
  sinkQuantity: number | null;
  allocations: Array<{ allocatedQuantity: number }>;
  _count: { pieces: number };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ poId: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { poId } = await params;
  let body: { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return Response.json({ error: "rows must be an array." }, { status: 400 });
  }
  const wanted: Wanted[] = body.rows.map((r) => ({
    id: String((r as Wanted)?.id ?? "").trim(),
    sinkQuantity: (r as Wanted)?.sinkQuantity as number,
  }));
  if (wanted.some((w) => !w.id)) {
    return Response.json({ error: "Every row needs an id." }, { status: 400 });
  }
  if (wanted.length === 0) {
    return Response.json({ success: true, marked: 0, split: 0, message: "Nothing to save." });
  }

  const po = await prisma.fabPo.findUnique({
    where: { id: poId },
    select: { id: true, projectId: true, pdfImportedAt: true },
  });
  if (!po) return Response.json({ error: "That purchase order no longer exists." }, { status: 404 });
  if (!po.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then decide sinks." }, { status: 409 });
  }

  const rows: CommitRow[] = await prisma.fabRequirement.findMany({
    where: { id: { in: wanted.map((w) => w.id) }, poId: po.id },
    select: {
      id: true, pieceLabel: true, rowLetter: true,
      length: true, width: true, thickness: true, slabCode: true, notes: true,
      quantity: true, sinkQuantity: true,
      allocations: { select: { allocatedQuantity: true } },
      _count: { select: { pieces: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = wanted.filter((w) => !byId.has(w.id));
  if (missing.length) {
    return Response.json(
      { error: "Some of those rows have changed since you loaded the board — reload and try again." },
      { status: 409 },
    );
  }

  // ---- PLAN EVERYTHING FIRST, so a refusal costs nothing ------------------
  //
  // Every row is checked before any row is written. A plan that fails halfway
  // through the writes would leave the PO in a state the manager never chose.
  const planned: Array<{ row: CommitRow; plan: ReturnType<typeof planSinkSplit> }> = [];
  for (const w of wanted) {
    const row = byId.get(w.id)!;
    const plan = planSinkSplit({
      quantity: row.quantity,
      currentSinkQuantity: row.sinkQuantity,
      wantSinkQuantity: w.sinkQuantity,
      allocatedQuantity: row.allocations.reduce((s, a) => s + a.allocatedQuantity, 0),
      releasedPieces: row._count.pieces,
    });
    if (!plan.ok) {
      return Response.json(
        { error: `${rowLabel(row.rowLetter, row.pieceLabel)}: ${plan.reason}`, rowId: row.id },
        { status: 409 },
      );
    }
    planned.push({ row, plan });
  }

  const result = await prisma.$transaction(async (tx) => {
    // ALL THE LETTERS ONCE, up front and FOR UPDATE — the same guard the add-row
    // route uses. Handing them out from a list read inside the transaction is
    // what stops two managers saving at the same moment and being given the same
    // letter, which would collide the piece codes built from it.
    let taken: string[] = [];
    try {
      const used = await tx.$queryRaw<Array<{ row_letter: string | null }>>`
        SELECT row_letter FROM fab_requirement
        WHERE project_id = ${po.projectId} AND row_letter IS NOT NULL
        FOR UPDATE
      `;
      taken = used.map((u) => u.row_letter).filter((l): l is string => !!l);
    } catch {
      taken = [];   // scripts/0054 not applied — new rows keep a label only
    }
    const hasLetters = taken.length > 0;

    let marked = 0;
    let split = 0;
    const created: Array<{ id: string; rowLetter: string | null; quantity: number }> = [];

    for (const { row, plan } of planned) {
      if (!plan.ok || plan.action === "none") continue;

      if (plan.action === "mark") {
        const flags = deriveRoutingFlags({ sinkQuantity: plan.sinkQuantity, quantity: row.quantity });
        await tx.fabRequirement.update({
          where: { id: row.id },
          data: {
            sinkQuantity: plan.sinkQuantity,
            sinkRequired: flags.sinkRequired,
            fabricationRequired: flags.fabricationRequired,
            polishRequired: flags.polishRequired,
          },
        });
        marked++;
        continue;
      }

      const keepSq = rowSqft(row.length ?? 0, row.width ?? 0, plan.keep.quantity);
      const makeSq = rowSqft(row.length ?? 0, row.width ?? 0, plan.create.quantity);
      const keepFlags = deriveRoutingFlags({ sinkQuantity: plan.keep.sinkQuantity, quantity: plan.keep.quantity });
      const makeFlags = deriveRoutingFlags({ sinkQuantity: plan.create.sinkQuantity, quantity: plan.create.quantity });

      await tx.fabRequirement.update({
        where: { id: row.id },
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

      // Taken from the running list, not re-read — two splits in one save must
      // not both be handed the same letter.
      const letter = hasLetters ? nextRowLetter(taken) : null;
      if (letter) taken.push(letter);

      const made = await tx.fabRequirement.create({
        data: {
          projectId: po.projectId,
          poId: po.id,
          length: row.length,
          width: row.width,
          thickness: row.thickness,
          slabCode: row.slabCode,
          notes: row.notes,
          pieceLabel: row.pieceLabel
            ? `${row.pieceLabel} (${plan.create.side === "sink" ? "sink" : "plain"})`
            : null,
          rowLetter: letter,
          quantity: plan.create.quantity,
          sinkQuantity: plan.create.sinkQuantity,
          sqftPerPiece: makeSq.sqftPerPiece,
          totalSqft: makeSq.totalSqft,
          sinkRequired: makeFlags.sinkRequired,
          fabricationRequired: makeFlags.fabricationRequired,
          polishRequired: makeFlags.polishRequired,
        },
        select: { id: true, rowLetter: true, quantity: true },
      });
      created.push(made);
      split++;
    }

    // fab_project.number_of_pieces is NOT touched. A split preserves the row's
    // total — 60 becomes 40 + 20 — and a mark moves no quantity at all.
    return { marked, split, created };
  });

  const bits: string[] = [];
  if (result.marked) bits.push(`${result.marked} row${result.marked === 1 ? "" : "s"} set`);
  if (result.split) bits.push(`${result.split} split in two`);

  return Response.json({
    success: true,
    marked: result.marked,
    split: result.split,
    created: result.created,
    message: bits.length ? `Saved — ${bits.join(", ")}.` : "Nothing had changed.",
  });
}
