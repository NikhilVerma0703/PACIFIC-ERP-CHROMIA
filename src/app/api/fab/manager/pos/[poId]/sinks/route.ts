// POST /api/fab/manager/pos/[poId]/sinks
// Body: { target: "plain" | "sink", scope?: "undecided" | "all" }
//
// EVERY ROW ON THIS PO, ONE WAY, IN ONE REQUEST.
//
// The owner: "current model feels so heavy work to do — make it easy for apply
// and splitting the sink and non sink."
//
// He was right. A 28-row PO meant 28 requests before anything could move, and on
// a real order most rows are plain and a handful have sinks. The deciding was
// never the work; the clicking was. So: one button clears the backlog, and the
// manager only touches the exceptions.
//
// ─────────────────────────────────── IT NEVER SPLITS ────────────────────────
// A bulk action marks WHOLE ROWS and nothing else. "All plain" on 28 rows must
// not invent 28 more — a split is a deliberate, per-row act with a sentence
// beside it, and doing it in bulk would leave a manager with a PO twice the size
// he was looking at. rowsForBulkSink picks the rows and every one of them plans
// to a `mark`, which tests/fabSinkSplit.test.ts holds to.
//
// ─────────────────────────────────── SCOPE, AND WHY "undecided" IS DEFAULT ──
//   undecided   only rows nobody has answered for. The safe one, and the one
//               reached for after a PDF import: it cannot undo a decision the
//               manager has already made.
//   all         everything not locked, including rows already marked the other
//               way. Blunt, and asked for explicitly.
//
// A ROW ALREADY ON THE CUTTER IS NEVER TOUCHED, whatever the scope: its pieces
// exist and carry its code. Those are counted and reported, not silently
// skipped — "18 rows set, 2 already on the cutter" is a different message from
// "18 rows set", and only one of them is true.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import {
  rowsForBulkSink, tallySinkDecisions,
  type SinkSide, type SinkDecisionRow,
} from "@/lib/fab/sinkSplit";

function isSide(v: unknown): v is SinkSide {
  return v === "plain" || v === "sink";
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
  let body: { target?: unknown; scope?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!isSide(body.target)) {
    return Response.json({ error: `target must be "plain" or "sink".` }, { status: 400 });
  }
  const target = body.target;
  const scope = body.scope === "all" ? "all" : "undecided";

  const po = await prisma.fabPo.findUnique({
    where: { id: poId },
    select: { id: true, pdfImportedAt: true },
  });
  if (!po) return Response.json({ error: "That purchase order no longer exists." }, { status: 404 });
  if (!po.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then decide sinks." }, { status: 409 });
  }

  const rows = await prisma.fabRequirement.findMany({
    where: { poId: po.id },
    select: { id: true, quantity: true, sinkQuantity: true, _count: { select: { pieces: true } } },
  });

  // ANNOTATED, NOT INFERRED. `rows` comes back untyped whenever the Prisma
  // client is stale, which makes this array `any[]`, which makes
  // rowsForBulkSink's generic fall back to its constraint — and then `p.id` does
  // not exist on the far side of it. Naming the shape once pins the generic and
  // documents what the planner is being handed.
  const shaped: Array<SinkDecisionRow & { id: string }> = rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    sinkQuantity: r.sinkQuantity,
    locked: r._count.pieces > 0,
  }));

  const before = tallySinkDecisions(shaped);
  const picked = rowsForBulkSink(shaped, target, scope);

  if (picked.length === 0) {
    return Response.json({
      success: true,
      changed: 0,
      lockedSkipped: before.locked,
      message:
        before.locked > 0 && before.changeable === 0
          ? `Nothing to change — the rows that are left are already on the cutter.`
          : `Every row is already ${target === "sink" ? "marked with a sink" : "plain"}.`,
    });
  }

  // ONE TRANSACTION. Half a PO marked is worse than none: the manager would have
  // to work out which rows landed before he could trust any of them.
  //
  // Grouped into two updateMany calls rather than one per row — the routing flags
  // are derived from the sink count, and inside a single target every picked row
  // gets the SAME count relative to its own quantity... except that "all sink"
  // means quantity, which differs per row. So sink rows are written one by one
  // (each needs its own quantity) and plain rows in a single sweep.
  const flagsPlain = deriveRoutingFlags({ sinkQuantity: 0 });

  const changed = await prisma.$transaction(async (tx) => {
    if (target === "plain") {
      const res = await tx.fabRequirement.updateMany({
        where: { id: { in: picked.map((p) => p.id) } },
        data: {
          sinkQuantity: 0,
          sinkRequired: flagsPlain.sinkRequired,
          fabricationRequired: flagsPlain.fabricationRequired,
          polishRequired: flagsPlain.polishRequired,
        },
      });
      return res.count;
    }
    let n = 0;
    for (const p of picked) {
      // sink_quantity = the row's OWN quantity, so the row stays homogeneous.
      const flags = deriveRoutingFlags({ sinkQuantity: p.quantity, quantity: p.quantity });
      await tx.fabRequirement.update({
        where: { id: p.id },
        data: {
          sinkQuantity: p.quantity,
          sinkRequired: flags.sinkRequired,
          fabricationRequired: flags.fabricationRequired,
          polishRequired: flags.polishRequired,
        },
      });
      n++;
    }
    return n;
  });

  const lockedSkipped = scope === "all" ? before.locked : shaped.filter((r) => r.locked && r.sinkQuantity == null).length;

  return Response.json({
    success: true,
    changed,
    lockedSkipped,
    message:
      `${changed} row${changed === 1 ? "" : "s"} set to ${target === "sink" ? "sink" : "plain"}` +
      (lockedSkipped > 0
        ? `. ${lockedSkipped} left alone — already on the cutter.`
        : `.`),
  });
}
