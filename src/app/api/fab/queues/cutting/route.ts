import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { workersForSlabJobs } from "@/lib/fab/workerLookups";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  // ── NEW CLO flow: FabSlabJob (READY / IN_PROGRESS) ──────────────────────
  // Read first: the legacy query below excludes the slabs these jobs hold, so
  // it needs the set before it runs.
  const slabJobs = await prisma.fabSlabJob.findMany({
    where:   { status: { in: ["READY", "IN_PROGRESS"] } },
    include: {
      operator: { select: { id: true, name: true, email: true } },
      machine:  { select: { id: true, name: true, code: true } },
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
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
  });

  // One slab, one row. A project released from the planning board has FabPieces
  // (the legacy grouping below) AND can have a slab job sent from the cut queue —
  // the same physical slab, listed twice, on the screen where an operator decides
  // what to cut next. The slab job is the newer, richer entry and completing it
  // advances those same pieces, so it wins; only ACTIVE jobs suppress the legacy
  // row, or pieces still pending under a finished job would have nowhere to show.
  const slabIdsWithActiveJob = new Set(slabJobs.map(j => j.slabId));

  // Lookup physical QC slab names for CLO slabs
  const qcIds = slabJobs.map(j => j.slab.pacificQcId).filter(Boolean) as string[];

  // ── OLD flow: FabSlabAllocation → FabPiece ──────────────────────────────
  // The two predicates the grouping loop applied in JS — "this piece still has
  // an open CUTTING op" and "this slab has no active job" — are pushed into the
  // query, so the route no longer reads every allocation ever made (with four
  // joined relations each) every 15 s per station only to drop nearly all of
  // them. isCompleted is a non-nullable Boolean, so `isCompleted: false` is
  // exactly `!op.isCompleted`, and the loop's `continue` on an active slab is
  // exactly `slabId notIn`. The JS filter stays as a no-op guard: the include
  // is a separate statement from the WHERE, so it keeps the old behaviour even
  // if an op is completed between the two.
  // The three reads depend only on slabJobs, not on each other.
  const [allocations, qcSlabs, jobWorkers] = await Promise.all([
    prisma.fabSlabAllocation.findMany({
      where: {
        slabId: { notIn: [...slabIdsWithActiveJob] },
        piece: { pieceOperations: { some: { operationType: "CUTTING", isCompleted: false } } },
      },
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
    }),
    qcIds.length
      ? prisma.polishQc.findMany({
          where:  { id: { in: qcIds } },
          select: { id: true, slabNumber: true, design: true },
        })
      : [],
    workersForSlabJobs(slabJobs.map(j => j.id)),
  ]);

  const pending = allocations.filter(a =>
    a.piece.pieceOperations.some(op => !op.isCompleted)
  );

  const legacyMap = new Map<string, { type: "legacy"; slab: any; pieces: any[] }>();
  for (const alloc of pending) {
    const key = alloc.slabId;
    if (slabIdsWithActiveJob.has(key)) continue;
    if (!legacyMap.has(key)) legacyMap.set(key, { type: "legacy", slab: alloc.slab, pieces: [] });
    legacyMap.get(key)!.pieces.push(alloc.piece);
  }

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
    const worker = jobWorkers.get(job.id);
    return {
      type:         "clo" as const,
      slabJobId:    job.id,
      jobStatus:    job.status,
      startTime:    job.startTime?.toISOString() ?? null,
      operatorId:   worker?.workerId ?? job.operatorId ?? null,
      operatorName: worker?.name ?? job.operator?.name ?? job.operator?.email ?? null,
      // WHICH MACHINE holds this job, not just which login started it.
      //
      // Fabrication runs on ONE shared operator account, so operatorId is the
      // same value for every person on the floor and cannot tell two of them
      // apart. The machine can: each station opens its own FabMachineSession.
      // Without this the queue could only ever say "you started this", which is
      // true of everyone, and two operators could cut the same slab with
      // nothing on screen to warn either of them.
      machineId:    job.machineId ?? null,
      machineName:  job.machine?.name ?? job.machine?.code ?? null,
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
