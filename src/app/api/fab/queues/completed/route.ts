import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { workersForOperations, workersForSlabJobs } from "@/lib/fab/workerLookups";

export async function GET(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const userId     = g.user.id as string;
  // Operators (EMPLOYEE tier) see only their own completions; supervisors+ see all.
  const filterByUser = g.tier === "EMPLOYEE";

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type")?.toUpperCase();
  const VALID = ["CUTTING","POLISHING","SINK_CUTTING","FABRICATION","PACKAGING"];
  if (!type || !VALID.includes(type)) {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }

  // Date filter: ?date=YYYY-MM-DD, default = today
  // Parse as local midnight to handle server timezone correctly
  const dateParam = searchParams.get("date");
  let startOfDay: Date;
  let endOfDay: Date;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split("-").map(Number);
    startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
    endOfDay   = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else {
    startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
  }

  // For CUTTING, filter employees by operation.operatorId (FabSlabJob sets this).
  // For other types, CLO pieces have null operationId so we post-filter via session overlap.
  //
  // The three reads below depend only on the request (type, day, user), never
  // on each other, so they go to Neon together instead of one after the other;
  // which of the second and third actually run is decided by the same
  // conditions as before (sessions only for a non-CUTTING operator, jobs only
  // for CUTTING).
  const [opsForDay, userSessions, jobs] = await Promise.all([
    prisma.fabPieceOperation.findMany({
      where: {
        operationType: type as any,
        isCompleted:   true,
        completedAt:   { gte: startOfDay, lte: endOfDay },
        // NOT filtered by operator here — see the CUTTING block below. Narrowing
        // in the query made an unmatched filter indistinguishable from an empty
        // day, and for cutting it never matched at all.
      },
      include: {
        operation: {
          include: {
            machine:  { select: { name: true, code: true } },
            operator: { select: { name: true } },
          },
        },
        piece: {
          include: {
            project:     { select: { projectCode: true, customerName: true } },
            drawing:     { select: { drawingNumber: true } },
            requirement: { select: { pieceLabel: true, description: true, length: true, width: true } },
            slab:        { select: { slabCode: true, colour: true } },
          },
        },
      },
      orderBy: { completedAt: "desc" },
    }),
    // Non-CUTTING employees: their machine sessions for this station and day,
    // used below to attribute completions by overlap.
    filterByUser && type !== "CUTTING"
      ? prisma.fabMachineSession.findMany({
          where: {
            userId,
            machine: { type: type as any },
            loginTime: { lte: endOfDay },
            OR: [{ logoutTime: { gte: startOfDay } }, { isActive: true }],
          },
          select: { loginTime: true, logoutTime: true, isActive: true },
        })
      : null,
    // CUTTING: CLO jobs completed on this date.
    // endTime may be null for jobs completed before endTime field was added —
    // fall back to createdAt for those so they still appear in date filters.
    type === "CUTTING"
      ? prisma.fabSlabJob.findMany({
          where: {
            status: "COMPLETED",
            OR: [
              { endTime: { gte: startOfDay, lte: endOfDay } },
              // Fallback: jobs with null endTime, use createdAt to approximate date
              { endTime: null, createdAt: { gte: startOfDay, lte: endOfDay } },
            ],
            ...(filterByUser ? { operatorId: userId } : {}),
          },
          include: {
            machine:  { select: { name: true, code: true } },
            operator: { select: { name: true } },
            slab: {
              include: {
                project: { select: { projectCode: true } },
                requirementAllocations: {
                  include: {
                    requirement: { select: { pieceLabel: true, length: true, width: true } },
                  },
                },
              },
            },
          },
          orderBy: { endTime: "desc" },
        })
      : [],
  ]);
  let ops = opsForDay;

  // CUTTING attributes through FabOperation.operatorId, which FabSlabJob sets.
  // Applying that as a query filter returned an empty list to every operator,
  // every time: the CLO flow creates each FabPieceOperation with operationId
  // NULL (complete-job/route.ts), and a relation filter over a null relation
  // matches nothing. The operator finished the slab, looked at "completed
  // today", saw nothing, and had every reason to think it had not saved — the
  // same trap 8680176 closed for the other four stations and left open here.
  //
  // So narrow only when the narrowing can attribute something. This keeps
  // per-operator lists working if Fabrication ever moves off its single shared
  // login, and shows the station's day when it cannot tell people apart.
  if (filterByUser && type === "CUTTING") {
    const mine = ops.filter(op => op.operation?.operatorId === userId);
    if (mine.length) ops = mine;
  }

  // For non-CUTTING employees: filter by machine session overlap because
  // CLO-created FabPieceOperation records have no operationId/operatorId.
  //
  // If the operator holds no session for this station the filter is skipped
  // rather than applied to nothing. One operator login now covers all five
  // stations without having to open a machine session first, and a session-less
  // operator was being shown an empty "completed today" list right after
  // completing the work — which reads as "it did not save" and invites a
  // duplicate. No session means there is nothing to attribute by, not that
  // nothing happened.
  if (userSessions && userSessions.length) ops = ops.filter(op => {
    if (!op.completedAt) return false;
    return userSessions.some(s => {
      const started = s.loginTime <= op.completedAt!;
      const ended   = s.logoutTime ? s.logoutTime >= op.completedAt! : s.isActive;
      return started && ended;
    });
  });

  // Roster names for the legacy rows and, for CUTTING, the QC slab names and
  // roster names for the CLO jobs: three id-keyed lookups over results already
  // in hand, none of which reads another's answer.
  const qcIds = jobs.map(j => j.slab.pacificQcId).filter(Boolean) as string[];
  const [opWorkers, qcRows, jobWorkers] = await Promise.all([
    workersForOperations(
      ops.map(op => op.operation?.id).filter((id): id is string => !!id),
    ),
    qcIds.length
      ? prisma.polishQc.findMany({
          where:  { id: { in: qcIds } },
          select: { id: true, slabNumber: true, design: true },
        })
      : [],
    workersForSlabJobs(jobs.map(j => j.id)),
  ]);

  const legacyRows = ops.map(op => ({
    flowType:      "legacy" as const,
    opId:          op.id,
    pieceId:       op.pieceId,
    pieceCode:     op.piece.pieceCode,
    projectCode:   op.piece.project.projectCode,
    drawingNumber: op.piece.drawing?.drawingNumber ?? null,
    pieceLabel:    op.piece.requirement?.pieceLabel ?? op.piece.requirement?.description ?? null,
    length:        op.piece.requirement?.length ?? null,
    width:         op.piece.requirement?.width  ?? null,
    slabCode:      op.piece.slab?.slabCode ?? null,
    slabColour:    op.piece.slab?.colour   ?? null,
    machineName:   op.operation?.machine?.name ?? null,
    operatorName:  (op.operation && opWorkers.get(op.operation.id)?.name) ?? op.operation?.operator?.name ?? null,
    completedAt:   op.completedAt!.toISOString(),
  }));

  const cloRows: any[] = [];
  if (type === "CUTTING") {
    const qcMap = new Map(qcRows.map(q => [q.id, q]));

    for (const job of jobs) {
      const qc       = job.slab.pacificQcId ? qcMap.get(job.slab.pacificQcId) : null;
      const totalPcs = job.slab.requirementAllocations.reduce((s, a) => s + a.allocatedQuantity, 0);
      // Use endTime if set, fall back to createdAt (legacy jobs)
      const completedAt = job.endTime ?? job.createdAt;
      cloRows.push({
        flowType:     "clo" as const,
        slabJobId:    job.id,
        projectCode:  job.slab.project.projectCode,
        slabCode:     job.slab.slabCode,
        qcSlabCode:   qc ? String(qc.slabNumber) : null,
        qcColour:     qc?.design ?? null,
        totalPcs,
        reqCount:     job.slab.requirementAllocations.length,
        machineName:  job.machine?.name ?? null,
        operatorName: jobWorkers.get(job.id)?.name ?? job.operator?.name ?? null,
        completedAt:  completedAt.toISOString(),
        noEndTime:    job.endTime === null, // flag so UI can show a hint
      });
    }
  }

  const all = [...legacyRows, ...cloRows].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  );

  return Response.json(all);
}
