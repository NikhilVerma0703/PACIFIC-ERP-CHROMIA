// GET /api/fab/projects/operators?projectId=xxx
// Returns all operators who have done any work on a project,
// with per-machine-type stats (slabs, pieces, avg/best/slowest time).

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function GET(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  // Fetch all piece operations for this project
  const pieceOps = await prisma.fabPieceOperation.findMany({
    where: {
      isCompleted: true,
      piece: { projectId },
    },
    select: {
      operationType: true,
      completedAt:   true,
      operation: {
        select: {
          operatorId: true,
          operator:   { select: { id: true, name: true, email: true } },
          machine:    { select: { name: true, type: true } },
          startTime:  true,
          endTime:    true,
        },
      },
    },
  });

  // Fetch CLO cutting jobs for this project
  const cloJobs = await prisma.fabSlabJob.findMany({
    where: {
      status:    "COMPLETED",
      slab:      { projectId },
      operatorId: { not: null },
    },
    include: {
      operator: { select: { id: true, name: true, email: true } },
      machine:  { select: { name: true, type: true } },
      slab:     {
        include: {
          requirementAllocations: { select: { allocatedQuantity: true } },
        },
      },
    },
  });

  // Map: operatorId → machineType → stats
  type MachineStats = {
    machineName: string | null;
    slabs: number;
    pieces: number;
    durations: number[]; // minutes
  };
  type OperatorEntry = {
    operatorId:   string;
    operatorName: string;
    machineStats: Record<string, MachineStats>;
  };

  const opMap = new Map<string, OperatorEntry>();

  function getOp(id: string, name: string): OperatorEntry {
    if (!opMap.has(id)) opMap.set(id, { operatorId: id, operatorName: name, machineStats: {} });
    return opMap.get(id)!;
  }
  function getMachine(entry: OperatorEntry, type: string, machineName: string | null): MachineStats {
    if (!entry.machineStats[type]) entry.machineStats[type] = { machineName, slabs: 0, pieces: 0, durations: [] };
    return entry.machineStats[type];
  }

  // Legacy piece operations (non-cutting or cutting via old flow)
  for (const op of pieceOps) {
    if (!op.operation?.operatorId || !op.operation.operator) continue;
    const { operatorId, operator, machine, startTime, endTime } = op.operation;
    const name = operator.name ?? operator.email ?? "Unknown";
    const entry = getOp(operatorId, name);
    const ms = getMachine(entry, op.operationType, machine?.name ?? null);
    ms.pieces++;
    if (startTime && endTime) {
      const mins = (endTime.getTime() - startTime.getTime()) / 60000;
      if (mins > 0 && mins < 480) ms.durations.push(mins);
    }
  }

  // CLO cutting jobs
  for (const job of cloJobs) {
    if (!job.operatorId || !job.operator) continue;
    const name = job.operator.name ?? job.operator.email ?? "Unknown";
    const entry = getOp(job.operatorId, name);
    const ms = getMachine(entry, "CUTTING", job.machine?.name ?? null);
    ms.slabs++;
    const pcs = job.slab.requirementAllocations.reduce((s, a) => s + a.allocatedQuantity, 0);
    ms.pieces += pcs;
    if (job.startTime && job.endTime) {
      const mins = (job.endTime.getTime() - job.startTime.getTime()) / 60000;
      if (mins > 0 && mins < 480) ms.durations.push(mins);
    }
  }

  const result = Array.from(opMap.values()).map(entry => ({
    operatorId:   entry.operatorId,
    operatorName: entry.operatorName,
    totalPieces:  Object.values(entry.machineStats).reduce((s, m) => s + m.pieces, 0),
    totalSlabs:   Object.values(entry.machineStats).reduce((s, m) => s + m.slabs, 0),
    machineStats: Object.entries(entry.machineStats).map(([type, ms]) => ({
      machineType:    type,
      machineName:    ms.machineName,
      slabs:          ms.slabs,
      pieces:         ms.pieces,
      avgMinutes:     ms.durations.length ? Math.round(ms.durations.reduce((a,b)=>a+b,0)/ms.durations.length) : null,
      fastestMinutes: ms.durations.length ? Math.round(Math.min(...ms.durations)) : null,
      slowestMinutes: ms.durations.length ? Math.round(Math.max(...ms.durations)) : null,
    })),
  })).sort((a, b) => b.totalPieces - a.totalPieces);

  // Also get project info
  const project = await prisma.fabProject.findUnique({
    where:  { id: projectId },
    select: { projectCode: true, customerName: true, status: true },
  });

  return Response.json({ project, operators: result });
}
