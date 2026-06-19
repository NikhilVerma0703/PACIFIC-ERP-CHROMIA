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

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { requirementId, slabId, allocatedQuantity } = await req.json();
  const req2 = await prisma.fabRequirement.findUnique({ where: { id: requirementId }, select: { projectId: true } });
  const resolvedSlabId = await resolveOrImportSlab(slabId, req2?.projectId ?? null);
  await prisma.fabRequirementAllocation.deleteMany({ where: { requirementId } });
  const allocation = await prisma.fabRequirementAllocation.create({
    data: { requirementId, slabId: resolvedSlabId, allocatedQuantity: allocatedQuantity ?? 1 },
  });
  await prisma.fabRequirement.update({ where: { id: requirementId }, data: { status: "ALLOCATED" } });
  return Response.json({ success: true, allocation });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const requirementId = searchParams.get("requirementId");
  if (!requirementId) return Response.json({ error: "requirementId required" }, { status: 400 });
  await prisma.fabRequirementAllocation.deleteMany({ where: { requirementId } });
  await prisma.fabRequirement.update({ where: { id: requirementId }, data: { status: "PENDING" } });
  return Response.json({ success: true });
}
