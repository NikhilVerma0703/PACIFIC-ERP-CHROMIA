import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  // ── OLD flow: FabSlabAllocation → FabPiece ──────────────────────────────
  const allocations = await prisma.fabSlabAllocation.findMany({
    include: {
      piece: {
        include: {
          project:     { select: { projectCode: true, customerName: true } },
          drawing:     { select: { drawingNumber: true } },
          requirement: { select: { pieceLabel: true, description: true, length: true, width: true } },
          pieceOperations: { where: { operationType: "CUTTING" } },
        },
      },
      slab: true,
    },
  });

  const pending = allocations.filter(a =>
    a.piece.pieceOperations.some(op => !op.isCompleted)
  );

  const legacyMap = new Map<string, { type: "legacy"; slab: any; pieces: any[] }>();
  for (const alloc of pending) {
    const key = alloc.slabId;
    if (!legacyMap.has(key)) legacyMap.set(key, { type: "legacy", slab: alloc.slab, pieces: [] });
    legacyMap.get(key)!.pieces.push(alloc.piece);
  }

  // ── NEW CLO flow: FabSlabJob (READY / IN_PROGRESS) ──────────────────────
  const slabJobs = await prisma.fabSlabJob.findMany({
    where:   { status: { in: ["READY", "IN_PROGRESS"] } },
    include: {
      operator: { select: { id: true, name: true, email: true } },
      slab: {
        include: {
          project: { select: { projectCode: true, customerName: true } },
          requirementAllocations: {
            include: {
              requirement: {
                include: { drawing: { select: { drawingNumber: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Lookup physical QC slab names for CLO slabs
  const qcIds = slabJobs.map(j => j.slab.pacificQcId).filter(Boolean) as string[];
  const qcSlabs = qcIds.length
    ? await prisma.polishQc.findMany({
        where:  { id: { in: qcIds } },
        select: { id: true, slabNumber: true, design: true },
      })
    : [];
  const qcById = new Map(qcSlabs.map(q => [q.id, q]));

  const cloEntries = slabJobs.map(job => {
    const qc = job.slab.pacificQcId ? qcById.get(job.slab.pacificQcId) : null;
    const requirements = job.slab.requirementAllocations.map(a => ({
      requirementId: a.requirementId,
      drawingNumber: a.requirement.drawing?.drawingNumber ?? "?",
      pieceLabel:    a.requirement.pieceLabel ?? a.requirement.description ?? "?",
      description:   a.requirement.description ?? null,
      lengthIn:      a.requirement.length ?? null,
      widthIn:       a.requirement.width  ?? null,
      qty:           a.allocatedQuantity,
    }));
    return {
      type:         "clo" as const,
      slabJobId:    job.id,
      jobStatus:    job.status,
      startTime:    job.startTime?.toISOString() ?? null,
      operatorId:   job.operatorId ?? null,
      operatorName: job.operator?.name ?? job.operator?.email ?? null,
      slab: {
        id:          job.slab.id,
        slabCode:    job.slab.slabCode,
        qcSlabCode:  qc ? String(qc.slabNumber) : null,
        qcColour:    qc?.design ?? null,
      },
      project:      job.slab.project,
      requirements,
      totalPcs:     requirements.reduce((s, r) => s + r.qty, 0),
    };
  });

  return Response.json([
    ...Array.from(legacyMap.values()),
    ...cloEntries,
  ]);
}
