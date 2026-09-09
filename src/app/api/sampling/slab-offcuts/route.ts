// WHICH USED SLABS STILL HAVE OFFCUT TO SAMPLE FROM.
//
// The owner: "he should see slab wastage on used slab, then he can click the
// slab and enter the size and quantity, then take from that until it empties."
//
// The sample guy had no such list. /sampling/add-stock says so in its own
// header — "this screen has no slab in front of it" — so the source was a
// free-text "slab or bag number" he typed from memory. Which meant three
// things: he could not see where there was stone to take, the id was often not
// recorded at all (so fabrication never learned the stone had gone), and
// nothing measured the take against what was left.
//
// ─────────────────────────── WHAT COUNTS AS A "USED SLAB" ───────────────────
// A slab with pieces allocated to it. That is the owner's word — "used slab" —
// and it is the right rule: an untouched slab is not offcut, it is stock, and
// taking samples out of it is a different decision that belongs to the
// supervisor (the sample-cut control on his board).
//
// Slabs with NOTHING LEFT ARE STILL RETURNED, marked empty. He asked to take
// "until it empties", so the emptying has to be visible — a slab that silently
// vanishes off the list looks like a slab somebody deleted.
//
// ─────────────────────────── NO ARITHMETIC HERE ─────────────────────────────
// The area rule is lib/sampling/slabOffcut.ts and the sample take-off is
// lib/fab/sampledArea.ts — the same two the intake route and the fabrication
// board read. This route only assembles them, so the number on his screen is
// the number the write will be checked against.

import { prisma } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";
import { sampledAreaBySlab } from "@/lib/fab/sampledArea";
import { sqftFromInches, sqftFromSqMm } from "@/lib/fab/slabLoss";
import { offcutRemaining } from "@/lib/sampling/slabOffcut";

export async function GET() {
  // "addStock", NOT the default "view".
  //
  // This list exists to be TAKEN FROM, and /api/sampling/intake gates on
  // addStock — so gating it looser would show a read-only user a screen of
  // slabs, project codes and areas he cannot act on, and widen the read for no
  // one's benefit. Named explicitly for the reason the intake route gives at
  // the head of its own file: samplingGate()'s default is "view", and letting
  // a write-adjacent screen take the default is how a gate drifts open.
  const g = await samplingGate("addStock");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  try {
    // USED SLABS ONLY — `some: {}` is "has at least one allocation".
    const slabs = await prisma.fabSlab.findMany({
      where: {
        requirementAllocations: { some: {} },
        // A completed project's stone is gone; offering it would send him to a
        // rack that has already shipped.
        project: { status: { not: "COMPLETED" } },
      },
      select: {
        id: true, slabCode: true, colour: true, thickness: true,
        length: true, width: true,
        project: { select: { projectCode: true } },
        requirementAllocations: {
          select: {
            allocatedQuantity: true,
            requirement: { select: { length: true, width: true } },
          },
        },
      },
      // Deterministic, and re-sorted by what is left below.
      orderBy: [{ slabCode: "asc" }],
    });

    if (!slabs.length) return Response.json({ slabs: [] });

    const sampled = await sampledAreaBySlab(slabs.map((s) => s.id));

    const rows = slabs.map((s) => {
      const slabAreaSqft = s.length && s.width ? sqftFromSqMm(s.length * s.width) : 0;
      const usedAreaSqft = s.requirementAllocations.reduce(
        (sum, a) => sum + sqftFromInches(
          Number(a.requirement?.length ?? 0),
          Number(a.requirement?.width ?? 0),
        ) * Number(a.allocatedQuantity ?? 0),
        0,
      );
      const sampledAreaSqft = sampled.get(s.id) ?? 0;
      const remaining = offcutRemaining({ slabAreaSqft, usedAreaSqft, sampledAreaSqft });
      return {
        slabId: s.id,
        slabCode: s.slabCode,
        colour: s.colour,
        /** MILLIMETRES, as fab_slab stores it. The sample sizes carry their own
         *  thickness, so this is what he matches against. */
        thicknessMm: s.thickness,
        projectCode: s.project?.projectCode ?? null,
        slabAreaSqft: Math.round(slabAreaSqft * 100) / 100,
        usedAreaSqft: Math.round(usedAreaSqft * 100) / 100,
        /** ALREADY TAKEN as samples — the part of the wastage that has been
         *  credited. Only this, never the whole wastage. */
        sampledAreaSqft,
        /** STILL AVAILABLE. What he can take. */
        availableSqft: remaining.availableSqft,
        availablePct: remaining.availablePct,
        empty: remaining.empty,
        overCommitted: remaining.overCommitted,
        pieceCount: s.requirementAllocations.reduce(
          (n, a) => n + Number(a.allocatedQuantity ?? 0), 0),
      };
    });

    // MOST OFFCUT FIRST — the question he is asking is "where can I take from",
    // so the slab with the most to give leads. Empty ones sink to the bottom
    // rather than disappearing. Ties fall back to the code so the order does
    // not reshuffle between two refreshes.
    rows.sort((a, b) =>
      b.availableSqft - a.availableSqft
      || String(a.slabCode ?? "").localeCompare(String(b.slabCode ?? "")));

    return Response.json({ slabs: rows });
  } catch {
    // A database mid-migration must cost this list and nothing else — the same
    // rule sampledArea.ts follows. An empty list reads as "no offcut to take",
    // which is honest rather than wrong.
    return Response.json({ slabs: [] });
  }
}
