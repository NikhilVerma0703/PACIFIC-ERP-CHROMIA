// Distinct values actually present in fg_finished_slab, for the inventory filter row.
//
// These lists used to be hardcoded in InventoryDashboard and had drifted from the data:
// the thickness list omitted "3 cm to 2 cm", "2 cm to 1 cm" and "2cm to 8mm", so 287 slabs
// could not be reached by that filter at all (buildInventoryWhere matches thickness
// exactly), while it offered "7 mm", which no slab has. Reading the values back means the
// filter cannot drift from the column again.
//
// TWO THINGS THIS MUST NOT DO, both learned the hard way:
//
//  1. Do not enumerate values off stock the caller cannot see. Non-admins get an
//     approved-only view (approvedOnlyWhere), and some values exist ONLY on unapproved
//     rows -- including designs sitting in fg_sales_hidden_design, which an admin
//     deliberately master-hid. Every list below is therefore built through the same
//     approval filter the table itself uses. Note the caveat: an ADMIN bypasses that
//     filter here but their table applies it unless they tick "show unapproved stock", so
//     an admin can be offered a handful of options their default view returns nothing for.
//     Non-admins, who cannot see that stock at all, are never offered it.
//  2. Do not offer raw design names. buildInventoryWhere matches designs by CANONICAL
//     name and explicitly excludes merged-away variants, so most raw values are dead
//     terms that would return nothing. The list is mapped through DesignAlias and
//     deduped, which is also what makes it a usable length.
//
// Gate: inventoryReadGate() -- the same gate as the table these values filter, which SALES
// fails and COMMERCIAL passes, and which a finished-goods view grant passes for the same
// reason it passes the table. PI and customer are already present on every row the list
// API returns (it applies no `select`), so those two are not new information; the
// approval filter above is what keeps the rest honest.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryReadGate } from "@/lib/inventory/access";
import { approvedOnlyWhere, slabMarkAvailable, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { customerKey } from "@/lib/inventory/filterValues";
import { CUT_GRADES } from "@/lib/inventory/grading";
import { SLAB_MARKS } from "@/lib/fab/slabMark";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;

// ─────────────────────────────── AND THE MARK, FROM 2026-09-03 ──────────────
//
// THE OPTION THAT WAS ABOUT TO VANISH. Every list on this route is read back
// off live rows, which is exactly what makes it honest — and exactly what makes
// it fail here. "CTS" appears in the grade dropdown today only because 62 slabs
// still carry grade='CTS' (60 on the floor, 2 dispatched — measured on live
// Neon 2026-09-03). Fabrication is about to stop writing that grade and record
// the fact in fg_finished_slab.slab_mark instead, so the day the last legacy
// row is regraded to its real A/B/C the CTS option would simply stop being
// offered — and with it the only way anyone had to find a cut slab from the
// filter row. Hence `marks`.
//
// WHAT MAY BE OFFERED. The same discipline as every other list here: an option
// is offered only if something can come back from it. So the mark list is the
// live mark values, PLUS any cut value the GRADE column still carries — because
// buildInventoryWhere resolves a cut filter to `grade = X OR mark = X`, so a
// database whose marks are all still FULL_SLAB (or that has no mark column at
// all) really can answer "CTS" with those 62 rows. Nothing is invented: SAMPLE
// is not offered today because no slab anywhere reads SAMPLE, in either column.

/** The offerable mark values, in state order (FULL_SLAB, CTS, SAMPLE) rather
 *  than alphabetical — the three are a progression, not a list of names. */
function offerableMarks(markValues: string[], gradeValues: string[], hasMarkColumn: boolean): string[] {
  const offer = new Set<string>(markValues);
  // A cut GRADE is a cut slab, whatever the mark column says or does not say.
  for (const g of gradeValues) {
    const up = g.trim().toUpperCase();
    if ((CUT_GRADES as readonly string[]).includes(up)) offer.add(up);
  }
  // ═════ NO COLUMN, NO OPTIONS — AND FULL_SLAB IS NOT THE EXCEPTION ══════════
  //
  // This used to end `if (!hasMarkColumn) offer.add("FULL_SLAB")`, with the
  // reason: "no live marks to read, but the 'still whole' filter degrades to
  // `grade IS NULL OR grade NOT IN (cut)` and answers with all but 62 of the
  // ~23,000 slabs on the table. Offering it is not a guess."
  //
  // THAT DEGRADE NO LONGER EXISTS. scripts/0071 and 0072 regraded all 63 cut
  // slabs from 'CTS' to 'B' (re-measured on live Neon 2026-09-03: zero rows
  // anywhere carry grade 'CTS' or 'SAMPLE', 63 carry slab_mark 'CTS', 61 of
  // them on the floor), so the grade-only "still whole" test calls all 61
  // already-cut slabs whole. searchWhere.wholeSlabWhere and cutSignalWhere
  // therefore THROW without the mark instead of degrading, and
  // /api/inventory/summary answers 503 to any `mark=` it cannot honour —
  // FULL_SLAB included, because a filter that is the exact complement of a
  // wrong answer is just as wrong.
  //
  // So on a checkout where prisma generate has not re-run, this returned
  // `marks: ['FULL_SLAB']` — a list of length 1, which is exactly the signal
  // StockByDesign and the slab table read as "the server knows the word, draw
  // the select". Both drew a mark select offering the single value that gets a
  // 503, and the register re-issued that known-failing request on its 30s poll
  // and on every focus. An empty list is the honest answer: the option is
  // hidden, and it lights up by itself the moment the column is readable again.
  if (!hasMarkColumn) return [];
  return SLAB_MARKS.filter((m) => offer.has(m));
}

const clean = (xs: any[], field: string): string[] =>
  xs.map((r) => r[field]).filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "");

