// Single-slab detail: the inventory row (with derived sqft/sqm/age), its latest
// QC record, and its full event history. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import { photosForRecord } from "@/lib/entryPhoto";
import { isAdmin, isCommercialRole } from "@/lib/rbac";

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
          id: true, design: true, batchNumber: true, qualityGrade: true, qualityIssue: true,
          slabThickness: true, rwStatus: true, repolishStatus: true, inspector: true,
          bay: true, polishType: true, topPolish: true, bottomPolish: true, createdTime: true,
        },
      }),
      db.slabEvent.findMany({ where: { slabNumber: n }, orderBy: { at: "desc" }, take: 100 }),
    ]);
    if (!slab && !qc) return Response.json({ error: "Slab not found" }, { status: 404 });
    if (slab && !(await isAdmin())) {
      const unapproved = await getUnapprovedSlabNumbers();
      if (unapproved.includes(n)) return Response.json({ error: "Slab not found" }, { status: 404 });
    }

    let derived = null;
    if (slab?.design) {
      slab.designRaw = slab.design; // raw stored value (edits must not silently canonicalize)
      const al = await db.designAlias.findUnique({ where: { variant: slab.design } }).catch(() => null);
      if (al) slab.design = al.canonical;
    }
    if (slab) {
      const sqft = ((slab.lengthIn ?? 0) * (slab.widthIn ?? 0)) / 144;
      const ageDays = slab.firstSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(slab.firstSeenAt).getTime()) / 86400000)) : null;
      derived = { ...slab, sqft: Math.round(sqft * 100) / 100, sqm: Math.round(sqft * SQFT_TO_SQM * 100) / 100, ageDays };
    }
    // THE SLAB'S OWN PHOTOS. The intake form stores a far and a near shot of
    // the defect against the FinishedSlab row (entry_photo, prefixes far-/
    // near-), and until now the only way to see them was to look the slab up
    // again in that form — so the people who read inventory never saw them.
    // Sorted into slots by the filename prefix saveRequiredPhoto writes;
    // best-effort, like every other photo read.
    const photos: { id: string; filename: string; slot: "far" | "near" | "other" }[] = slab
      ? (await photosForRecord("FinishedSlab", slab.id)).map((p: any) => {
          const filename = String(p.filename ?? "");
          return {
            id: String(p.id), filename,
            slot: filename.startsWith("far-") ? "far" : filename.startsWith("near-") ? "near" : "other",
          };
        })
      : [];

    // dispatch invoice (visible to Commercial + Admin)
    let invoice = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = String((g.user as any)?.role ?? "");
    if (role === "ADMIN" || isCommercialRole(role)) {
      const inv: any[] = await db.$queryRaw`SELECT id, pi, customer, filename, at FROM fg_dispatch_invoice WHERE ${n} = ANY(slab_numbers) ORDER BY at DESC LIMIT 1`.catch(() => []);
      if (inv.length) invoice = inv[0];
    }
    return Response.json({ slab: derived, qc, events, invoice, photos });
  } catch (e) {
    console.error("Inventory slab detail error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
