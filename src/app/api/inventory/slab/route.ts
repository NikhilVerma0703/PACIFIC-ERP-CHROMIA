// Single-slab detail: the inventory row (with derived sqft/sqm/age), its latest
// QC record, and its full event history. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";

const db = prisma as any;
const SQFT_TO_SQM = 0.092903;

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    const raw = (new URL(request.url).searchParams.get("number") ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) return Response.json({ error: "Slab # must be a number" }, { status: 400 });

    const [slab, qc, events] = await Promise.all([
      db.finishedSlab.findUnique({ where: { slabNumber: n } }),
      db.polishQc.findFirst({
        where: { slabNumber: n },
        orderBy: [{ createdTime: "desc" }, { importedAt: "desc" }],
        select: {
          design: true, batchNumber: true, qualityGrade: true, qualityIssue: true,
          slabThickness: true, rwStatus: true, repolishStatus: true, inspector: true,
          bay: true, polishType: true, topPolish: true, bottomPolish: true, createdTime: true,
        },
      }),
      db.slabEvent.findMany({ where: { slabNumber: n }, orderBy: { at: "desc" }, take: 100 }),
    ]);
    if (!slab && !qc) return Response.json({ error: "Slab not found" }, { status: 404 });

    let derived = null;
    if (slab) {
      const sqft = ((slab.lengthIn ?? 0) * (slab.widthIn ?? 0)) / 144;
      const ageDays = slab.firstSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(slab.firstSeenAt).getTime()) / 86400000)) : null;
      derived = { ...slab, sqft: Math.round(sqft * 100) / 100, sqm: Math.round(sqft * SQFT_TO_SQM * 100) / 100, ageDays };
    }
    return Response.json({ slab: derived, qc, events });
  } catch (e) {
    console.error("Inventory slab detail error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
