// POST /api/fab/supervisor/finished-edges
// Body: { requirementId: string, edges: string[] | null }
//
// WHICH EDGES OF A ROW'S PIECES ARE POLISHED — the thing edge work is charged
// for. The owner: "same row all have same, so let it be — we show them a
// graphical piece, they choose sides, and feet is calculated and paid."
//
// PER ORDERED ROW, NOT PER PIECE, and not per slab. Every piece of row A is the
// same size and gets the same treatment, so one picker per row is enough; and a
// row split across five slabs is ONE decision, which is why this writes
// fab_requirement and not the allocation.
//
// THIS IS THE SUPERVISOR'S DECISION, and now the only one he makes on that card.
// The sink count beside it moved to the purchase order — it settles WHICH pieces
// exist, which is an order-taking question. Which edges get polished is a
// shop-floor one, and it stays with the man holding the slab.
//
// NO SAVE BUTTON. Each click fires this. If it returns 200 the decision is in
// the database; if it does not, the picker puts the edge back and says so.
//
// ─────────────────────────────────────────── NULL IS NOT AN EMPTY LIST ──────
//   null   nobody has chosen yet          -> finished_edges IS NULL
//   []     he looked and said no edges    -> finished_edges = ''
//
// They cost the same today — zero either way — and they are still different
// facts, which is why scripts/0055 made the column nullable. A project showing
// ₹0 of edge work because nobody has been asked is a question; the same ₹0
// because the customer wanted raw edges is an answer. The CEO board reports
// them differently and cannot if this route flattens them here.
//
// ─────────────────────────────────────────── WHY RAW SQL ────────────────────
// finished_edges arrived in scripts/0055, and a deploy whose Prisma client was
// generated before it will not have the field — the same reason the CEO route
// reads this column raw. A typed update would fail at build or at runtime
// depending on which is staler; this works either way, and the CHECK constraint
// on the column is the second door behind serializeEdges.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { EDGES, serializeEdges, describeEdges, type Edge, type EdgeSelection } from "@/lib/fab/pricing";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let body: { requirementId?: string; edges?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const requirementId = String(body.requirementId ?? "").trim();
  if (!requirementId) return Response.json({ error: "requirementId required" }, { status: 400 });

  const requirement = await prisma.fabRequirement.findUnique({
    where: { id: requirementId },
    select: { id: true, quantity: true, sinkQuantity: true, pieceLabel: true },
  });
  if (!requirement) {
    return Response.json(
      { error: "That piece row no longer exists — refresh the board and look again." },
      { status: 404 },
    );
  }

  // ---- ONLY A ROW THAT REACHES FABRICATION ---------------------------------
  //
  // "This part is only for the sink cut pieces — the fabrication, pieces only
  // which can come to fabrication." deriveRoutingFlags is the one place that
  // rule is written down (fabricationRequired = sinkRequired), so it is asked
  // rather than re-spelt here.
  //
  // The picker never offers this row, so a request for one means the screen is
  // stale — someone cleared the sinks in another tab. Refused rather than
  // stored: an edge selection sitting on a row that never reaches the
  // fabricator is a charge waiting to be made for work nobody will do.
  const { fabricationRequired } = deriveRoutingFlags(requirement);
  if (!fabricationRequired && body.edges !== null && body.edges !== undefined) {
    return Response.json(
      {
        error:
          `Row ${requirement.pieceLabel ?? "this row"} has no sinks, so it does not go to ` +
          `fabrication and its edges are not charged. Set a sink count in step 3 first — ` +
          `or refresh, if somebody has just cleared it.`,
      },
      { status: 409 },
    );
  }

  // ---- what to store -------------------------------------------------------
  let stored: string | null;
  if (body.edges === null || body.edges === undefined) {
    stored = null;                                   // back to "not chosen"
  } else {
    if (!Array.isArray(body.edges)) {
      return Response.json({ error: "edges must be an array of edge names, or null." }, { status: 400 });
    }
    // REFUSED, NOT DROPPED. serializeEdges silently ignores a word it does not
    // know, which is right for rendering a stored value and wrong here: a
    // client sending "top" has a bug, and answering "saved" while storing
    // nothing hides it until somebody notices the money is short.
    const wanted = body.edges.map((e) => String(e).trim().toLowerCase());
    const unknown = wanted.filter((e) => !(EDGES as readonly string[]).includes(e));
    if (unknown.length) {
      return Response.json(
        { error: `Not an edge: ${unknown.join(", ")}. Use ${EDGES.join(", ")}.` },
        { status: 400 },
      );
    }
    const selection: EdgeSelection = {};
    for (const e of wanted) selection[e as Edge] = true;
    stored = serializeEdges(selection);              // canonical order, deduped
  }

  await prisma.$executeRaw`
    UPDATE fab_requirement SET finished_edges = ${stored} WHERE id = ${requirementId}
  `;

  return Response.json({
    success: true,
    requirementId,
    /** The canonical string as stored — the picker believes this rather than
     *  what it sent, the same way SinkBoard believes the clamped quantity. */
    finishedEdges: stored,
    /** "All four" / "Front + left" / "None", for a confirmation line. */
    label: stored === null ? "Not chosen" : describeEdges(
      Object.fromEntries(stored.split(",").filter(Boolean).map((e) => [e, true])),
    ),
  });
}
