// THE THREE-FACE SPECIFICATION AND WHAT IT COSTS — scripts/0067.
//
// A SECOND ROUTE, NOT SURGERY ON finished-edges, and that is a deliberate
// choice. That route is live, it is 300 lines, and it carries the piece-stamp
// logic that decides which pieces sit on the hand bench. Threading six new
// fields through it would put every existing edge decision at risk for a
// feature nobody has clicked yet. This one is additive: if it fails, or is
// never called, the old route and the old columns behave exactly as they do
// today and every figure stays where it is.
//
// ─────────────────────── WHAT IT SAVES, AND WHAT ABSENT MEANS ───────────────
//   faces         which sides get top / bottom / side hand polish
//   rate          this row's own figure, or null for the rate card
//   pricingMode   RUNNING_FOOT / PER_PIECE / LUMP_SUM
//   totalOverride the phone-call number, replacing the calculation
//
// EVERY FIELD IS OPTIONAL AND ABSENT MEANS UNCHANGED. The card sends one field
// as the supervisor clicks it, so "not sent" cannot mean "clear it" — that rule
// is the same one finished-edges states at its head, and breaking it would let
// a rate box that had not been touched wipe a rate somebody agreed.
//
// NULL, SENT EXPLICITLY, DOES clear — that is how the boxes are emptied back to
// "use the card" and "use the calculation".
//
// ─────────────────────── AND THE OVERRIDE IS SIGNED ─────────────────────────
// A typed total records WHO typed it and WHEN, because it is the one figure on
// the invoice that no calculation stands behind. Clearing it clears the
// signature with it, so the columns can never claim somebody agreed a figure
// that is no longer there.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import {
  POLISH_FACES, parseShape, isRound, RECT_EDGES, ROUND_EDGE,
  type PolishFace,
} from "@/lib/fab/shape";
import { PRICING_MODES } from "@/lib/fab/pricing";

/** Present in the body at all? `undefined` is "leave it alone"; an explicit
 *  null is "clear it". JSON cannot tell those apart without asking the object. */
