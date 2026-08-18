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
// Gate: inventoryGate() -- the same gate as the table these values filter, which SALES
// fails and COMMERCIAL passes. PI and customer are already present on every row the list
// API returns (it applies no `select`), so those two are not new information; the
// approval filter above is what keeps the rest honest.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { approvedOnlyWhere } from "@/lib/inventory/searchWhere";
import { customerKey } from "@/lib/inventory/filterValues";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;

const clean = (xs: any[], field: string): string[] =>
  xs.map((r) => r[field]).filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "");

export async function GET() {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    // Same visibility rule as the slab list: admins may see pending stock, nobody else.
    const base: any = (await isAdmin()) ? {} : await approvedOnlyWhere({});

    // groupBy, not findMany({distinct}) -- Prisma does not push `distinct` down to SQL,
    // so findMany pulled ~56,000 rows per request to produce a few hundred strings.
    // groupBy emits a real GROUP BY.
    const by = (field: string) =>
      db.finishedSlab.groupBy({ by: [field], where: { ...base, [field]: { not: null } }, _count: { _all: true } });

    const [thick, grade, bay, pi, cust, design, aliases] = await Promise.all([
      by("slabThickness"), by("grade"), by("bayNumber"), by("reservedForPi"), by("customer"), by("design"),
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
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

    return Response.json({
      thicknesses: clean(thick, "slabThickness").sort((a, b) => a.localeCompare(b)),
      grades: clean(grade, "grade").sort((a, b) => a.localeCompare(b)),
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
