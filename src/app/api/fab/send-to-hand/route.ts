// A PIECE COMES OFF THE MACHINE AND GOES TO THE HAND BENCH — scripts/0067.
//
// The owner: "already decided is also sent to hand later if machine doesn't
// support or busy or breakdown... it need to ask the cost on how much per feet,
// which all the side — top or bottom or side or any combo — and choose the
// number of side for top, no of side for bottom, no of side for side. And this
// can be per piece... they can send a piece or a row itself fully."
//
// ─────────────────────── FROM BOTH SCREENS, AND THAT WAS ASKED FOR ──────────
// The supervisor does it from his board; the polishing operator does it from
// his queue, because the man standing at the machine is the one who knows it
// just broke. So the gate is EMPLOYEE — but a floor login must have a POLISHING
// session open, exactly as scripts/0064 requires one for a cutter's slab
// release, and for the identical reason: the floor shares ONE operator account,
// so the login names nobody and only the session carries the worker and shift.
//
// A supervisor or manager needs no session — his login IS the identity — and
// one is recorded anyway if he happens to have it open.
//
// ─────────────────────── THE ACT IS THE CUTTER'S, THE PRICE IS NOT ──────────
// Sending a piece to the bench and deciding what the bench is paid are two
// different decisions that arrived through one button, and only the first one
// was ever the floor's. The hand figures are not a note: pieceChargeWithHand
// prefers a piece's hand spec over its row, and stampPieceCharges FREEZES the
// result into charged_edge when the piece is packed — written once, never
// rewritten. So a floor login typing a rate here was not proposing a price, it
// was settling what the project earned, on any piece id it cared to name and,
// with wholeRow, on every in-progress piece of any row.
//
// The split: polish_by_hand and the three faces are accepted from EMPLOYEE —
// the machine broke and the man at it is the one who knows — while rate,
// pairRate, rateTop/Bottom/Side, pricingMode and totalOverride are accepted
// only from SUPERVISOR and above. From a floor login those fields are IGNORED,
// not refused: the send still happens, the pieces keep whatever terms they
// already had, and the reply says so (priceAccepted) so the screen can tell him
// the price is the supervisor's rather than silently dropping his figure.
//
// IGNORED MEANS UNTOUCHED, not blanked. Writing NULL over a rate a supervisor
// had already agreed would be the same repricing by a different route — the
// piece would fall back to the rate card. The floor's write does not name those
// columns at all.
//
// ─────────────────────── PRICING ONLY, AS AGREED ────────────────────────────
// polish_by_hand does NOT reroute anything. The piece stays in the polishing
// queue and the piece funnel counts do not move. The owner chose that: "pricing
// only, for now." Changing where a piece appears on the floor is a separate
// decision from changing what it costs, and only one of them was asked for.
//
// ─────────────────────── THE ROW IS NOT HOMOGENEOUS HERE ────────────────────
// Everywhere else in this module, a row where half the pieces differ is SPLIT.
// That rule is right for an ORDER, decided once at a desk. It is wrong for a
// machine failing at nine at night, which takes whatever is in front of it,
// mid-row. So this writes per PIECE and each one overrides its row for itself.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate, TIER_RANK, type FabTier } from "@/lib/fab/access";
import { readProcessSession } from "@/lib/fab/processSessionServer";
import {
  POLISH_FACES, parseShape, isRound, RECT_EDGES, ROUND_EDGE,
  type PolishFace,
} from "@/lib/fab/shape";
import { PRICING_MODES } from "@/lib/fab/pricing";

