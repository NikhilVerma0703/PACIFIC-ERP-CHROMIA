// POST /api/fab/supervisor/sink-quantity
// Body: { requirementId: string, sinkQuantity: number }
//
// One move of the sink board. There is no save button and there is no batch:
// the supervisor clicks a row, or drags it, and this fires. That is the whole
// contract — if it returns 200 the decision is in the database, and if it does
// not, the board puts the row back where it was and says so.
//
// WHAT IT WRITES. fab_requirement.sink_quantity, and nothing else. It never
// touches sink_required / fabrication_required / polish_required: those are
// DERIVED at release time by deriveRoutingFlags, which reads sink_quantity and
// makes polish unconditional. Writing them here would create a second copy of a
// decision that is already recorded, and the two would disagree the moment
// somebody changed one.
//
// CLAMPED SERVER-SIDE. The board is the only caller today, but "the tablet
// checked" is not a constraint. planSinkAssignment refuses a count above the
// ordered quantity outright — a supervisor typing 12 into a row of 10 has
// misread something, and answering "saved" while storing 10 tells him he got
// what he asked for — and resolveSinkQuantity, which the release path reads the
// value back with, has the last word on what actually lands in the column.

// ═════════════════════════════════════════════════════════════════════════════
// RETIRED 2026-08-25. THE SUPERVISOR NO LONGER DECIDES SINKS.
//
// The owner: "remove this decision from the supervisor itself about sink. If he
// wants to change he can edit them manually, because having this and that
// changes the complete flow."
//
// The sink count is now set ONCE, on the purchase order —
// POST /api/fab/manager/pos/rows/[id]/sink — where a partial SPLITS the row in
// two so that every row downstream is one size, one thickness, one routing.
// This endpoint could set a partial WITHOUT splitting, which would quietly
// re-create the mixed row that change exists to remove.
//
// IT ANSWERS RATHER THAN 404s. A supervisor with yesterday's tab open still has
// the old board rendered in front of him; a 404 tells him the system is broken,
// and a silent success would tell him a lie. 410 Gone, with the sentence that
// says where the decision lives now.
//
// The original handler is preserved below the guard, per house convention.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { planSinkAssignment } from "@/lib/fab/sinkBoard";
import { resolveSinkQuantity } from "@/lib/fab/requirement-derive";

export async function POST(_req: NextRequest) {
  // The gate still runs first, so this says nothing about a project to somebody
  // who may not sign in at all.
  const gate = await fabGate("SUPERVISOR");
  if (!gate.ok) {
    return Response.json(
      { error: gate.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: gate.status },
    );
  }
  return Response.json(
    {
      error:
        "Sinks are no longer set here. They are decided on the purchase order, where splitting " +
        "a row separates the pieces with sinks from the ones without. Ask the manager to change " +
        "it on the project's PO rows — then reload this page.",
    },
    { status: 410 },
  );
}

/* THE ORIGINAL HANDLER, kept for reference.

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let body: { requirementId?: string; sinkQuantity?: number | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const requirementId = String(body.requirementId ?? "").trim();
  if (!requirementId) return Response.json({ error: "requirementId required" }, { status: 400 });

  const requirement = await prisma.fabRequirement.findUnique({
    where: { id: requirementId },
    select: { id: true, quantity: true, projectId: true },
  });
  if (!requirement) {
    return Response.json(
      { error: "That piece row no longer exists — refresh the board and look again." },
      { status: 404 },
    );
  }

  // AN EXPLICIT NULL CLEARS THE DECISION, and is not the same request as 0.
  // It is what Undo sends when it is putting back a row the supervisor had
  // never touched: 0 would record "he looked and said no sinks" about a row he
  // has not looked at. They route identically, so nothing downstream changes —
  // but the column exists to hold that difference and undo must be able to
  // restore it, or the first move of a session is not reversible.
  if (body.sinkQuantity === null) {
    await prisma.fabRequirement.update({ where: { id: requirementId }, data: { sinkQuantity: null } });
    return Response.json({
      success: true,
      requirementId,
      quantity: requirement.quantity,
      sinkQuantity: null,
    });
  }

  const plan = planSinkAssignment({ requested: body.sinkQuantity, orderedQuantity: requirement.quantity });
  if (!plan.ok) return Response.json({ error: plan.error }, { status: 400 });

  // resolveSinkQuantity is the authority on a stored sink count — the same
  // function release-project reads it back with. Belt and braces: plan.ok
  // already guarantees 0..quantity, so this is identity, and it stays here so
  // that if the two ever disagree the DATABASE ends up holding what release
  // will act on rather than what the board hoped for.
  const sinkQuantity = resolveSinkQuantity(plan.sinkQuantity, requirement.quantity);

  const updated = await prisma.fabRequirement.update({
    where: { id: requirementId },
    data: { sinkQuantity },
    select: { id: true, quantity: true, sinkQuantity: true },
  });

  return Response.json({
    success: true,
    requirementId: updated.id,
    quantity: updated.quantity,
    sinkQuantity: updated.sinkQuantity,
  });
}

*/

// Imports kept live so the commented handler above still reads as code rather
// than as prose, and so restoring it is one block move. Referenced here to keep
// the linter honest about that being deliberate.
void prisma; void planSinkAssignment; void resolveSinkQuantity;