function sent(body: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/** A rupee figure, or null, or an error. Rejects NaN, negatives and rubbish
 *  rather than coercing — `Number("")` is 0 and a silent zero here is a row
 *  quoted at nothing. */
function money(v: unknown, what: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${what} must be a number of rupees, zero or more.` };
  }
  return { ok: true, value: n };
}

/**
 * Canonicalise one face's side list against the SHAPE it belongs to.
 *
 * Accepts an array (["front","back"]) or a CSV, because the picker sends the
 * first and psql-minded callers send the second. Refuses a word the shape does
 * not have — a circle marked "front" is a contradiction, and letting it through
 * would store a row whose two halves disagree and which prices at zero with no
 * flag. Returns "" for "this face, none", which is a real answer.
 */
function canonicalFace(raw: unknown, shape: unknown, face: string):
  { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const words = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((w) => String(w).trim().toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return { ok: true, value: "" };

  if (isRound(shape)) {
    if (words.every((w) => w === ROUND_EDGE)) return { ok: true, value: ROUND_EDGE };
    return {
      ok: false,
      error: `A ${parseShape(shape).toLowerCase()} has one edge, not sides — ${face} cannot be "${words.join(",")}".`,
    };
  }
  const bad = words.filter((w) => !(RECT_EDGES as readonly string[]).includes(w));
  if (bad.length) {
    return { ok: false, error: `Not an edge of this piece: ${bad.join(", ")} (on ${face}).` };
  }
  // Canonical order, so two identical selections are always the same string and
  // can be compared without being parsed — the rule serializeEdges follows.
  return { ok: true, value: RECT_EDGES.filter((e) => words.includes(e)).join(",") };
}

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let body: {
    requirementId?: string;
    faces?: Partial<Record<PolishFace, unknown>> | null;
    rate?: unknown;
    pairRate?: unknown;
    rateTop?: unknown;
    rateBottom?: unknown;
    rateSide?: unknown;
    pricingMode?: unknown;
    totalOverride?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const requirementId = String(body.requirementId ?? "").trim();
  if (!requirementId) {
    return Response.json({ error: "requirementId required" }, { status: 400 });
  }

  // The shape decides which words the faces may use, so it is read before any
  // of them is validated. Raw and wrapped, like every shape read in this module:
  // a client generated before scripts/0063 has no such field.
  let shape: string = "RECTANGLE";
  let exists = false;
  try {
    const rows = await prisma.$queryRaw<Array<{ shape_type: string | null }>>`
      SELECT shape_type::text AS shape_type FROM fab_requirement WHERE id = ${requirementId}
    `;
    exists = rows.length > 0;
    shape = rows[0]?.shape_type ?? "RECTANGLE";
  } catch {
    const r = await prisma.fabRequirement.findUnique({
      where: { id: requirementId }, select: { id: true },
    });
    exists = !!r;
  }
  if (!exists) {
    return Response.json(
      { error: "That piece row no longer exists — refresh the board and look again." },
      { status: 404 },
    );
  }

  // ── validate everything BEFORE writing anything ────────────────────────
  //
  // A half-applied change is worse than a refused one: the supervisor sees an
  // error and assumes nothing happened, while the rate went in and the faces
  // did not. Everything below is checked first and the UPDATE is built once.
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, v: unknown) => { values.push(v); sets.push(`${col} = $${values.length}`); };

  if (sent(body, "faces")) {
    const faces = body.faces ?? {};
    for (const f of POLISH_FACES) {
      if (!sent(faces as object, f)) continue;
      const r = canonicalFace((faces as Record<string, unknown>)[f], shape, f);
      if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
      push(`edges_${f}`, r.value);
    }
  }

  if (sent(body, "pricingMode")) {
    const m = body.pricingMode;
    if (m === null || m === undefined || m === "") {
      push("pricing_mode", null);
    } else {
      const t = String(m).trim().toUpperCase();
      if (!(PRICING_MODES as readonly string[]).includes(t)) {
        return Response.json(
          { error: `Not a pricing mode: ${t}. Use ${PRICING_MODES.join(", ")}.` },
          { status: 400 },
        );
      }
      push("pricing_mode", t);
    }
  }

  if (sent(body, "rate")) {
    const r = money(body.rate, "The rate");
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    push("edge_rate", r.value);
  }

  // scripts/0069 — the price for doing top and bottom together. Handled exactly
  // like `rate`: sent() distinguishes ABSENT (leave it alone) from an explicit
  // null (clear it), so a client that does not know about pair rates can never
  // wipe one somebody agreed.
  if (sent(body, "pairRate")) {
    const r = money(body.pairRate, "The top-and-bottom rate");
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    push("pair_rate", r.value);
  }

  // scripts/0070 — a rate per face. Each handled exactly like `rate` and the
  // pair rate: sent() tells ABSENT (leave it) from an explicit null (clear it),
  // so an older client cannot wipe a figure somebody agreed.
  for (const [key, col] of [
    ["rateTop", "edge_rate_top"],
    ["rateBottom", "edge_rate_bottom"],
    ["rateSide", "edge_rate_side"],
  ] as const) {
    if (sent(body, key)) {
      const r = money((body as Record<string, unknown>)[key], `The ${key === "rateSide" ? "side band" : key === "rateTop" ? "top" : "bottom"} rate`);
      if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
      push(col, r.value);
    }
  }

  if (sent(body, "totalOverride")) {
    const r = money(body.totalOverride, "The agreed total");
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    push("edge_total_override", r.value);
    // SIGNED, OR UNSIGNED WITH IT. Clearing the figure clears who agreed it —
    // a signature on a total that is no longer there is worse than none.
    push("edge_total_override_by", r.value === null ? null : (g.user.id as string));
    push("edge_total_override_at", r.value === null ? null : new Date());
  }

  if (sets.length === 0) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  values.push(requirementId);
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE fab_requirement SET ${sets.join(", ")} WHERE id = $${values.length}`,
      ...values,
    );
  } catch (e) {
    // The only expected failure is a database without scripts/0067. Said out
    // loud rather than swallowed: the supervisor pressed a button and it did
    // not do what he thinks it did.
    console.error("[fab/polish-terms] update failed", e);
    return Response.json(
      { error: "Could not save — the pricing columns are not on this database yet (scripts/0067)." },
      { status: 409 },
    );
  }

  // Read back what is now stored, so the card renders from the database rather
  // than from what it hoped it sent. Cheap, and it is how a rejected value
  // stops being displayed as accepted.
  try {
    const [row] = await prisma.$queryRaw<Array<{
      edges_top: string | null; edges_bottom: string | null; edges_side: string | null;
      edge_rate: number | null; pricing_mode: string | null; pair_rate: number | null;
      edge_rate_top: number | null; edge_rate_bottom: number | null; edge_rate_side: number | null;
      edge_total_override: number | null; edge_total_override_at: Date | null;
    }>>`
      SELECT edges_top, edges_bottom, edges_side, edge_rate, pair_rate,
             edge_rate_top, edge_rate_bottom, edge_rate_side,
             pricing_mode, edge_total_override, edge_total_override_at
      FROM   fab_requirement WHERE id = ${requirementId}
    `;
    return Response.json({
      success: true,
      requirementId,
      shape: parseShape(shape),
      faces: { top: row?.edges_top ?? null, bottom: row?.edges_bottom ?? null, side: row?.edges_side ?? null },
      rate: row?.edge_rate ?? null,
      pairRate: row?.pair_rate ?? null,
      rateTop: row?.edge_rate_top ?? null,
      rateBottom: row?.edge_rate_bottom ?? null,
      rateSide: row?.edge_rate_side ?? null,
      pricingMode: row?.pricing_mode ?? null,
      totalOverride: row?.edge_total_override ?? null,
      totalOverrideAt: row?.edge_total_override_at ?? null,
    });
  } catch {
    return Response.json({ success: true, requirementId });
  }
}