function sent(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function money(v: unknown, what: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${what} must be a number of rupees, zero or more.` };
  return { ok: true, value: n };
}

function canonicalFace(raw: unknown, shape: unknown, face: string):
  { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const words = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  if (words.length === 0) return { ok: true, value: "" };
  if (isRound(shape)) {
    if (words.every((w) => w === ROUND_EDGE)) return { ok: true, value: ROUND_EDGE };
    return { ok: false, error: `A ${parseShape(shape).toLowerCase()} has one edge, not sides — ${face} cannot be "${words.join(",")}".` };
  }
  const bad = words.filter((w) => !(RECT_EDGES as readonly string[]).includes(w));
  if (bad.length) return { ok: false, error: `Not an edge of this piece: ${bad.join(", ")} (on ${face}).` };
  return { ok: true, value: RECT_EDGES.filter((e) => words.includes(e)).join(",") };
}

/**
 * GET — what to prefill the dialog with.
 *
 * The owner: "if in same row again a piece is sent like that, same applicable
 * and prefilled for everything." The machine that broke is still broken and the
 * next piece off it needs the same treatment, so the most recent hand spec on
 * this row comes back and the dialog opens already filled.
 *
 * THE LUMP SUM IS NOT RETURNED. A figure agreed for ONE piece is by definition
 * not a figure for the next one; carrying it would quietly bill the same total
 * per piece across a whole row nobody quoted that way.
 */
export async function GET(req: NextRequest) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const requirementId = new URL(req.url).searchParams.get("requirementId")?.trim();
  if (!requirementId) return Response.json({ error: "requirementId required" }, { status: 400 });

  try {
    const [last] = await prisma.$queryRaw<Array<{
      hand_edges_top: string | null; hand_edges_bottom: string | null;
      hand_edges_side: string | null; hand_rate: number | null; hand_pair_rate: number | null;
      hand_rate_top: number | null; hand_rate_bottom: number | null; hand_rate_side: number | null;
      hand_pricing_mode: string | null;
    }>>`
      SELECT hand_edges_top, hand_edges_bottom, hand_edges_side,
             hand_rate, hand_pair_rate,
             hand_rate_top, hand_rate_bottom, hand_rate_side, hand_pricing_mode
      FROM   fab_piece
      WHERE  requirement_id = ${requirementId}
        AND  polish_by_hand = true
      ORDER  BY hand_assigned_at DESC NULLS LAST
      LIMIT  1
    `;
    if (last) {
      return Response.json({
        // "PREVIOUS" — the machine that broke is still broken and the next
        // piece off it needs the same treatment as the last one.
        source: "PREVIOUS_SEND",
        prefill: {
          faces: {
            top: last.hand_edges_top ?? null,
            bottom: last.hand_edges_bottom ?? null,
            side: last.hand_edges_side ?? null,
          },
          rate: last.hand_rate ?? null,
          pairRate: last.hand_pair_rate ?? null,
          rateTop: last.hand_rate_top ?? null,
          rateBottom: last.hand_rate_bottom ?? null,
          rateSide: last.hand_rate_side ?? null,
          pricingMode: last.hand_pricing_mode ?? null,
          totalOverride: null,
        },
      });
    }

    // ── NOTHING SENT TO HAND FROM THIS ROW YET — FALL BACK TO THE ROW ────────
    //
    // This returned NULL, and the dialog then seeded itself from the LEGACY
    // finished_edges pair alone. Every row specified with the three-face
    // controls leaves that column NULL, so on the FIRST piece off such a row
    // the dialog opened with no faces ticked and no rate — on a row whose
    // specification was already agreed and priced.
    //
    // What that costs: the operator either re-enters the whole spec from
    // memory, or sends the piece with nothing on it. The second is worse than
    // it looks — the hand-polish record is written with no faces and no rate,
    // so the bench does the work and the piece is charged NOTHING for it.
    //
    // So the row's own specification is the fallback. It is the right default
    // twice over: the hand bench is usually being asked to do exactly the work
    // the machine was going to do, and the row's rates are the figures somebody
    // already agreed for that work.
    //
    // ITS OWN QUERY, and wrapped, for the reason the whole file is written this
    // way: a database without 0067 must lose the prefill and nothing else.
    const [row] = await prisma.$queryRaw<Array<{
      edges_top: string | null; edges_bottom: string | null; edges_side: string | null;
      edge_rate: number | null; pair_rate: number | null;
      edge_rate_top: number | null; edge_rate_bottom: number | null; edge_rate_side: number | null;
      pricing_mode: string | null;
    }>>`
      SELECT edges_top, edges_bottom, edges_side,
             edge_rate, pair_rate, edge_rate_top, edge_rate_bottom, edge_rate_side,
             pricing_mode
      FROM   fab_requirement WHERE id = ${requirementId}
    `;
    if (!row) return Response.json({ prefill: null });

    const noSpec = row.edges_top === null && row.edges_bottom === null && row.edges_side === null;
    if (noSpec) {
      // The row is still on the legacy pair (or has no decision at all). The
      // dialog seeds itself from those, which it has always done correctly.
      return Response.json({ prefill: null });
    }

    return Response.json({
      // "THE ROW" — so the dialog can say where the figures came from. A
      // prefill somebody cannot account for is a price nobody agreed to.
      source: "ROW_SPEC",
      prefill: {
        faces: {
          top: row.edges_top ?? null,
          bottom: row.edges_bottom ?? null,
          side: row.edges_side ?? null,
        },
        rate: row.edge_rate ?? null,
        pairRate: row.pair_rate ?? null,
        rateTop: row.edge_rate_top ?? null,
        rateBottom: row.edge_rate_bottom ?? null,
        rateSide: row.edge_rate_side ?? null,
        pricingMode: row.pricing_mode ?? null,
        // THE AGREED TOTAL IS NEVER CARRIED. A lump sum settled for the ROW is
        // not a figure for one piece coming off a broken machine — the same
        // rule the previous-send branch above follows.
        totalOverride: null,
      },
    });
  } catch {
    // scripts/0067 not applied — nothing has ever been sent to hand.
    return Response.json({ prefill: null });
  }
}

export async function POST(req: NextRequest) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  // A FLOOR LOGIN MUST HAVE A STATION SESSION. Without it the record would be
  // empty for exactly the person it exists to name — see scripts/0064, which
  // makes the same demand of a cutter releasing a slab, and it costs the
  // operator nothing because his queue already required one to start work.
  const session = await readProcessSession("POLISHING");
  if (g.tier === "EMPLOYEE" && !session) {
    return Response.json(
      { error: "Start your polishing session first — the record has to say who sent this to hand." },
      { status: 409 },
    );
  }

  let body: {
    pieceIds?: unknown;
    requirementId?: string;
    wholeRow?: boolean;
    faces?: Partial<Record<PolishFace, unknown>> | null;
    rate?: unknown;
    pricingMode?: unknown;
    totalOverride?: unknown;
    pairRate?: unknown;
    rateTop?: unknown;
    rateBottom?: unknown;
    rateSide?: unknown;
    undo?: boolean;
  };
  try { body = await req.json(); }
  catch { return Response.json({ error: "Malformed request body." }, { status: 400 }); }

  // ── WHICH PIECES: named ones, or a whole row ─────────────────────────────
  let pieceIds: string[] = [];
  if (body.wholeRow) {
    const rid = String(body.requirementId ?? "").trim();
    if (!rid) return Response.json({ error: "requirementId required to send a whole row" }, { status: 400 });
    // PACKAGED and REJECTED pieces are excluded: one is finished and already
    // charged, the other is not work anybody is doing. Sending them to hand
    // would move a figure that is closed.
    const rows = await prisma.fabPiece.findMany({
      where: { requirementId: rid, status: { notIn: ["PACKAGED", "REJECTED"] } },
      select: { id: true },
    });
    pieceIds = rows.map((r) => r.id);
    if (!pieceIds.length) {
      return Response.json({ error: "No pieces on that row are still in progress." }, { status: 409 });
    }
  } else {
    const raw = body.pieceIds;
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((x) => typeof x === "string" && x)) {
      return Response.json({ error: "pieceIds must be a non-empty array of ids" }, { status: 400 });
    }
    pieceIds = [...new Set(raw as string[])];
  }

  // ── UNDO: it went back on the machine ────────────────────────────────────
  //
  // Clears the flag AND the whole specification with it. Leaving a rate behind
  // on a piece no longer marked by-hand is a figure waiting to be applied by
  // accident the next time somebody ticks the box.
  if (body.undo) {
    try {
      const n = await prisma.$executeRaw`
        UPDATE fab_piece
           SET polish_by_hand = false,
               hand_edges_top = NULL, hand_edges_bottom = NULL, hand_edges_side = NULL,
               hand_rate = NULL, hand_pair_rate = NULL,
               hand_rate_top = NULL, hand_rate_bottom = NULL, hand_rate_side = NULL,
               hand_pricing_mode = NULL, hand_total_override = NULL,
               hand_assigned_by_id = NULL, hand_assigned_session_id = NULL,
               hand_assigned_at = NULL
         WHERE id = ANY(${pieceIds}::text[])`;
      return Response.json({ success: true, pieces: n, undone: true });
    } catch (e) {
      console.error("[fab/send-to-hand] undo failed", e);
      return Response.json(
        { error: "Could not save — scripts/0067 is not on this database yet." },
        { status: 409 },
      );
    }
  }

  // ── THE SHAPE DECIDES WHICH WORDS THE FACES MAY USE ──────────────────────
  let shape = "RECTANGLE";
  try {
    const [r] = await prisma.$queryRaw<Array<{ shape_type: string | null }>>`
      SELECT r.shape_type::text AS shape_type
      FROM   fab_piece p JOIN fab_requirement r ON r.id = p.requirement_id
      WHERE  p.id = ${pieceIds[0]} LIMIT 1`;
    shape = r?.shape_type ?? "RECTANGLE";
  } catch { /* no shape_type column — rectangle, as every old row is */ }

  const faceCols: Record<string, string | null> = {};
  const faces = body.faces ?? {};
  for (const f of POLISH_FACES) {
    if (!sent(faces as object, f)) continue;
    const r = canonicalFace((faces as Record<string, unknown>)[f], shape, f);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    faceCols[f] = r.value;
  }

  let mode: string | null = null;
  if (body.pricingMode != null && body.pricingMode !== "") {
    const t = String(body.pricingMode).trim().toUpperCase();
    if (!(PRICING_MODES as readonly string[]).includes(t)) {
      return Response.json({ error: `Not a pricing mode: ${t}.` }, { status: 400 });
    }
    mode = t;
  }

  const rate = money(body.rate, "The rate");
  if (!rate.ok) return Response.json({ error: rate.error }, { status: 400 });
  // scripts/0069 — the price for doing top and bottom together, at the bench.
  const pairRate = money(body.pairRate, "The top-and-bottom rate");
  if (!pairRate.ok) return Response.json({ error: pairRate.error }, { status: 400 });
  // scripts/0070 — a rate per face at the bench, same fallback as the row's.
  const rateTop = money(body.rateTop, "The top rate");
  if (!rateTop.ok) return Response.json({ error: rateTop.error }, { status: 400 });
  const rateBottom = money(body.rateBottom, "The bottom rate");
  if (!rateBottom.ok) return Response.json({ error: rateBottom.error }, { status: 400 });
  const rateSide = money(body.rateSide, "The side band rate");
  if (!rateSide.ok) return Response.json({ error: rateSide.error }, { status: 400 });
  const override = money(body.totalOverride, "The agreed total");
  if (!override.ok) return Response.json({ error: override.error }, { status: 400 });

  // WHO IS ALLOWED TO SETTLE THE FIGURE — see the head of this file. g.ok is
  // true here, so the tier is set; SUPERVISOR and above price, EMPLOYEE sends.
  const mayPrice = TIER_RANK[g.tier as FabTier] >= TIER_RANK.SUPERVISOR;
  const priced = mayPrice
    ? {
        rate: rate.value, pairRate: pairRate.value,
        rateTop: rateTop.value, rateBottom: rateBottom.value, rateSide: rateSide.value,
        mode, override: override.value,
      }
    : { rate: null, pairRate: null, rateTop: null, rateBottom: null, rateSide: null, mode: null, override: null };

  // NOTHING AGREED AT ALL IS REFUSED. A piece on the bench with no faces, no
  // rate and no figure is somebody polishing stone for a price nobody set — the
  // pricing module reports it as unpriced, and it is better to refuse the button
  // than to create the hole and report it afterwards.
  //
  // A PIECE RATE IS A COMPLETE ANSWER ON ITS OWN, and this is the case the
  // first version of this check made impossible: "for some peice group we give
  // to the hand fabricated fully for peice rate". A piece that goes to the
  // bench whole has no faces to name — the whole thing is being done — so
  // demanding faces demanded a lie. Per piece and lump sum price from the
  // quantity, not the perimeter; only RUNNING_FOOT needs to know which edges,
  // because only feet are measured along them. See priceRow's chargePieces.
  //
  // ASKED OF WHAT WILL ACTUALLY BE WRITTEN, which is why it reads `priced` and
  // not the body: a floor login's rate is ignored, so a send carrying nothing
  // BUT a rate would otherwise pass this check and store an empty spec —
  // handPieceCharge reports exactly that as the unpriced HAND_SPEC hole.
  const anyFace = POLISH_FACES.some((f) => faceCols[f] !== undefined && faceCols[f] !== null && faceCols[f] !== "");
  const hasPieceRate = priced.mode !== null && priced.mode !== "RUNNING_FOOT" && priced.rate !== null;
  if (!anyFace && priced.override === null && !hasPieceRate) {
    return Response.json(
      {
        error: mayPrice
          ? "Say what is being paid for: choose which faces are polished, or set " +
            "Per piece / Lump sum with a rate, or enter an agreed total."
          : "Choose which faces the bench is polishing. The rate is the " +
            "supervisor's to set, so a price on its own cannot send a piece to hand.",
      },
      { status: 400 },
    );
  }

  try {
    // TWO WRITES, ONE ACT. The floor's statement does not mention the money
    // columns at all — see the head of this file — so a rate a supervisor has
    // already agreed on these pieces survives a cutter re-sending them.
    const n = mayPrice
      ? await prisma.$executeRaw`
          UPDATE fab_piece
             SET polish_by_hand        = true,
                 hand_edges_top        = ${faceCols.top ?? null},
                 hand_edges_bottom     = ${faceCols.bottom ?? null},
                 hand_edges_side       = ${faceCols.side ?? null},
                 hand_rate             = ${priced.rate},
                 hand_pair_rate        = ${priced.pairRate},
                 hand_rate_top         = ${priced.rateTop},
                 hand_rate_bottom      = ${priced.rateBottom},
                 hand_rate_side        = ${priced.rateSide},
                 hand_pricing_mode     = ${priced.mode},
                 hand_total_override   = ${priced.override},
                 hand_assigned_by_id   = ${g.user.id as string},
                 hand_assigned_session_id = ${session?.id ?? null},
                 hand_assigned_at      = now()
           WHERE id = ANY(${pieceIds}::text[])
             AND status NOT IN ('PACKAGED','REJECTED')`
      : await prisma.$executeRaw`
          UPDATE fab_piece
             SET polish_by_hand        = true,
                 hand_edges_top        = ${faceCols.top ?? null},
                 hand_edges_bottom     = ${faceCols.bottom ?? null},
                 hand_edges_side       = ${faceCols.side ?? null},
                 hand_assigned_by_id   = ${g.user.id as string},
                 hand_assigned_session_id = ${session?.id ?? null},
                 hand_assigned_at      = now()
           WHERE id = ANY(${pieceIds}::text[])
             AND status NOT IN ('PACKAGED','REJECTED')`;
    return Response.json({
      success: true,
      pieces: n,
      // Said back so the screen can show who it recorded rather than assuming.
      // On the floor this is the SESSION's worker, not the shared login.
      recordedFrom: session ? "floor" : "desk",
      /** Was the figure in the dialog stored, or is the price still the
       *  supervisor's? A send whose rate was quietly dropped is a price
       *  somebody believes was agreed, so the reply says which happened. */
      priceAccepted: mayPrice,
      priceNote: mayPrice
        ? null
        : "Sent to the hand bench. The rate is the supervisor's to set — these pieces keep the terms they already had.",
    });
  } catch (e) {
    console.error("[fab/send-to-hand] update failed", e);
    return Response.json(
      { error: "Could not save — scripts/0067 is not on this database yet." },
      { status: 409 },
    );
  }
}