export async function GET() {
  const g = await inventoryReadGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    // Same visibility rule as the slab list: admins may see pending stock, nobody else.
    const base: any = (await isAdmin()) ? {} : await approvedOnlyWhere({});

    // groupBy, not findMany({distinct}) -- Prisma does not push `distinct` down to SQL,
    // so findMany pulled ~56,000 rows per request to produce a few hundred strings.
    // groupBy emits a real GROUP BY.
    const by = (field: string) =>
      db.finishedSlab.groupBy({ by: [field], where: { ...base, [field]: { not: null } }, _count: { _all: true } });

    // The mark groupBy runs ONLY once the probe says the column is there, and
    // still catches a miss: the probe answers per process and the migration can
    // land (or a client be regenerated) between the two, and an unguarded
    // groupBy on a missing column would 500 the whole filter row — killing the
    // thickness, grade, bay, PI, customer and design dropdowns over a column
    // that has not shipped yet. Same approval gate (`base`) as every other list
    // here, so the mark list cannot enumerate stock the caller may not see.
    const hasMark = await slabMarkAvailable();
    const [thick, grade, bay, pi, cust, design, aliases, mark] = await Promise.all([
      by("slabThickness"), by("grade"), by("bayNumber"), by("reservedForPi"), by("customer"), by("design"),
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
      hasMark
        ? db.finishedSlab
            .groupBy({ by: ["slabMark"], where: base, _count: { _all: true } })
            .catch((e: any) => { if (!isMissingSlabMarkError(e)) throw e; return []; })
        : Promise.resolve([]),
    ]);

    // Lower-cased keys: buildInventoryWhere excludes merged-away variants case-INsensitively,
    // so a case-sensitive map here would leave e.g. "Honey dew" unmapped against the variant
    // "Honey Dew" and offer it as a search that returns nothing.
    const amap = new Map<string, string>((aliases as any[]).map((a) => [String(a.variant).toLowerCase(), a.canonical]));
    const canonSeen = new Map<string, string>();
    for (const d of clean(design, "design")) {
      const c = amap.get(d.toLowerCase()) ?? d;
      // Dedupe case-insensitively too: "Sakura"/"SAKURA" search identically, so offering
      // both is two options for one result set.
      if (!canonSeen.has(c.toLowerCase())) canonSeen.set(c.toLowerCase(), c);
    }
    const designs = [...canonSeen.values()].sort((a, b) => a.localeCompare(b));

    // One option per customer, not per spelling: the column holds the same customer under
    // several ("Surfaces by Pacific" / "SURFACES BY PACIFIC" / "Surfaces by Pacific,").
    // Offer the spelling carrying the most slabs; buildInventoryWhere folds the rest onto
    // it, so whichever is shown returns the customer's whole stock.
    const custBest = new Map<string, { label: string; n: number }>();
    for (const r of cust as any[]) {
      const v = r.customer;
      if (typeof v !== "string" || v.trim() === "") continue;
      const k = customerKey(v);
      const n = r._count?._all ?? 0;
      const cur = custBest.get(k);
      if (!cur || n > cur.n) custBest.set(k, { label: v, n });
    }
    // Trailing dots/commas trimmed for display — "Surfaces by Pacific," reads badly in a
    // dropdown. Safe because buildInventoryWhere folds the submitted value to a key and
    // matches every spelling under it, so the label need not be an exact column value.
    const customers = [...custBest.values()]
      .map((x) => x.label.trim().replace(/[.,\s]+$/, ""))
      .sort((a, b) => a.localeCompare(b));

    const pis = clean(pi, "reservedForPi");
    // PIs read as numbers to the people using them, so sort them that way -- newest first.
    // Anything non-numeric (the data does contain one) sorts to the end by name.
    pis.sort((a, b) => {
      const na = Number(a), nb = Number(b);
      const aNum = a.trim() !== "" && Number.isFinite(na);
      const bNum = b.trim() !== "" && Number.isFinite(nb);
      if (aNum && bNum) return nb - na;
      if (aNum !== bNum) return aNum ? -1 : 1;
      return a.localeCompare(b);
    });

    const grades = clean(grade, "grade").sort((a, b) => a.localeCompare(b));
    return Response.json({
      thicknesses: clean(thick, "slabThickness").sort((a, b) => a.localeCompare(b)),
      // The GRADE list is left exactly as it was — additive only. It still
      // offers CTS while the 62 legacy rows carry it, and simply stops when the
      // owner has replaced them with the real verdicts he is collecting by
      // hand. `marks` is what carries the option forward from then on.
      grades,
      marks: offerableMarks(clean(mark, "slabMark"), grades, hasMark),
      bays: clean(bay, "bayNumber").sort((a, b) => a.localeCompare(b)),
      pis,
      customers,
      designs,
    });
  } catch (e) {
    console.error("Inventory filter values error:", e);
    // 500 so the client can tell failure from "no data" — it keeps its own fallbacks for
    // thickness, grade and bay, and shows the PI/customer selects as unavailable.
    return Response.json({ error: "Could not load filter values" }, { status: 500 });
  }
}
