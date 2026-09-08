// The distinct finished-goods design names, as the design picker and the
// design-master seed both need them. Not a route.
//
// Names are mapped to their canonical spelling through fg_design_alias and
// de-duplicated case-blind, so "Carrara Royale" and "CARRARA ROYALE" are one
// entry — the search that follows canonicalises too, and the design master's
// primary key is the design name, so a second spelling would be a second row.
//
// The alias table is read ONCE and applied in memory rather than calling
// canonicalDesign per name: that helper is a findUnique on fg_design_alias
// keyed by the exact variant, so a single findMany plus a Map is the same
// answer without several hundred round trips to Neon.
//
// SALES-APPROVED STOCK ONLY FOR A NON-ADMIN, THE SAME FILTER THE SLAB SEARCH
// APPLIES. The picker used to skip it, and a picker is not a harmless list: it
// is the whole vocabulary of the stock check. Measured on live Neon 2026-09-06
// the unfiltered list offered 161 designs where a non-admin may see 144 —
// among them 'Artemis', which an admin had explicitly hidden from sales-facing
// audiences (fg_sales_hidden_design), and 16 more whose only AVAILABLE stock
// sits in an unapproved (design, batch) pair. Picking one of those returned an
// empty search, which reads as "we are out of it" rather than "you may not see
// it" — and taught the user to distrust the answer.
//
// The filter is per SLAB, not per design (approval is decided per (canonical
// design, display batch)), so the query reads design + slabNumber and the
// approval set is applied in memory. A `notIn` of the pending numbers would
// mean a 10,000-element IN list on today's data — one wide read of two columns
// is cheaper and does not grow a query string.
import { prisma } from "@/lib/prisma";
import { getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export async function listStockDesigns(opts: { isAdmin: boolean; availableOnly: boolean }): Promise<string[]> {
  const where: Record<string, unknown> = { design: { not: null } };
  if (opts.availableOnly) where.status = "AVAILABLE";
  const [rows, aliases, unapproved] = await Promise.all([
    db.finishedSlab.findMany({ where, select: { design: true, slabNumber: true } }),
    db.designAlias.findMany({ select: { variant: true, canonical: true } }),
    // strict=true: a list built from a failed approval read would offer the
    // whole yard to exactly the audience approval exists to shield, so the
    // caller errors instead. Same call, same argument, as the slab search.
    opts.isAdmin ? Promise.resolve([] as number[]) : getUnapprovedSlabNumbers(true),
  ]);
  const hidden = new Set<number>(unapproved as number[]);
  const canonicalOf = new Map<string, string>();
  for (const a of aliases as Array<{ variant: string; canonical: string }>) canonicalOf.set(a.variant, a.canonical);
  const seen = new Map<string, string>();               // lower-cased → as printed
  for (const r of rows as Array<{ design: string | null; slabNumber: number }>) {
    if (hidden.has(Number(r.slabNumber))) continue;
    const raw = (r.design ?? "").trim();
    if (!raw) continue;
    const canonical = (canonicalOf.get(raw) ?? raw).trim();
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (!seen.has(key)) seen.set(key, canonical);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
