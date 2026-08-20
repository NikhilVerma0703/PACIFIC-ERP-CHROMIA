import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { expireStaleSessions } from "@/lib/fab/expireStaleSessions";
import {
  resolveRange, buildStageSeries, dayKeyOf, MAX_RANGE_DAYS,
  type StageOpBucket, type StageCutBucket,
} from "@/lib/fab/stageSeries";
import { workersForPieceOps, workersForSessions, workersForSlabJobs } from "@/lib/fab/workerLookups";
import { pieceStages, summarizeStages } from "@/lib/fab/pieceStages";
import { downtimeLabel } from "@/lib/fab/downtimeReasons";
import { FAB_PROCESS_LABEL, type FabProcessType } from "@/lib/fab/processSession";

const IDLE_MS = 30 * 60 * 1000;

export async function GET(req: Request) {
  const g = await fabGate("MANAGER");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  // Auto-close sessions left open when operators shut down without logging out
  await expireStaleSessions();

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");

  // Active sessions = real-time; leaderboard/ops = date-filtered
  const startOfDay = dateParam ? new Date(dateParam) : new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);
  const now = new Date();

  // ── Date-wise stage series: the range ─────────────────────────────────────
  // PURELY ADDITIVE. ?date= keeps meaning exactly what it meant — every block
  // below still reads startOfDay/endOfDay and nothing else. ?from=&?to= only
  // widen the new stageSeries field. A caller that sends neither still gets a
  // series: the default window ends on the day it asked about, so the last row
  // of the table equals the dailyThroughput strip built from the same day.
  const stageRange = resolveRange({
    from:   searchParams.get("from"),
    to:     searchParams.get("to"),
    anchor: dayKeyOf(startOfDay),
  });
  // Built the same way as startOfDay above, deliberately: same new Date(key),
  // same setHours, so the window edges of the series and of ?date= cannot
  // drift apart. (new Date("2026-08-18") is UTC midnight and setHours then
  // takes the LOCAL day — a pre-existing quirk that is invisible on Vercel,
  // where the runtime is UTC. Mirroring it beats quietly fixing it here.)
  const rangeStart = new Date(stageRange.from);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(stageRange.to);
  rangeEnd.setHours(23, 59, 59, 999);

  // The buckets are cut in SQL, so SQL has to agree with the local-midnight
  // boundaries above. Prisma stores DateTime as `timestamp` (no zone) holding
  // UTC, so to_char() alone would bucket by UTC day — identical on Vercel
  // (runtime TZ = UTC, offset 0, no shift emitted at all) but a day out on a
  // developer's machine in IST. The offset comes from getTimezoneOffset(), is
  // an integer by construction, and is re-checked before it is interpolated;
  // no request input reaches the statement except as a bound parameter.
  const tzOffsetMin = -rangeStart.getTimezoneOffset();
  const tzShift = Number.isInteger(tzOffsetMin) && tzOffsetMin !== 0
    ? ` + interval '${tzOffsetMin} minutes'`
    : "";
  const onQueryFail = (what: string) => (e: unknown) => {
    // A new panel must not be able to take down the twelve blocks that were
    // working before it. Log loudly, return null, let the page say so.
    console.error(`[fab/ceo] stage series ${what} query failed`, e);
    return null;
  };

  const STD_SLAB_AREA = (137 * 25.4) * (79 * 25.4);

  const [
    activeSessions,
    daySessions,
    allPieces,
    projects,
    pieceOpsDay,
    projectSlabs,
    slabBoardSlabs,
    allMachines,
    stageOpBuckets,
    stageCutBuckets,
    downtimeRows,
  ] = await Promise.all([
    prisma.fabMachineSession.findMany({
      where: { isActive: true },
      include: {
        user:    { select: { id: true, name: true, email: true } },
        machine: { select: { id: true, name: true, type: true, code: true } },
      },
      orderBy: { loginTime: "desc" },
    }),
    prisma.fabMachineSession.findMany({
      where: {
        OR: [
          { isActive: true },
          { logoutTime: { gte: startOfDay, lte: endOfDay } },
          { loginTime:  { gte: startOfDay, lte: endOfDay } },
        ],
      },
      include: {
        user:    { select: { id: true, name: true, email: true } },
        machine: { select: { id: true, name: true, type: true, code: true } },
      },
    }),
    prisma.fabPiece.findMany({
      select: {
        id: true, status: true,
        polishRequired: true, polishingCompleted: true,
        hasSink: true, sinkCompleted: true,
        fabricationRequired: true, fabricationCompleted: true,
        projectId: true,
      },
    }),
    prisma.fabProject.findMany({
      where:   { status: { not: "COMPLETED" } },
      select:  { id: true, projectCode: true, customerName: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.fabPieceOperation.findMany({
      where:  { isCompleted: true, completedAt: { gte: startOfDay, lte: endOfDay } },
      select: { id: true, operationType: true, completedAt: true },
    }),
    prisma.fabSlab.findMany({
      where:  { pacificQcId: { not: null } },
      select: {
        id: true, slabCode: true, pacificQcId: true, projectId: true,
        length: true, width: true,
        project: { select: { projectCode: true } },
        requirementAllocations: {
          select: {
            allocatedQuantity: true,
            requirement: { select: { length: true, width: true, pieceLabel: true } },
          },
        },
      },
    }),
    prisma.fabSlab.findMany({
      where: {
        project: { status: { not: "COMPLETED" } },
        pieces: { some: {} },
      },
      select: {
        id: true,
        slabCode: true,
        pacificQcId: true,
        colour: true,
        project: { select: { projectCode: true } },
        pieces: {
          select: {
            pieceCode: true,
            status: true,
            polishRequired: true,
            polishingCompleted: true,
            hasSink: true,
            sinkCompleted: true,
            fabricationRequired: true,
            fabricationCompleted: true,
            requirement: { select: { pieceLabel: true } },
          },
          orderBy: { pieceCode: "asc" },
        },
      },
      orderBy: { slabCode: "asc" },
    }),
    prisma.fabMachine.findMany({
      select: { id: true, name: true, type: true, code: true },
      orderBy: { type: "asc" },
    }),
    // ── Stage completions per day, counted in the database ──────────────────
    // GROUP BY, not findMany-then-count-in-JS: this page auto-refreshes every
    // 30 seconds and the window is up to 92 days, so what comes back is at
    // most (days x 5) small rows instead of every operation row in the range.
    // Needs fab_piece_operation (is_completed, completed_at) — scripts/0046.
    prisma.$queryRawUnsafe(
      `SELECT to_char(completed_at${tzShift}, 'YYYY-MM-DD') AS day,
              operation_type::text                          AS stage,
              COUNT(*)::int                                 AS count
         FROM fab_piece_operation
        WHERE is_completed = TRUE
          AND completed_at >= $1
          AND completed_at <= $2
        GROUP BY 1, 2`,
      rangeStart, rangeEnd,
    ).then((r: unknown) => r as StageOpBucket[]).catch(onQueryFail("piece operation")),
    // The OTHER half of cutting. A slab cut through the CLO round-trip never
    // produces a CUTTING piece-operation row; its pieces are the
    // allocated_quantity on the slab's allocations, and the single-day strip
    // below adds them (dailyCutLegacy + dailyCutClo). The day a job belongs to
    // is COALESCE(end_time, created_at) — the same fallback the existing
    // cloJobsToday filter uses for jobs completed without an end_time.
    // Joining every allocation and summing is exactly the per-job reduce it
    // replaces: each job contributes the full allocation sum of its slab.
    // Needs fab_slab_job (status, end_time) — scripts/0046. The join side,
    // fab_requirement_allocation (slab_id), was indexed by scripts/0045.
    prisma.$queryRawUnsafe(
      `SELECT to_char(COALESCE(j.end_time, j.created_at)${tzShift}, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(a.allocated_quantity), 0)::int                         AS pieces
         FROM fab_slab_job j
         LEFT JOIN fab_requirement_allocation a ON a.slab_id = j.slab_id
        WHERE j.status = 'COMPLETED'
          AND ( (j.end_time >= $1 AND j.end_time <= $2)
             OR (j.end_time IS NULL AND j.created_at >= $1 AND j.created_at <= $2) )
        GROUP BY 1`,
      rangeStart, rangeEnd,
    ).then((r: unknown) => r as StageCutBucket[]).catch(onQueryFail("CLO cutting")),
    prisma.$queryRaw<{
      id: string; process_type: string; reason: string; notes: string | null;
      started_at: Date; ended_at: Date | null; shift: string | null;
      worker_name: string | null; machine_name: string | null;
    }[]>`
      SELECT d.id, d.process_type, d.reason, d.notes, d.started_at, d.ended_at,
             d.shift, w.name AS worker_name, m.name AS machine_name
        FROM fab_machine_downtime d
        LEFT JOIN fab_worker w ON w.id = d.worker_id
        LEFT JOIN fab_machine m ON m.id = d.machine_id
       WHERE d.ended_at IS NULL
          OR (d.started_at <= ${endOfDay}
              AND COALESCE(d.ended_at, ${endOfDay}) >= ${startOfDay})
       ORDER BY (d.ended_at IS NULL) DESC, d.started_at DESC
       LIMIT 80
    `.catch(onQueryFail("downtime")),
  ]);

  const sessionWorker = await workersForSessions(
    [...new Set([...activeSessions.map(s => s.id), ...daySessions.map(s => s.id)])],
  );
  const pieceOpWorker = await workersForPieceOps(pieceOpsDay.map(o => o.id));

  function sessionPerson(sessionId: string, userId: string, userName: string | null, userEmail: string | null) {
    const w = sessionWorker.get(sessionId);
    return {
      operatorId: w?.workerId ?? userId,
      operatorName: w?.name ?? userName ?? userEmail ?? "Unknown",
    };
  }

  // ── Piece funnel (total state) ─────────────────────────────────────────────
  const dropped = (status: string) => status === "PENDING" || status === "REJECTED";
  const total       = allPieces.length;
  const rejected    = allPieces.filter(p => p.status === "REJECTED").length;
  const packaged    = allPieces.filter(p => p.status === "PACKAGED").length;
  const cut         = allPieces.filter(p => p.status !== "PENDING" && p.status !== "PACKAGED" && p.status !== "REJECTED").length;
  const pending     = allPieces.filter(p => p.status === "PENDING").length;
  const polishing   = allPieces.filter(p => p.polishRequired && !p.polishingCompleted && !dropped(p.status)).length;
  const sinkCutting = allPieces.filter(p => p.hasSink && !p.sinkCompleted && !dropped(p.status)).length;
  const fabrication = allPieces.filter(p => p.fabricationRequired && !p.fabricationCompleted && !dropped(p.status) && p.status !== "PACKAGED").length;

  // ── Project progress ───────────────────────────────────────────────────────
  const piecesByProject: Record<string, { total: number; packaged: number; cut: number }> = {};
  for (const p of allPieces) {
    if (!piecesByProject[p.projectId]) piecesByProject[p.projectId] = { total: 0, packaged: 0, cut: 0 };
    piecesByProject[p.projectId].total++;
    if (p.status === "PACKAGED") piecesByProject[p.projectId].packaged++;
    if (p.status !== "PENDING" && p.status !== "REJECTED")  piecesByProject[p.projectId].cut++;
  }

  // ── Slab wastage ──────────────────────────────────────────────────────────
  // Resolve pacificQcId -> PolishQc.slabNumber so we show the real QC slab
  // number (e.g. "1350") instead of the pre-allocation fab code ("2cm_001")
  const qcIds = [
    ...projectSlabs.map(s => s.pacificQcId!).filter(Boolean),
    ...slabBoardSlabs.map(s => s.pacificQcId).filter((id): id is string => !!id),
  ];
  const qcSlabRows = qcIds.length
    ? await prisma.polishQc.findMany({
        where:  { id: { in: qcIds } },
        select: { id: true, slabNumber: true },
      })
    : [];
  const qcSlabNumberMap = new Map(
    qcSlabRows.map(q => [q.id, q.slabNumber != null ? String(q.slabNumber) : null])
  );

  const wastageByProject: Record<string, { totalWaste: number; slabCount: number }> = {};
  const slabWastage: Array<{
    slabId: string; slabCode: string; pacificQcId: string; projectCode: string;
    wastePct: number; pieceCount: number; slabAreaMm2: number; piecesAreaMm2: number;
  }> = [];

  for (const s of projectSlabs) {
    const slabArea = s.length && s.width ? s.length * s.width : STD_SLAB_AREA;
    let piecesArea = 0;
    let pieceCount = 0;
    for (const a of s.requirementAllocations) {
      const l = (a.requirement.length ?? 0) * 25.4;
      const w = (a.requirement.width  ?? 0) * 25.4;
      piecesArea += l * w * a.allocatedQuantity;
      pieceCount += a.allocatedQuantity;
    }
    const wastePct = slabArea > 0 ? Math.max(0, ((slabArea - piecesArea) / slabArea) * 100) : 0;
    // Use the QC slab number as the display code; fall back to fab slabCode if not resolved
    const displayCode = qcSlabNumberMap.get(s.pacificQcId!) ?? s.slabCode;
    slabWastage.push({
      slabId: s.id, slabCode: displayCode, pacificQcId: s.pacificQcId!,
      projectCode: s.project.projectCode,
      wastePct: Math.round(wastePct * 10) / 10, pieceCount,
      slabAreaMm2: Math.round(slabArea), piecesAreaMm2: Math.round(piecesArea),
    });
    if (!wastageByProject[s.projectId]) wastageByProject[s.projectId] = { totalWaste: 0, slabCount: 0 };
    wastageByProject[s.projectId].totalWaste += wastePct;
    wastageByProject[s.projectId].slabCount  += 1;
  }

  const projectProgress = projects.map(p => {
    const w = wastageByProject[p.id];
    return {
      ...p,
      ...(piecesByProject[p.id] ?? { total: 0, packaged: 0, cut: 0 }),
      avgWastagePct: w ? Math.round((w.totalWaste / w.slabCount) * 10) / 10 : null,
      assignedSlabs: w?.slabCount ?? 0,
    };
  });

  const slabBoard = slabBoardSlabs.map(s => {
    const pieces = s.pieces.map(p => {
      const stages = pieceStages(p);
      return {
        pieceCode: p.pieceCode,
        label: p.requirement?.pieceLabel ?? null,
        status: p.status,
        stages,
      };
    });
    const sums = summarizeStages(pieces.map(p => p.stages));
    return {
      slabId: s.id,
      slabCode: (s.pacificQcId && qcSlabNumberMap.get(s.pacificQcId)) || s.slabCode,
      colour: s.colour,
      projectCode: s.project.projectCode,
      ...sums,
      pieces,
    };
  });

  // ── Leaderboard (date-filtered) ────────────────────────────────────────────
  const sessionsByType: Record<string, Array<{
    sessionId: string;
    userId: string; userName: string | null; userEmail: string | null;
    machineId: string; machineName: string; machineType: string;
    loginTime: Date; logoutTime: Date | null; isActive: boolean;
  }>> = {};
  for (const s of daySessions) {
    const t = s.machine.type;
    if (!sessionsByType[t]) sessionsByType[t] = [];
    sessionsByType[t].push({
      sessionId: s.id,
      userId: s.user.id, userName: s.user.name, userEmail: s.user.email,
      machineId: s.machine.id, machineName: s.machine.name, machineType: t,
      loginTime: s.loginTime, logoutTime: s.logoutTime ?? null, isActive: s.isActive,
    });
  }

  type OpMachineKey = string;
  const opMachineMap: Record<OpMachineKey, {
    operatorId: string; operatorName: string;
    machineType: string; machineName: string | null;
    piecesDay: number; slabsDay: number; durations: number[];
  }> = {};

  function getOrCreate(uid: string, name: string, type: string, machine: string | null) {
    const k = `${uid}:${type}`;
    if (!opMachineMap[k]) {
      opMachineMap[k] = { operatorId: uid, operatorName: name, machineType: type, machineName: machine, piecesDay: 0, slabsDay: 0, durations: [] };
    }
    return opMachineMap[k];
  }

  // Completions: prefer the worker stamped on the operation (who stood at the
  // machine). Fall back to session-window overlap using that session's worker,
  // not the shared operator login.
  for (const op of pieceOpsDay) {
    if (!op.completedAt || !op.operationType) continue;
    const stamped = pieceOpWorker.get(op.id);
    if (stamped) {
      const entry = getOrCreate(stamped.workerId, stamped.name, op.operationType, null);
      entry.piecesDay++;
      continue;
    }
    const match = (sessionsByType[op.operationType] ?? []).find(s => {
      const started = s.loginTime <= op.completedAt!;
      const ended   = s.logoutTime ? s.logoutTime >= op.completedAt! : s.isActive;
      return started && ended;
    });
    if (!match) continue;
    const person = sessionPerson(match.sessionId, match.userId, match.userName, match.userEmail);
    const entry = getOrCreate(person.operatorId, person.operatorName, op.operationType, match.machineName);
    entry.piecesDay++;
  }

  // CLO cutting jobs for selected date
  const cloJobsToday = await prisma.fabSlabJob.findMany({
    where: {
      status: "COMPLETED",
      OR: [
        { endTime: { gte: startOfDay, lte: endOfDay } },
        { endTime: null, createdAt: { gte: startOfDay, lte: endOfDay } },
      ],
    },
    include: {
      operator: { select: { id: true, name: true, email: true } },
      machine:  { select: { name: true } },
      slab:     { include: { requirementAllocations: { select: { allocatedQuantity: true } } } },
    },
  });
  const cloJobWorker = await workersForSlabJobs(cloJobsToday.map(j => j.id));
  for (const job of cloJobsToday) {
    const stamped = cloJobWorker.get(job.id);
    const uid  = stamped?.workerId ?? job.operatorId;
    const name = stamped?.name ?? job.operator?.name ?? job.operator?.email ?? "Unknown";
    if (!uid) continue;
    const entry = getOrCreate(uid, name, "CUTTING", job.machine?.name ?? null);
    const pcs   = job.slab.requirementAllocations.reduce((s, a) => s + a.allocatedQuantity, 0);
    entry.piecesDay += pcs;
    entry.slabsDay  += 1;
    if (job.startTime && job.endTime) {
      const mins = (job.endTime.getTime() - job.startTime.getTime()) / 60000;
      if (mins > 0 && mins < 600) entry.durations.push(mins);
    }
  }

  const machineLeaderboard: Record<string, Array<{
    operatorId: string; operatorName: string; machineName: string | null;
    piecesDay: number; slabsDay: number;
    avgCutMinutes: number | null; fastestCutMinutes: number | null; slowestCutMinutes: number | null;
  }>> = {};
  for (const entry of Object.values(opMachineMap)) {
    if (!machineLeaderboard[entry.machineType]) machineLeaderboard[entry.machineType] = [];
    const avg  = entry.durations.length ? Math.round(entry.durations.reduce((s,d) => s+d,0) / entry.durations.length) : null;
    const fast = entry.durations.length ? Math.round(Math.min(...entry.durations)) : null;
    const slow = entry.durations.length ? Math.round(Math.max(...entry.durations)) : null;
    machineLeaderboard[entry.machineType].push({
      operatorId: entry.operatorId, operatorName: entry.operatorName, machineName: entry.machineName,
      piecesDay: entry.piecesDay, slabsDay: entry.slabsDay,
      avgCutMinutes: avg, fastestCutMinutes: fast, slowestCutMinutes: slow,
    });
  }
  for (const type of Object.keys(machineLeaderboard)) {
    machineLeaderboard[type].sort((a, b) => b.piecesDay - a.piecesDay);
  }

  const leaderboard = Object.values(opMachineMap)
    .sort((a, b) => b.piecesDay - a.piecesDay)
    .map(v => ({
      operatorId: v.operatorId, operatorName: v.operatorName,
      machineType: v.machineType, machineName: v.machineName, piecesToday: v.piecesDay,
    }));

  // ── Operators-today (date-filtered, for Operators tab) ─────────────────────
  const operatorDayMap: Record<string, {
    operatorId: string; operatorName: string;
    sessions: Array<{ machineName: string; machineType: string; loginTime: string; logoutTime: string | null; isActive: boolean; durationMinutes: number }>;
    totalMinutes: number; piecesByType: Record<string, number>;
  }> = {};
  for (const s of daySessions) {
    const person = sessionPerson(s.id, s.user.id, s.user.name, s.user.email);
    const uid = person.operatorId;
    if (!operatorDayMap[uid]) {
      operatorDayMap[uid] = {
        operatorId: uid,
        operatorName: person.operatorName,
        sessions: [], totalMinutes: 0, piecesByType: {},
      };
    }
    const end  = s.logoutTime ?? (s.isActive ? now : s.loginTime);
    const mins = Math.max(0, Math.floor((end.getTime() - s.loginTime.getTime()) / 60000));
    operatorDayMap[uid].sessions.push({
      machineName: s.machine.name, machineType: s.machine.type,
      loginTime: s.loginTime.toISOString(), logoutTime: s.logoutTime?.toISOString() ?? null,
      isActive: s.isActive, durationMinutes: mins,
    });
    operatorDayMap[uid].totalMinutes += mins;
  }
  for (const entry of Object.values(opMachineMap)) {
    if (!operatorDayMap[entry.operatorId]) {
      operatorDayMap[entry.operatorId] = {
        operatorId: entry.operatorId,
        operatorName: entry.operatorName,
        sessions: [], totalMinutes: 0, piecesByType: {},
      };
    }
    operatorDayMap[entry.operatorId].piecesByType[entry.machineType] =
      (operatorDayMap[entry.operatorId].piecesByType[entry.machineType] ?? 0) + entry.piecesDay;
  }
  const operatorsToday = Object.values(operatorDayMap).sort((a, b) => {
    const pA = Object.values(a.piecesByType).reduce((s, v) => s + v, 0);
    const pB = Object.values(b.piecesByType).reduce((s, v) => s + v, 0);
    return pB - pA;
  });

  // IN_PROGRESS jobs: cutters are "active", don't flag them idle
  const inProgressJobs = await prisma.fabSlabJob.findMany({
    where: { status: "IN_PROGRESS" },
    select: { operatorId: true, machineId: true, startTime: true },
  });
  const cuttingMachines = new Set(
    inProgressJobs.map(j => j.machineId).filter(Boolean) as string[],
  );

  // ── Real-time idle detection: per-machine, not per-type or date-filtered ──
  // Fetch ops completed within the IDLE_MS window (always "now", not date filter)
  const recentOpsCutoff = new Date(now.getTime() - IDLE_MS);
  const recentOpsForIdle = await prisma.fabPieceOperation.findMany({
    where: {
      OR: [
        // Completed within idle window
        { isCompleted: true,  completedAt: { gte: recentOpsCutoff } },
        // Started but not yet completed (operator actively working)
        { isCompleted: false, startedAt:   { gte: recentOpsCutoff } },
      ],
    },
    select: {
      completedAt: true,
      startedAt: true,
      isCompleted: true,
      operationType: true,
      operation: { select: { machineId: true } },
    },
  });

  // Build lastActivity per machineId (from recent piece ops)
  // Use session-time-overlap for CLO pieces that have no operationId (null machineId link)
  const sessionsByTypeLive: Record<string, Array<{ machineId: string; loginTime: Date; logoutTime: Date | null; isActive: boolean }>> = {};
  for (const s of activeSessions) {
    const t = s.machine.type;
    if (!sessionsByTypeLive[t]) sessionsByTypeLive[t] = [];
    sessionsByTypeLive[t].push({ machineId: s.machine.id, loginTime: s.loginTime, logoutTime: null, isActive: true });
  }

  const lastByMachineId: Record<string, Date> = {};
  for (const op of recentOpsForIdle) {
    // Use completedAt for finished ops, startedAt for in-progress ops
    const activityTime = op.isCompleted ? op.completedAt : op.startedAt;
    if (!activityTime) continue;
    const mid = op.operation?.machineId;
    if (mid) {
      if (!lastByMachineId[mid] || activityTime > lastByMachineId[mid]) {
        lastByMachineId[mid] = activityTime;
      }
    } else if (op.operationType) {
      // No direct machine link: attribute via active session-time-overlap
      const match = (sessionsByTypeLive[op.operationType] ?? []).find(s =>
        s.loginTime <= activityTime && (s.logoutTime ? s.logoutTime >= activityTime : s.isActive)
      );
      if (match) {
        if (!lastByMachineId[match.machineId] || activityTime > lastByMachineId[match.machineId]) {
          lastByMachineId[match.machineId] = activityTime;
        }
      }
    }
  }
  // CLO in-progress job → that specific machine is actively cutting (not idle)
  for (const job of inProgressJobs) {
    if (job.machineId && job.startTime) {
      if (!lastByMachineId[job.machineId] || job.startTime > lastByMachineId[job.machineId]) {
        lastByMachineId[job.machineId] = job.startTime;
      }
    }
  }
  // CLO jobs recently COMPLETED (within idle window) → machine was active, not idle yet
  const recentCloJobs = await prisma.fabSlabJob.findMany({
    where: { status: "COMPLETED", endTime: { gte: recentOpsCutoff }, machineId: { not: null } },
    select: { machineId: true, endTime: true },
  });
  for (const job of recentCloJobs) {
    if (!job.machineId || !job.endTime) continue;
    if (!lastByMachineId[job.machineId] || job.endTime > lastByMachineId[job.machineId]) {
      lastByMachineId[job.machineId] = job.endTime;
    }
  }

  // ── Pending counts ─────────────────────────────────────────────────────────
  const cloJobsWithQty = await prisma.fabSlabJob.findMany({
    where: { status: { in: ["READY", "IN_PROGRESS"] } },
    include: {
      slab: { include: { requirementAllocations: { select: { allocatedQuantity: true } } } },
    },
  });
  const cloCuttingPieces = cloJobsWithQty.reduce(
    (sum, job) => sum + job.slab.requirementAllocations.reduce((s, a) => s + a.allocatedQuantity, 0), 0);
  const cloSlabsPending = cloJobsWithQty.length;

  const [legacyCuttingPending] = await Promise.all([
    prisma.fabSlabAllocation.count({
      where: { piece: { pieceOperations: { some: { operationType: "CUTTING", isCompleted: false } } } },
    }),
  ]);
  const polishingPending = polishing;
  const sinkPending = sinkCutting;
  const fabPending = allPieces.filter(p =>
    p.fabricationRequired && !p.fabricationCompleted &&
    p.status !== "PENDING" && p.status !== "REJECTED" &&
    (!p.hasSink || p.sinkCompleted)
  ).length;
  const packPending = allPieces.filter(p =>
    p.status !== "PENDING" && p.status !== "PACKAGED" && p.status !== "REJECTED" &&
    (!p.polishRequired || p.polishingCompleted) &&
    (!p.hasSink || p.sinkCompleted) &&
    (!p.fabricationRequired || p.fabricationCompleted)
  ).length;
  const pendingByType: Record<string, number> = {
    CUTTING:      legacyCuttingPending + cloCuttingPieces,
    POLISHING:    polishingPending,
    SINK_CUTTING: sinkPending,
    FABRICATION:  fabPending,
    PACKAGING:    packPending,
  };

  // ── Machine stats + idle alerts ────────────────────────────────────────────
  const typeCompletions: Record<string, number> = {};
  const lastByType: Record<string, Date> = {};
  for (const op of pieceOpsDay) {
    if (!op.operationType) continue;
    typeCompletions[op.operationType] = (typeCompletions[op.operationType] ?? 0) + 1;
    if (op.completedAt) {
      const existing = lastByType[op.operationType];
      if (!existing || op.completedAt > existing) lastByType[op.operationType] = op.completedAt;
    }
  }

  // Per-machine piece counts for today (machine-specific, not aggregated by type)
  const machineCompletions: Record<string, number> = {};
  for (const op of pieceOpsDay) {
    if (!op.completedAt || !op.operationType) continue;
    const match = (sessionsByType[op.operationType] ?? []).find(s =>
      s.loginTime <= op.completedAt! && (s.logoutTime ? s.logoutTime >= op.completedAt! : s.isActive)
    );
    if (match) machineCompletions[match.machineId] = (machineCompletions[match.machineId] ?? 0) + 1;
  }
  for (const job of cloJobsToday) {
    if (!job.machineId) continue;
    const pcs = job.slab.requirementAllocations.reduce((s, a) => s + a.allocatedQuantity, 0);
    machineCompletions[job.machineId] = (machineCompletions[job.machineId] ?? 0) + pcs;
  }

  const activeByMachine: Record<string, { operatorName: string; sessionId: string; loginTime: Date }> = {};
  for (const s of activeSessions) {
    const person = sessionPerson(s.id, s.user.id, s.user.name, s.user.email);
    activeByMachine[s.machine.id] = {
      operatorName: person.operatorName,
      sessionId: s.id, loginTime: s.loginTime,
    };
  }

  const machineStats = allMachines.map(m => {
    const active = activeByMachine[m.id];
    const isIdle = active
      ? (() => {
          // Per-machine idle: use machineId-specific last activity, fall back to login time
          const lastActivity = lastByMachineId[m.id] ?? active.loginTime;
          return now.getTime() - lastActivity.getTime() > IDLE_MS;
        })()
      : false;
    return {
      machineId: m.id, name: m.name, type: m.type, code: m.code,
      isActive: !!active, isIdle,
      currentOperator: active?.operatorName ?? null,
      sessionId:       active?.sessionId ?? null,
      piecesToday:     machineCompletions[m.id] ?? 0,
      pendingCount:    pendingByType[m.type] ?? 0,
    };
  });

  const idleAlerts = activeSessions
    .map(s => {
      const mType = s.machine.type;
      if (mType === "CUTTING" && cuttingMachines.has(s.machine.id)) return null;
      // Per-machine idle check using real-time data
      const lastActivity = lastByMachineId[s.machine.id] ?? s.loginTime;
      const idleMs = now.getTime() - lastActivity.getTime();
      if (idleMs < IDLE_MS) return null;
      const pendingCount = pendingByType[mType] ?? 0;
      return {
        sessionId:      s.id,
        operatorName:   sessionPerson(s.id, s.user.id, s.user.name, s.user.email).operatorName,
        machineType:    mType,
        machineName:    s.machine.name,
        idleMinutes:    Math.floor(idleMs / 60000),
        hasPendingJobs: pendingCount > 0,
        pendingCount,
        lastActivity:   lastActivity.toISOString(),
      };
    })
    .filter(Boolean);

  // ── Daily throughput (date-filtered) ─────────────────────────────────────────────
  const dailyCutLegacy = pieceOpsDay.filter(op => op.operationType === "CUTTING").length;
  const dailyCutClo    = cloJobsToday.reduce(
    (s, j) => s + j.slab.requirementAllocations.reduce((a, r) => a + r.allocatedQuantity, 0), 0);
  const dailyThroughput = {
    cutting:     dailyCutLegacy + dailyCutClo,
    polishing:   pieceOpsDay.filter(op => op.operationType === "POLISHING").length,
    sinkCutting: pieceOpsDay.filter(op => op.operationType === "SINK_CUTTING").length,
    fabrication: pieceOpsDay.filter(op => op.operationType === "FABRICATION").length,
    packaging:   pieceOpsDay.filter(op => op.operationType === "PACKAGING").length,
  };

  // ── Date-wise, stage-wise breakdown (range-filtered) ──────────────────────
  // One row per calendar day including the days nothing was completed, plus
  // the totals for the range. If EITHER query failed the whole panel goes
  // null rather than half-reported: a cutting column missing its CLO half is a
  // wrong number, and a wrong number on a CEO dashboard is worse than a gap.
  const stageSeries = stageOpBuckets && stageCutBuckets
    ? buildStageSeries({
        from: stageRange.from,
        to:   stageRange.to,
        ops:  stageOpBuckets,
        cuts: stageCutBuckets,
        maxDays: MAX_RANGE_DAYS,
      })
    : null;

  return Response.json({
    activeSessions: activeSessions.map(s => {
      const person = sessionPerson(s.id, s.user.id, s.user.name, s.user.email);
      return {
      id:              s.id,
      user:            { name: person.operatorName },
      machine:         s.machine,
      shift:           s.shift,
      loginTime:       s.loginTime.toISOString(),
      durationMinutes: Math.floor((now.getTime() - s.loginTime.getTime()) / 60000),
    };
    }),
    pieceFunnel:      { total, pending, cut, polishing, sinkCutting, fabrication, packaged, rejected },
    projectProgress,
    leaderboard,
    machineLeaderboard,
    machineStats,
    pendingByType,
    cloSlabsPending,
    slabWastage,
    slabBoard,
    idleAlerts,
    dailyThroughput,
    stageSeries,
    operatorsToday,
    downtimeLog: (downtimeRows ?? []).map(r => {
      const ended = r.ended_at;
      const mins = Math.max(0, Math.floor(((ended ?? now).getTime() - r.started_at.getTime()) / 60000));
      const processType = r.process_type as FabProcessType;
      return {
        id: r.id,
        processType,
        processLabel: FAB_PROCESS_LABEL[processType] ?? r.process_type,
        reason: r.reason,
        reasonLabel: downtimeLabel(r.reason),
        notes: r.notes,
        startedAt: r.started_at.toISOString(),
        endedAt: ended ? ended.toISOString() : null,
        shift: r.shift,
        workerName: r.worker_name,
        machineName: r.machine_name,
        open: ended == null,
        durationMinutes: mins,
      };
    }),
  });
}
