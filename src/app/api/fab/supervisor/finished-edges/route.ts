// POST /api/fab/supervisor/finished-edges
// Body: { requirementId: string, edges: string[] | null }
//
// WHICH EDGES OF A ROW'S PIECES ARE HAND POLISHED — the thing edge work is
// charged for. The owner: "same row all have same, so let it be — we show them
// a graphical piece, they choose sides, and feet is calculated and paid."
//
// PER ORDERED ROW, NOT PER PIECE, and not per slab. Every piece of row A is the
// same size and gets the same treatment, so one picker per row is enough; and a
// row split across five slabs is ONE decision, which is why this writes
// fab_requirement and not the allocation.
//
// ─────────────────────────────────── WHO DECIDES ────────────────────────────
// The owner, widening this: "any pieces can be assigned the edge hand polish or
// not — this is chosen and done by supervisor, OR ELSE the one manager who
// uploads the PO."
//
// The gate already allows both and needed no widening: fabGate takes a MINIMUM
// tier, and MANAGER outranks SUPERVISOR. What changed is that there is now a
// second screen calling it — the manager settles edges on the order beside the
// sink, which is where a customer's "and polish the front edge" actually
// arrives, while the supervisor still settles them on the slab card.
//
// SAME ROUTE, SAME COLUMN, SAME CANONICAL STRING. Two doors into one decision,
// so the two screens cannot come to hold different answers for one row.
//
// ─────────────────────────── NOT THE SINK'S HANGER-ON ANY MORE ──────────────
// This route used to REFUSE a row with no sinks, with a 409 explaining that
// edge work was fabrication work and fabrication followed the sink. That gate
// is gone: hand edge polish is its own job on any row, and the refusal was
// blocking real work — a plain row whose front edge the customer wants polished
// could not be marked at all. See lib/fab/pricing.ts for the money side.
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
import {
  ROUND_EDGE, EDGE_FACES, PIECE_SHAPES,
  isRound, parseShape, parseEdgeFace, describeEdgeFace,
} from "@/lib/fab/shape";

/**
 * MOVE THE PIECES TO MATCH THE ROW.
 *
 * A row's edge decision can change after its pieces have been released — the
 * customer rings up, or a shape change clears the selection — and the stamp on
 * those pieces has to follow, or the hand bench works from a queue that
 * disagrees with the order it is billed from.
 *
 * Under the group rule the row's answer IS every piece's answer, so this is one
 * UPDATE rather than a decision per piece.
 *
 * PACKAGED AND REJECTED PIECES ARE LEFT ALONE. A packed piece has been charged
 * for on the CEO's period card on the day it was packed; restamping it would
 * move historical money. Re-cutting is the way to change a piece that has left.
 *
 * BEST EFFORT: the column arrives in scripts/0063, and a deploy running ahead of
 * the migration must still be able to save the row itself. The ROW is the source
 * of truth for the money (pricing reads finished_edges, not the stamp), so a
 * failure here costs the queue a refresh, not a rupee. Null says "not known",
 * which is different from 0.
 */
