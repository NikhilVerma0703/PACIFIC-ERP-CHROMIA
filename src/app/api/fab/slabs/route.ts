// GET /api/fab/slabs?search=&thickness=&limit=
// Returns PolishQc slabs that have passed QC and are available for fabrication.
// Populates the supervisor's slab picker (Cut Queue, Planning Board, and the
// project allocation view).
//
// A slab is "available" when:
//   - it is not currently on the rework line (see REWORK_PENDING below)
//   - dispatchStatus is null/empty OR not "Dispatched" (not yet shipped out)
//   - slabNumber is present
//
// WHY THIS IS PAGED. This used to select every matching PolishQc row with no
// take and no search: 43,618 rows / ~8.4 MB of JSON on every load of
// /fab/supervisor. That is over Vercel's 4.5 MB serverless response cap, so the
// function's own reply is what failed — the picker showed nothing, or the screen
// sat on "Loading..." forever. The picker has always had a search box; it just
// filtered a list the browser had to download in full first. Searching here
// instead means the wire only ever carries a screenful.
//
// Ordering is slabNumber DESCENDING — newest stock first. Ascending order with a
// cap would offer the 200 lowest slab numbers in the factory's history (slab 1
// upwards, from July 2025) and hide everything made since.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import type { Prisma } from "@prisma/client";
import { parseThicknessMm, thicknessPrefixes } from "@/lib/fab/qcSlabQuery";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// rw_status values seen in the live data, by frequency: "Direct Ok",
// "RW Done Ok", "RW Required and ongoing", "Can't be Reworked", NULL.
//
// The filter here used to be `rwStatus != "RW"`, which reads like it excludes
// rework but matches nothing at all — no row has ever held the bare string "RW",
// so all 3,514 slabs sitting on the rework line were offered as available stock.
// Only the genuinely-pending state is excluded; "Can't be Reworked" is a final
// grade rather than work in progress, and cutting a reject down into small
// pieces is a legitimate thing to do with it, so it stays pickable.
const REWORK_PENDING = "RW Required and ongoing";

export async function GET(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  try {
    const params = new URL(req.url).searchParams;
    const search = (params.get("search") ?? "").trim();
    const thicknessMm = Number(params.get("thickness")) || null;
    const limit = Math.min(Number(params.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);

    // Eligibility only — no search. Both queries below start from this, so the
    // pinned exact match is held to the same rework and thickness rules as the
    // list it sits on top of.
    const baseWhere: Prisma.PolishQcWhereInput = {
      slabNumber: { not: null },
      // Must be an OR: `NOT: { equals }` also drops NULLs in SQL, and 686 rows
      // have no rw_status at all.
      OR: [{ rwStatus: null }, { rwStatus: { not: REWORK_PENDING } }],
    };

    if (thicknessMm) {
      baseWhere.AND = [{
        OR: thicknessPrefixes(thicknessMm).map((p) => ({
          slabThickness: { startsWith: p },
        })),
      }];
    }

    const where: Prisma.PolishQcWhereInput = { ...baseWhere };

    if (search) {
      // Slab number is a Float column, so it only participates when the operator
      // typed digits; otherwise this is a text search over colour/SKU/batch.
      const asNumber = Number(search);
      const searchOr: Prisma.PolishQcWhereInput[] = [
        { design: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { batchKey: { contains: search, mode: "insensitive" } },
        { batchNumber: { contains: search, mode: "insensitive" } },
      ];
      if (!isNaN(asNumber)) searchOr.push({ slabNumber: asNumber });
      where.AND = [...((baseWhere.AND as Prisma.PolishQcWhereInput[]) ?? []), { OR: searchOr }];
    }

    const select = {
      id: true,
      slabNumber: true,
      batchNumber: true,
      design: true,
      slabThickness: true,
      qualityGrade: true,
      dispatchStatus: true,
      rwStatus: true,
      sku: true,
      batchKey: true,
    };

    // Typing a slab number is what this picker is FOR, so an exact match is
    // pulled out and pinned to the top rather than left to compete on slab
    // number with everything whose batch or colour merely contains those
    // digits. Without this the cap works against the search: "20" matches
    // thousands of batch keys, the page fills with slabs numbered in the
    // millions, and slab 20 itself is cut off the bottom — the operator
    // searches for a slab that is in stock and is told it does not exist.
    const exactNumber = search && !isNaN(Number(search)) ? Number(search) : null;
    const exact = exactNumber === null ? [] : await prisma.polishQc.findMany({
      where: { ...baseWhere, slabNumber: exactNumber },
      select,
      orderBy: { slabNumber: "desc" },
      take: 10,
    });

    const rest = await prisma.polishQc.findMany({
      where,
      select,
      orderBy: { slabNumber: "desc" },
      take: limit,
    });

    const seen = new Set(exact.map((s) => s.id));
    const qcSlabs = [...exact, ...rest.filter((s) => !seen.has(s.id))].slice(0, limit);

    // Filter out already-dispatched slabs, then hold the picker's exact
    // thickness rule (the SQL prefix above is deliberately loose).
    const available = qcSlabs.filter((s) => {
      const dispatched =
        s.dispatchStatus &&
        (s.dispatchStatus.toLowerCase() === "dispatched" ||
          s.dispatchStatus.toLowerCase() === "yes");
      if (dispatched) return false;
      if (thicknessMm && parseThicknessMm(s.slabThickness) !== thicknessMm) return false;
      return true;
    });

    return Response.json(
      available.map((s) => ({
        // id used by erp-v4 as the "pacificQcId" reference
        pacificQcId: s.id,
        // slabCode = slab number as string (e.g. "1350")
        slabCode: String(s.slabNumber),
        batchKey: s.batchKey ?? s.batchNumber ?? null,
        // design = colour/material in erp-v4 terms
        colour: s.design ?? s.sku ?? null,
        material: s.sku ?? null,
        thicknessMm: parseThicknessMm(s.slabThickness),
        qualityGrade: s.qualityGrade ?? null,
        // Standard quartz slab dimensions in mm (3200 × 1600)
        length: 3200,
        width: 1600,
        source: "pacific_qc" as const,
      }))
    );
  } catch (error) {
    console.error("[fab/slabs]", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
