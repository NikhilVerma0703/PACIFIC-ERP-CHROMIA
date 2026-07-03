// Finished-goods inventory search. Filters: design (colour), batch, thickness,
// grade, slab number, bay, status. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { sweepExpiredReservations } from "@/lib/inventory/finishedSlab";

const db = prisma as any;
const SQFT_TO_SQM = 0.092903;

function withDerived(r: any) {
  const sqft = ((r.lengthIn ?? 0) * (r.widthIn ?? 0)) / 144;
  const ageDays = r.firstSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(r.firstSeenAt).getTime()) / 86400000)) : null;
  return { ...r, sqft: Math.round(sqft * 100) / 100, sqm: Math.round(sqft * SQFT_TO_SQM * 100) / 100, ageDays };
}

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    await sweepExpiredReservations(); // lapsed PI holds -> AVAILABLE before we report
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
    if (q("slab")) {
      const n = Number(q("slab"));
      if (Number.isFinite(n)) where.slabNumber = n;
      else where.barcode = { contains: q("slab"), mode: "insensitive" }; // non-numeric -> barcode search
    }

    // Real slab numbers first (newest on top); NB-series legacy slabs
    // (9,000,000+, no original number) always sort to the BOTTOM.
    const NB_FLOOR = 9000000;
    let rows;
    if (where.slabNumber !== undefined) {
      rows = await db.finishedSlab.findMany({ where, orderBy: { slabNumber: "desc" }, take: 1000 });
    } else {
      const normal = await db.finishedSlab.findMany({
        where: { ...where, slabNumber: { lt: NB_FLOOR } },
        orderBy: { slabNumber: "desc" }, take: 1000,
      });
      const room = 1000 - normal.length;
      const nb = room > 0
        ? await db.finishedSlab.findMany({
            where: { ...where, slabNumber: { gte: NB_FLOOR } },
            orderBy: { slabNumber: "asc" }, take: room,
          })
        : [];
      rows = [...normal, ...nb];
    }
    // display canonical design names (merged variants show their correct name)
    const aliasRows: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const amap = new Map<string, string>(aliasRows.map((x) => [x.variant, x.canonical]));
    rows = rows.map((r: any) => (r.design && amap.has(r.design) ? { ...r, design: amap.get(r.design) } : r));
    return Response.json(rows.map(withDerived));
  } catch (e) {
    console.error("Inventory search error:", e);
    return Response.json([], { status: 500 });
  }
}
