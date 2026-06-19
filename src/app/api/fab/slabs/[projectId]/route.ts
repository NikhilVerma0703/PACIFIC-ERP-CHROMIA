import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(req: Request, { params }: { params: { projectId: string } }) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const localSlabs = await prisma.fabSlab.findMany({
    where: { projectId: params.projectId },
    orderBy: { createdAt: "desc" },
  });

  // QC slabs from Pacific-ERP directly (same DB)
  const qcSlabs = await prisma.polishQc.findMany({
    where: { slabNumber: { not: null }, NOT: { rwStatus: "RW" } },
    select: { id: true, slabNumber: true, design: true, slabThickness: true, qualityGrade: true, dispatchStatus: true },
    orderBy: { slabNumber: "asc" },
  });

  const available = qcSlabs.filter(s => !s.dispatchStatus || !["dispatched","yes"].includes(s.dispatchStatus.toLowerCase()));
  const localCodes = new Set(localSlabs.map(s => s.slabCode));

  const qcMapped = available
    .filter(q => !localCodes.has(String(q.slabNumber)))
    .map(q => ({
      id: `qc:${q.id}`, slabCode: String(q.slabNumber), colour: q.design, material: null,
      thickness: null, length: 3200, width: 1600, totalArea: 3200 * 1600, availableArea: 3200 * 1600,
      qualityGrade: q.qualityGrade, pacificQcId: q.id, source: "pacific_qc", projectId: null, createdAt: null,
    }));

  return Response.json([...localSlabs, ...qcMapped]);
}
