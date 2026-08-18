import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

async function resolveOrImportSlab(slabId: string, projectId: string | null): Promise<string> {
  if (!slabId.startsWith("qc:")) return slabId;
  const qcId = slabId.replace("qc:", "");
  // Scoped to the project on purpose. An unscoped lookup returned the FabSlab a
  // DIFFERENT project had already imported for this physical slab, so the
  // allocation was written against another project's slab — and then
  // /api/fab/slab-allocation?projectId=<this one> could not see it, which looks
  // exactly like "the supervisor's assignment did not save".
  const existing = await prisma.fabSlab.findFirst({
    where: { pacificQcId: qcId, ...(projectId ? { projectId } : {}) },
  });
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

/** POST — two modes:
 *  mode="replace" (default): clear all allocations for requirement, create one new one
 *  mode="add":               append a new allocation without touching existing ones
 */
export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const { requirementId, slabId, allocatedQuantity, mode } = await req.json();
  if (!requirementId || !slabId) return Response.json({ error: "requirementId and slabId required" }, { status: 400 });

  const reqRow = await prisma.fabRequirement.findUnique({
    where: { id: requirementId },
    select: { projectId: true },
  });

  // resolveOrImportSlab throws on a QC id that no longer resolves (a slab picked
  // from a list this tab loaded ten minutes ago). Uncaught it became a framework
  // 500 with an HTML body, which the board could only report as "error 500".
  let resolvedSlabId: string;
  try {
    resolvedSlabId = await resolveOrImportSlab(slabId, reqRow?.projectId ?? null);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not resolve that slab" }, { status: 422 });
  }

  if (mode !== "add") {
    // Replace mode: clear existing allocations first
    await prisma.fabRequirementAllocation.deleteMany({ where: { requirementId } });
  }

  const allocation = await prisma.fabRequirementAllocation.create({
    data: { requirementId, slabId: resolvedSlabId, allocatedQuantity: allocatedQuantity ?? 1 },
    include: { slab: true },
  });
  await prisma.fabRequirement.update({ where: { id: requirementId }, data: { status: "ALLOCATED" } });
  return Response.json({ success: true, allocation });
}

/** PATCH — update quantity of a specific allocation */
export async function PATCH(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const { allocationId, allocatedQuantity } = await req.json();
  if (!allocationId) return Response.json({ error: "allocationId required" }, { status: 400 });
  const allocation = await prisma.fabRequirementAllocation.update({
    where: { id: allocationId },
    data: { allocatedQuantity },
  });
  return Response.json({ success: true, allocation });
}

/** DELETE — by allocationId (remove one) or requirementId (clear all) */
export async function DELETE(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const { searchParams } = new URL(req.url);
  const allocationId  = searchParams.get("allocationId");
  const requirementId = searchParams.get("requirementId");

  if (allocationId) {
    // Remove just this one allocation
    const alloc = await prisma.fabRequirementAllocation.delete({ where: { id: allocationId } });
    // If no allocations left, mark requirement as PENDING
    const remaining = await prisma.fabRequirementAllocation.count({ where: { requirementId: alloc.requirementId } });
    if (remaining === 0) {
      await prisma.fabRequirement.update({ where: { id: alloc.requirementId }, data: { status: "PENDING" } });
    }
    return Response.json({ success: true });
  }

  if (requirementId) {
    await prisma.fabRequirementAllocation.deleteMany({ where: { requirementId } });
    await prisma.fabRequirement.update({ where: { id: requirementId }, data: { status: "PENDING" } });
    return Response.json({ success: true });
  }

  return Response.json({ error: "allocationId or requirementId required" }, { status: 400 });
}
