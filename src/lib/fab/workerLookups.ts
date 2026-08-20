// Roster names for sessions / operations / slab jobs. Raw SQL so a stale
// Prisma client (no FabWorker relation) cannot 500 the CEO dashboard or the
// cutting queue. Empty id lists skip the query — `IN ()` is invalid SQL.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface NamedWorker {
  workerId: string;
  name: string;
}

function toMap(rows: Array<{ id: string; worker_id: string | null; name: string | null }>): Map<string, NamedWorker> {
  const m = new Map<string, NamedWorker>();
  for (const r of rows) {
    if (r.worker_id && r.name) m.set(r.id, { workerId: r.worker_id, name: r.name });
  }
  return m;
}

export async function workersForSessions(ids: string[]): Promise<Map<string, NamedWorker>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; worker_id: string | null; name: string | null }>>`
    SELECT s.id, s.worker_id, w.name
    FROM fab_machine_session s
    LEFT JOIN fab_worker w ON w.id = s.worker_id
    WHERE s.id IN (${Prisma.join(ids)})
  `;
  return toMap(rows);
}

export async function workersForPieceOps(ids: string[]): Promise<Map<string, NamedWorker>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; worker_id: string | null; name: string | null }>>`
    SELECT po.id, o.worker_id, w.name
    FROM fab_piece_operation po
    LEFT JOIN fab_operation o ON o.id = po.operation_id
    LEFT JOIN fab_worker w ON w.id = o.worker_id
    WHERE po.id IN (${Prisma.join(ids)})
  `;
  return toMap(rows);
}

export async function workersForSlabJobs(ids: string[]): Promise<Map<string, NamedWorker>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; worker_id: string | null; name: string | null }>>`
    SELECT j.id, j.worker_id, w.name
    FROM fab_slab_job j
    LEFT JOIN fab_worker w ON w.id = j.worker_id
    WHERE j.id IN (${Prisma.join(ids)})
  `;
  return toMap(rows);
}

export async function workersForOperations(ids: string[]): Promise<Map<string, NamedWorker>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; worker_id: string | null; name: string | null }>>`
    SELECT o.id, o.worker_id, w.name
    FROM fab_operation o
    LEFT JOIN fab_worker w ON w.id = o.worker_id
    WHERE o.id IN (${Prisma.join(ids)})
  `;
  return toMap(rows);
}
