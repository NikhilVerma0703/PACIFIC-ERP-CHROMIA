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

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { planSinkAssignment } from "@/lib/fab/sinkBoard";
import { resolveSinkQuantity } from "@/lib/fab/requirement-derive";

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
