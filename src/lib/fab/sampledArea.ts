// HOW MUCH OF A SLAB LEFT AS SAMPLES.
//
// One read, used by both places that have to agree about a slab's capacity:
//
//   /api/fab/supervisor/board    to grey the Send-to-cutter button and show
//                                the slab's real remaining area
//   /api/fab/approve-slab        to enforce the same rule server-side
//
// They were the pair that already shared decideSendToCutting for exactly this
// reason — the screen must not offer something the route will refuse — and the
// sample take-off is now part of that decision, so it has to come from one
// place too.
//
// ─────────────────────────────────────────────────────────────── WHY IT EXISTS
// Sample pieces are cut off a slab and leave fabrication. Nothing recorded
// that, so the module was wrong twice over: the stone was reported as scrap
// (inflating wastage by exactly the amount recovered) and it left the slab's
// purchase-order capacity untouched (so a slab could be filled to its full
// nominal area after 10 sqft of it had already gone). See the note on
// SlabLossInput.sampledAreaSqft.
//
// ───────────────────────────────────────────────────────────────── RAW SQL
// sampling_intake.source_slab_id and the join to sampling_size are read
// through $queryRaw rather than the Prisma client, following the convention
// scripts/0019 and 0024 established: a deploy running a client generated
// before scripts/0053 was applied would throw P2022 on a model read, and this
// runs on the supervisor's board — the screen that must not break. Raw SQL asks
// Postgres for the columns by name and fails only if they genuinely are not
// there, which the catch below turns into "no samples recorded" rather than an
// error page.
//
// The AREA SUM IS NOT DONE IN SQL. sampleAreaSqft in slabLoss.ts owns the
// inches -> square feet conversion and the 2dp rounding for both sides of the
// comparison; a second copy in a SELECT would be a second rounding rule, and
// the two would disagree by cents of a square foot exactly where it matters.

import { prisma } from "@/lib/prisma";
import { sampleAreaSqft } from "@/lib/fab/slabLoss";

interface IntakeRow {
  source_slab_id: string;
  length_in: unknown;
  width_in: unknown;
  quantity: unknown;
}

/**
 * Square feet taken as samples, per fab_slab.id, for the slabs asked about.
 *
 * A slab with no sample intake is ABSENT from the map, not zero — the caller
 * uses `?? 0`, and the distinction keeps the map small on a board where most
 * slabs have never been near sampling.
 *
 * Returns an empty map rather than throwing when scripts/0053 has not been
 * applied yet. That is the same fail-open shape as listAltContexts(): the
 * number is an adjustment to a figure that already exists, so "no samples
 * recorded" is the honest reading of a database that cannot record them.
 */
export async function sampledAreaBySlab(slabIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set((slabIds ?? []).filter((s) => typeof s === "string" && s !== ""))];
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  // ── AN ORDER'S OWN PIECES ARE NOT A TAKE-OFF ────────────────────────────
  //
  // This number exists to say "stone left this slab by some route other than
  // the rows allocated to it". Two things write sampling_intake now, and only
  // one of them is that:
  //
  //   OFFCUT   the supervisor recorded loose pieces off a slab. Nothing else
  //            in the system knows about them, so they must be counted here or
  //            the slab reads emptier than it is. No fab_piece points at them.
  //   ORDERED  a SAMPLE project's piece was packed and credited the shelf.
  //            That piece is already on this slab through its requirement
  //            allocation and its area is already inside usedAreaSqft.
  //            fab_piece.sampling_intake_id points at the intake it created.
  //
  // Counting the second kind spends the same square foot twice inside one sum.
  // A 40-piece sample order on a 75 sqft slab read 40 used + 40 sampled = 80
  // committed: a permanent over-committed banner and a negative wastage figure
  // on a slab that had used just over half of itself — and the next real send
  // refused outright.
  //
  // So an intake that a fab_piece claims is excluded. That link IS the question
  // being asked — "has an order already accounted for this stone?" — and it
  // needs no new column to answer.
  let rows: IntakeRow[] = [];
  try {
    rows = await prisma.$queryRaw<IntakeRow[]>`
      SELECT i.source_slab_id, s.length_in, s.width_in, i.quantity
      FROM sampling_intake i
      JOIN sampling_size  s ON s.id = i.size_id
      WHERE i.source_slab_id = ANY(${ids})
        AND NOT EXISTS (
          SELECT 1 FROM fab_piece p WHERE p.sampling_intake_id = i.id
        )
    `;
  } catch {
    // fab_piece.sampling_intake_id arrives in scripts/0059. On a database
    // without it the strict query cannot run — fall back to the old sum rather
    // than reporting no samples at all. That database also has no sample
    // ORDERS, by the same script, so nothing there can be double-counted and
    // the old sum is exactly right on it.
    try {
      rows = await prisma.$queryRaw<IntakeRow[]>`
        SELECT i.source_slab_id, s.length_in, s.width_in, i.quantity
        FROM sampling_intake i
        JOIN sampling_size  s ON s.id = i.size_id
        WHERE i.source_slab_id = ANY(${ids})
      `;
    } catch {
      // 0053 not applied (or sampling_intake absent entirely) — no samples known.
      return out;
    }
  }

  const bySlab = new Map<string, { lengthIn: number; widthIn: number; quantity: number }[]>();
  for (const r of rows) {
    const slabId = String(r.source_slab_id ?? "");
    if (!slabId) continue;
    const list = bySlab.get(slabId) ?? [];
    list.push({
      // NUMERIC comes back as a string or a Decimal depending on the driver;
      // Number() handles both, and sampleAreaSqft discards anything non-finite.
      lengthIn: Number(r.length_in),
      widthIn: Number(r.width_in),
      quantity: Number(r.quantity),
    });
    bySlab.set(slabId, list);
  }

  for (const [slabId, takeoffs] of bySlab) {
    const sqft = sampleAreaSqft(takeoffs);
    if (sqft > 0) out.set(slabId, sqft);
  }
  return out;
}

/** The single-slab case, for approve-slab. Same rule, same rounding. */
export async function sampledAreaForSlab(slabId: string): Promise<number> {
  const map = await sampledAreaBySlab([slabId]);
  return map.get(slabId) ?? 0;
}
