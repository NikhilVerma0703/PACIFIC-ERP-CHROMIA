import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { drawingId, slabId, projectId } = await req.json();
  if (!drawingId || !slabId) return Response.json({ error: "drawingId and slabId required" }, { status: 400 });

  // Same reason as allocate-requirement: a QC id that no longer resolves must
  // come back as a sentence the supervisor can read, not a framework 500.
  let resolvedSlabId: string;
  try {
    resolvedSlabId = await resolveOrImportSlab(slabId, projectId ?? null);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not resolve that slab" }, { status: 422 });
  }

  await prisma.fabDrawing.update({ where: { id: drawingId }, data: { defaultSlabId: resolvedSlabId } });
  return Response.json({ success: true, slabId: resolvedSlabId });
}

async function resolveOrImportSlab(slabId: string, projectId: string | null): Promise<string> {
  if (!slabId.startsWith("qc:")) return slabId;
  const qcId = slabId.replace("qc:", "");
  const existing = await prisma.fabSlab.findFirst({ where: { pacificQcId: qcId, ...(projectId ? { projectId } : {}) } });
  if (existing) return existing.id;
  const qc = await prisma.polishQc.findUnique({ where: { id: qcId } });
  if (!qc) throw new Error("QC slab not found");
  let pid = projectId;
  if (!pid) {
    const fb = await prisma.fabProject.findFirst({ where: { projectCode: "UNASSIGNED" } });
    pid = fb?.id ?? (await prisma.fabProject.create({ data: { projectCode: "UNASSIGNED", customerName: "QC Import" } })).id;
  }
  const slab = await prisma.fabSlab.create({
    data: {
      projectId: pid, slabCode: String(qc.slabNumber), colour: qc.design, pacificQcId: qc.id,
      thickness: qc.slabThickness ? parseFloat(qc.slabThickness) * 10 : null,
      length: 3200, width: 1600, totalArea: 3200 * 1600, availableArea: 3200 * 1600,
    },
  });
  return slab.id;
}
