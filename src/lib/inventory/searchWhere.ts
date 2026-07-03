// Shared filter builder for the inventory search + KPI routes, so the KPI
// cards always describe exactly what the table shows.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;

export async function buildInventoryWhere(searchParams: URLSearchParams): Promise<any> {
  const q = (k: string) => (searchParams.get(k) ?? "").trim();
  const where: any = {};
  if (q("design")) {
    // alias-aware, both directions: a canonical term finds its merged variants,
    // and a variant term finds its canonical + sibling variants.
    const term = q("design");
    const hits: any[] = await db.designAlias
      .findMany({
        where: { OR: [{ canonical: { contains: term, mode: "insensitive" } }, { variant: { contains: term, mode: "insensitive" } }] },
        select: { variant: true, canonical: true },
      })
      .catch(() => []);
    const canonicals = [...new Set(hits.map((r) => r.canonical))];
    const siblings: any[] = canonicals.length
      ? await db.designAlias.findMany({ where: { canonical: { in: canonicals } }, select: { variant: true } }).catch(() => [])
      : [];
    const names = [...new Set([...canonicals, ...hits.map((r) => r.variant), ...siblings.map((r) => r.variant)])];
    where.OR = [
      { design: { contains: term, mode: "insensitive" } },
      ...(names.length ? [{ design: { in: names, mode: "insensitive" } }] : []),
    ];
  }
  if (q("batch")) where.batchKey = normalizeBatch(q("batch"));
  if (q("thickness")) where.slabThickness = q("thickness");
  if (q("grade")) where.grade = q("grade");
  if (q("bay")) where.bayNumber = { contains: q("bay"), mode: "insensitive" };
  if (q("status")) where.status = q("status");
  if (q("slab")) {
    const n = Number(q("slab"));
    if (Number.isFinite(n)) where.slabNumber = n;
    else where.barcode = { contains: q("slab"), mode: "insensitive" }; // non-numeric -> barcode search
  }
  return where;
}
