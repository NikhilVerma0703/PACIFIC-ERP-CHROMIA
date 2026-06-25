import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

async function resolveOrImportSlab(slabId: string, projectId: string | null): Promise<string> {
  if (!slabId.startsWith("qc:")) return slabId;
  const qcId = slabId.replace("qc:", "");
  const existing = await prisma.fabSlab.findFirst({ where: { pacificQcId: qcId } });
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
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { requirementId, slabId, allocatedQuantity, mode } = await req.json();
  if (!requirementId || !slabId) return Response.json({ error: "requirementId and slabId required" }, { status: 400 });

  const reqRow = await prisma.fabRequirement.findUnique({
    where: { id: requirementId },
    select: { projectId: true },
  });
  const resolvedSlabId = await resolveOrImportSlab(slabId, reqRow?.projectId ?? null);

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
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
