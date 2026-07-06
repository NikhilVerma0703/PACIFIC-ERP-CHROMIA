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
  if (q("thickness")) where.slabThickness = q("thickness");
  if (q("grade")) where.grade = q("grade");
  if (q("bay")) where.bayNumber = { contains: q("bay"), mode: "insensitive" };
  if (q("status")) where.status = q("status");
  if (q("rw") === "1") where.rwStatus = "RW Required and ongoing";
  if (q("slab")) {
    const n = Number(q("slab"));
    if (Number.isFinite(n)) where.slabNumber = n;
    else where.barcode = { contains: q("slab"), mode: "insensitive" }; // non-numeric -> barcode search
  }
  return where;
}