async function stampPieces(requirementId: string, stored: string | null): Promise<number | null> {
  const want = stored !== null && stored !== "";
  try {
    return await prisma.$executeRaw`
      UPDATE fab_piece
      SET    has_edge_polish = ${want}
      WHERE  requirement_id = ${requirementId}
        AND  status NOT IN ('PACKAGED', 'REJECTED')
        AND  has_edge_polish <> ${want}
    `;
  } catch {
    return null;                                     // no has_edge_polish column yet
  }
}

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  // THREE FIELDS, ONE DECISION — and they arrive together because they are one
  // question asked in three parts, on one card:
  //
  //   shape       what the piece IS, which decides what edges it HAS
  //   edges       which of those edges are hand polished
  //   edgeFaces   how many times each one is walked: TOP / BOTTOM / BOTH
  //
  // Any subset may be sent; an absent field is left exactly as it was. The
  // client sends one at a time as the manager clicks, which is why absent has
  // to mean "unchanged" rather than "clear it".
  let body: { requirementId?: string; edges?: unknown; edgeFaces?: unknown; shape?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const requirementId = String(body.requirementId ?? "").trim();
  if (!requirementId) return Response.json({ error: "requirementId required" }, { status: 400 });

  // shape_type read RAW, for the same reason finished_edges is written raw: a
  // deploy whose Prisma client predates scripts/0063 has no such field and a
  // typed read would throw. A row that answers nothing is a RECTANGLE, which is
  // what every row written before shapes existed actually is.
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

  let shape = "RECTANGLE";
  let storedEdgesNow: string | null = null;
  // DID THE READ ABOVE ACTUALLY HAPPEN? Not the same question as "what did it
  // say". storedEdgesNow is null both when the row genuinely has no edges and
  // when this read threw, and the two must not lead to the same write: passing
  // the second one to stampPieces would set has_edge_polish = false on every
  // piece of a row that DOES have edges — pulling work off the hand bench that
  // the order still says to do and still pays for, while returning success.
  // The catch is unconditional, so any transient error reaches it, not only a
  // missing column.
  let edgesKnown = false;
  try {
    const rows = await prisma.$queryRaw<Array<{ shape_type: string | null; finished_edges: string | null }>>`
      SELECT shape_type::text AS shape_type, finished_edges
      FROM   fab_requirement WHERE id = ${requirementId}
    `;
    shape = parseShape(rows[0]?.shape_type);
    storedEdgesNow = rows[0]?.finished_edges ?? null;
    edgesKnown = rows.length > 0;
  } catch {
    shape = "RECTANGLE";                             // no shape_type column yet
    edgesKnown = false;
  }

  /* ---- THE SHAPE, IF THIS CALL IS CHANGING IT -----------------------------
   *
   * The owner asked for it on the same card as the sink: "one small change is
   * choose type of shape." It sits here rather than on the row PATCH because
   * it is the question the two below depend on — a rectangle has four named
   * sides, a circle has one ring — and because this route already writes raw,
   * so a deploy running ahead of scripts/0063 cannot P2022 on it.
   */
  let shapeChanged = false;
  if (body.shape !== undefined && body.shape !== null) {
    const wanted = String(body.shape).trim().toUpperCase();
    if (!(PIECE_SHAPES as readonly string[]).includes(wanted)) {
      return Response.json(
        { error: `Not a shape: ${wanted}. Use ${PIECE_SHAPES.join(", ")}.` },
        { status: 400 },
      );
    }
    shapeChanged = wanted !== shape;
    if (shapeChanged) {
      try {
        await prisma.$executeRaw`
          UPDATE fab_requirement SET shape_type = ${wanted}::"FabShapeType" WHERE id = ${requirementId}
        `;
      } catch {
        return Response.json(
          { error: "This database has no shape column yet — run scripts/0063 before choosing shapes." },
          { status: 409 },
        );
      }

      // ---- AND THE EDGE SELECTION FOLLOWS IT, OR IS CLEARED ----------------
      //
      // Crossing between round and cornered changes the VOCABULARY. "front" on
      // a circle is not a smaller answer, it is an answer about a shape that no
      // longer exists — and it would price on a rectangle's perimeter, wrong by
      // about a third. So the selection goes back to "not chosen" and somebody
      // is asked again, rather than being silently reinterpreted.
      //
      // RECTANGLE -> OVAL and CIRCLE -> OVAL keep their answer: both are round,
      // both speak `round`, and only the arithmetic underneath changes.
      const wasRound = isRound(shape);
      const nowRound = isRound(wanted);
      if (wasRound !== nowRound && storedEdgesNow !== null && storedEdgesNow !== "") {
        await prisma.$executeRaw`
          UPDATE fab_requirement SET finished_edges = NULL WHERE id = ${requirementId}
        `;
        storedEdgesNow = null;
      }
      shape = wanted;
    }
  }

  /* ---- THE FACES ----------------------------------------------------------
   *
   * TOP / BOTTOM / BOTH. BOTH is the same line walked twice and DOUBLES the
   * running feet — see shape.ts. Written upper-cased because the column's CHECK
   * constraint is case-sensitive by design: the application is the first door
   * and normalises, the constraint is the second and does not guess.
   */
  let faceStored: string | null = null;
  let faceTouched = false;
  if (body.edgeFaces !== undefined) {
    faceTouched = true;
    if (body.edgeFaces === null) {
      faceStored = null;                               // back to the TOP default
    } else {
      const wanted = String(body.edgeFaces).trim().toUpperCase();
      if (!(EDGE_FACES as readonly string[]).includes(wanted)) {
        return Response.json(
          { error: `Not a face: ${wanted}. Use ${EDGE_FACES.join(", ")}.` },
          { status: 400 },
        );
      }
      faceStored = wanted;
    }
    try {
      await prisma.$executeRaw`
        UPDATE fab_requirement SET edge_faces = ${faceStored} WHERE id = ${requirementId}
      `;
    } catch {
      return Response.json(
        { error: "This database has no edge-face column yet — run scripts/0065 before choosing top or bottom." },
        { status: 409 },
      );
    }
  }

  /* ---- EDGES ONLY IF THIS CALL CARRIES THEM -------------------------------
   *
   * A call that only changes the shape or the face must not wipe the edge
   * selection as a side effect. `edges` absent means unchanged; `edges: null`
   * means "put it back to not chosen", which is a different instruction and the
   * one the Clear button sends.
   */
  const touchesEdges = Object.prototype.hasOwnProperty.call(body, "edges");
  if (!touchesEdges) {
    // ---- BUT THE PIECES STILL HAVE TO FOLLOW ------------------------------
    //
    // This return used to skip the stamp block at the foot of the file, and a
    // SHAPE change is exactly the call that needs it: crossing round/cornered
    // clears finished_edges above, so a row that was marked for hand polish
    // becomes a row that is not — while every released piece keeps
    // has_edge_polish = true and sits on the hand bench for work the order no
    // longer says to do, and no longer pays for.
    //
    // Stamping here from the CURRENT stored value covers both directions: the
    // shape change that cleared it, and the plain face-only call that should
    // leave it alone (the WHERE has_edge_polish <> want makes that a no-op).
    //
    // ONLY IF THE READ ABOVE ACTUALLY SUCCEEDED. storedEdgesNow is null both for
    // "this row has no edges" and for "the read threw", and stamping the second
    // as if it were the first sets has_edge_polish = false across a row that
    // does have edges — taking real, paid work off the hand bench and reporting
    // success while doing it. When the read failed the pieces are left exactly
    // as they are; the next call with a good read puts them right.
    const stamped = edgesKnown ? await stampPieces(requirementId, storedEdgesNow) : null;
    return Response.json({
      success: true,
      requirementId,
      finishedEdges: storedEdgesNow,
      shape,
      shapeChanged,
      edgeFaces: faceTouched ? faceStored : undefined,
      piecesStamped: stamped,
      faceLabel: describeEdgeFace(faceTouched ? faceStored : undefined),
      label: storedEdgesNow === null
        ? "Not chosen"
        : describeEdges(
            storedEdgesNow === ROUND_EDGE
              ? { round: true }
              : Object.fromEntries(storedEdgesNow.split(",").filter(Boolean).map((e) => [e, true])),
            shape,
          ),
    });
  }

  // ---- THE SINK GATE IS GONE, DELIBERATELY ---------------------------------
  //
  // This block used to refuse a row with no sinks with a 409, on the rule
  // `fabricationRequired = sinkRequired` — edge work was the hand-polish that
  // came with a sink cutout, so a plain row had no edges worth recording.
  //
  // The owner separated the two jobs, and the refusal became the bug: a plain
  // row whose front edge the customer wants polished could not be marked at
  // all, and the shop did the work unpaid. There is nothing to check here now —
  // any row may carry hand edge polish, and whether it earns is arithmetic, not
  // permission. (The old block is described rather than left commented out; git
  // has the code, and a commented-out guard reads like one somebody forgot to
  // re-enable.)

  // ---- what to store -------------------------------------------------------
  let stored: string | null;
  if (body.edges === null || body.edges === undefined) {
    stored = null;                                   // back to "not chosen"
  } else {
    if (!Array.isArray(body.edges)) {
      return Response.json({ error: "edges must be an array of edge names, or null." }, { status: 400 });
    }
    // THE VOCABULARY DEPENDS ON THE SHAPE. A rectangle has four named sides; a
    // circle or an oval has ONE edge and no sides to choose between, so it takes
    // the single word `round`. Asking the shape rather than accepting both from
    // everything is what stops a screen with a stale shape writing "front" onto
    // a circle — a selection that would price as a rectangle's perimeter and be
    // wrong by a third.
    const round = isRound(shape);
    const allowed: readonly string[] = round ? [ROUND_EDGE] : EDGES;

    // REFUSED, NOT DROPPED. serializeEdges silently ignores a word it does not
    // know, which is right for rendering a stored value and wrong here: a
    // client sending "top" has a bug, and answering "saved" while storing
    // nothing hides it until somebody notices the money is short.
    const wanted = body.edges.map((e) => String(e).trim().toLowerCase());
    const unknown = wanted.filter((e) => !allowed.includes(e));
    if (unknown.length) {
      return Response.json(
        {
          error: round
            ? `Row ${requirement.pieceLabel ?? "this row"} is ${shape.toLowerCase()} — it has one edge, ` +
              `so the only selection is "${ROUND_EDGE}". Got: ${unknown.join(", ")}.`
            : `Not an edge: ${unknown.join(", ")}. Use ${EDGES.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    const selection: EdgeSelection = {};
    for (const e of wanted) {
      if (e === ROUND_EDGE) selection.round = true;
      else selection[e as Edge] = true;
    }
    stored = serializeEdges(selection);              // canonical order, deduped
  }

  await prisma.$executeRaw`
    UPDATE fab_requirement SET finished_edges = ${stored} WHERE id = ${requirementId}
  `;

  // ---- AND THE PIECES ALREADY ON THE FLOOR ---------------------------------
  //
  // A row's edge decision can change after its pieces have been released — the
  // customer rings up, the manager marks the front edge, and forty pieces are
  // already cut. The stamp on those pieces has to follow, or the hand bench
  // works from a queue that disagrees with the order it is billed from.
  //
  // Under the group rule the row's answer IS every piece's answer, so this is
  // one UPDATE rather than a decision per piece.
  //
  // PACKAGED AND REJECTED PIECES ARE LEFT ALONE. A packed piece has been
  // charged for on the CEO's period card on the day it was packed; restamping
  // it would move historical money. Re-cutting is the way to change a piece
  // that has already left.
  //
  // Best-effort: the column arrives in scripts/0063, and a deploy running ahead
  // of the migration must still be able to save the row itself. The row is the
  // source of truth for the MONEY (pricing reads finished_edges, not the
  // stamp), so a failure here costs the queue a refresh, not a rupee.
  const piecesStamped = await stampPieces(requirementId, stored);

  return Response.json({
    success: true,
    requirementId,
    /** The canonical string as stored — the picker believes this rather than
     *  what it sent, the same way SinkBoard believes the clamped quantity. */
    finishedEdges: stored,
    /** The shape this selection was validated against, after any change made
     *  above. The picker redraws from it, so a shape change and its cleared
     *  edges land on screen in one answer. */
    shape,
    shapeChanged,
    /** Only present when this call touched it. Undefined means unchanged. */
    edgeFaces: faceTouched ? faceStored : undefined,
    /** "All four" / "Front + left" / "All round" / "None", for a confirmation line. */
    label: stored === null ? "Not chosen" : describeEdges(
      stored === ROUND_EDGE
        ? { round: true }
        : Object.fromEntries(stored.split(",").filter(Boolean).map((e) => [e, true])),
      shape,
    ),
    /** "top only" / "bottom only" / "top & bottom" — for the same line. */
    faceLabel: describeEdgeFace(faceTouched ? faceStored : undefined),
    /** How many released pieces had their stamp moved to match. Null means the
     *  column is not there yet — not that nothing needed moving. */
    piecesStamped,
  });
}
