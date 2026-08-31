// Shared filter builder for the inventory search + KPI routes, so the KPI
// cards always describe exactly what the table shows.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { NONE, customerKey } from "@/lib/inventory/filterValues";

const db = prisma as any;

export async function buildInventoryWhere(searchParams: URLSearchParams): Promise<any> {
  const q = (k: string) => (searchParams.get(k) ?? "").trim();
  const where: any = {};
  if (q("design")) {
    // Search by the CANONICAL (displayed) name: a term matches a slab when the
    // name it is SHOWN under contains the term. A raw variant that was merged
    // away (e.g. "Arva White Trial" -> "Trial") no longer matches its old text.
    const term = q("design");
    const aliases: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const hit = (v: string) => v.toLowerCase().includes(term.toLowerCase());
    const matchingVariants = aliases.filter((a) => hit(a.canonical)).map((a) => a.variant);
    const nonMatchingVariants = aliases.filter((a) => !hit(a.canonical)).map((a) => a.variant);
    where.AND = [
      {
        OR: [
          { design: { contains: term, mode: "insensitive" } },
          ...(matchingVariants.length ? [{ design: { in: matchingVariants, mode: "insensitive" } }] : []),
        ],
      },
      ...(nonMatchingVariants.length ? [{ design: { notIn: nonMatchingVariants, mode: "insensitive" } }] : []),
    ];
  }
  if (q("batch")) where.batchKey = normalizeBatch(q("batch"));
  // NONE asks for rows where the column is NULL — 922 slabs have no grade and 3,525 no
  // bay, and there was previously no way to filter for either. Empty string still means
  // "any", so this cannot be reached by leaving a filter blank. No row currently holds
  // the literal "__none__", though nothing on the write side rejects it: the slab edit
  // route takes free text for grade, bay and thickness.
  if (q("thickness")) where.slabThickness = q("thickness") === NONE ? null : q("thickness");
  if (q("grade")) where.grade = q("grade") === NONE ? null : q("grade");
  if (q("bay")) where.bayNumber = q("bay") === NONE ? null : { contains: q("bay"), mode: "insensitive" };
  if (q("status")) where.status = q("status");
  // PI is exact: it is picked from values already in the column. Customer is NOT exact —
  // see below. Neither field is new information: the slab list API applies no `select`,
  // so both are already on every row it returns.
  if (q("pi")) where.reservedForPi = q("pi") === NONE ? null : q("pi");
  if (q("customer")) {
    const term = q("customer");
    if (term === NONE) where.customer = null;
    else {
      // Match every spelling that folds to the same customer, not the raw string — see
      // customerKey. Same shape as the design clause above, which resolves variants
      // through DesignAlias for exactly this reason.
      const rows: any[] = await db.finishedSlab
        .findMany({ distinct: ["customer"], select: { customer: true }, where: { customer: { not: null } } })
        .catch(() => []);
      const key = customerKey(term);
      const spellings = rows
        .map((r) => r.customer)
        .filter((c: unknown): c is string => typeof c === "string" && customerKey(c) === key);
      // `in` whenever anything folds to this key -- NOT only when several do. The option
      // label is cleaned for display, so it is not necessarily an exact column value; a
      // customer stored once as "Heda Granites," would match nothing on an exact compare.
      where.customer = spellings.length ? { in: spellings } : term;
    }
  }
  // Where the row CAME FROM — the QC autolink, the bulk upload, or the intake
  // form's hand entry. Exact enum value; the dropdown offers the real three in
  // plant words, so free text cannot reach this.
  if (q("source")) where.source = q("source");
  if (q("rw") === "1") where.rwStatus = "RW Required and ongoing";
  if (q("slab")) {
    const n = Number(q("slab"));
    if (Number.isFinite(n)) where.slabNumber = n;
    else where.barcode = { contains: q("slab"), mode: "insensitive" }; // non-numeric -> barcode search
  }
  return where;
}

/**
 * Slab numbers of UNAPPROVED (pending or master-hidden) stock. Approval is
 * decided per (canonical design, display batch); this resolves it back to the
 * raw rows. Small result in practice (only new/unticked stock).
 */
export async function getUnapprovedSlabNumbers(strict = false): Promise<number[]> {
  try {
    const [combos, aliases, approved, hiddenRows] = await Promise.all([
      db.$queryRaw`SELECT DISTINCT design, batch_number AS batch FROM fg_finished_slab`,
      db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []),
      db.$queryRaw`SELECT design, batch FROM fg_sales_approved_batch`,
      db.$queryRaw`SELECT design FROM fg_sales_hidden_design WHERE batch = ''`,
    ]);
    const amap = new Map<string, string>((aliases as any[]).map((x) => [x.variant, x.canonical]));
    const SEP = "\u0000"; // can never appear in names
    const ok = new Set<string>((approved as any[]).map((a) => `${a.design}${SEP}${a.batch}`));
    const hidden = new Set<string>((hiddenRows as any[]).map((h) => h.design));
    const { displayBatch } = await import("@/lib/batchDisplay");
    const pendingPairs: { design: string | null; batch: string | null }[] = [];
    for (const c of combos as any[]) {
      const canon = amap.get(c.design ?? "(no design)") ?? (c.design ?? "(no design)");
      const disp = c.batch == null ? "-" : displayBatch(c.batch);
      if (hidden.has(canon) || !ok.has(`${canon}${SEP}${disp}`)) pendingPairs.push({ design: c.design ?? null, batch: c.batch ?? null });
    }
    if (!pendingPairs.length) return [];
    const rows: any[] = await db.finishedSlab.findMany({
      where: { OR: pendingPairs.map((p) => ({ design: p.design, batchNumber: p.batch })) },
      select: { slabNumber: true },
    });
    return rows.map((r) => r.slabNumber);
  } catch (e) {
    if (strict) throw e; // WRITE routes must fail CLOSED
    return [];           // read views degrade to showing approved-known state
  }
}

/** Wrap a where clause so unapproved stock is excluded (approved-only view).
 *
 *  `strict` decides what a failed approval read means. Default (false): the
 *  view degrades to approved-known state — right for inventoryGate audiences,
 *  who may see pending stock anyway. A SALES-facing caller must pass true: for
 *  that audience "could not read the approval list" has to fail CLOSED (throw,
 *  route answers 500), because degrading OPEN would show unapproved and
 *  admin-hidden stock to exactly the audience approval exists to shield. */
export async function approvedOnlyWhere(where: any, opts?: { strict?: boolean }): Promise<any> {
  const pending = await getUnapprovedSlabNumbers(opts?.strict ?? false);
  if (!pending.length) return where;
  // preserve top-level keys (status etc.) — some callers read them back
  const prevAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...where, AND: [...prevAnd, { slabNumber: { notIn: pending } }] };
}
