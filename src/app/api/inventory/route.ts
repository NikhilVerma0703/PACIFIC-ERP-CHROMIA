// Finished-goods inventory search. Filters: design (colour), batch, thickness,
// grade, slab number, bay, status. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;
const SQFT_TO_SQM = 0.092903;

function withDerived(r: any) {
  const sqft = ((r.lengthIn ?? 0) * (r.widthIn ?? 0)) / 144;
  return { ...r, sqft: Math.round(sqft * 100) / 100, sqm: Math.round(sqft * SQFT_TO_SQM * 100) / 100 };
}

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const { searchParams } = new URL(request.url);
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
    if (q("slab")) { const n = Number(q("slab")); if (Number.isFinite(n)) where.slabNumber = n; }

    const rows = await db.finishedSlab.findMany({ where, orderBy: { slabNumber: "desc" }, take: 1000 });
    return Response.json(rows.map(withDerived));
  } catch (e) {
    console.error("Inventory search error:", e);
    return Response.json([], { status: 500 });
  }
}
