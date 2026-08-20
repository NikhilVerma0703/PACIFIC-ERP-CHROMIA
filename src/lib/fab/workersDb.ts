// Floor roster against fab_worker. Uses $queryRaw so the People page works
// even when the long-lived Prisma singleton was created before FabWorker
// existed (next dev on Windows often cannot regenerate the client while
// it is running, so prisma.fabWorker stays undefined).

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface FabWorkerRow {
  id: string;
  name: string;
  active: boolean;
}

export async function listFabWorkers(includeInactive: boolean): Promise<FabWorkerRow[]> {
  if (includeInactive) {
    return prisma.$queryRaw<FabWorkerRow[]>`
      SELECT id, name, active FROM fab_worker
      ORDER BY active DESC, name ASC
    `;
  }
  return prisma.$queryRaw<FabWorkerRow[]>`
    SELECT id, name, active FROM fab_worker
    WHERE active = true
    ORDER BY name ASC
  `;
}

export async function getActiveFabWorker(id: string): Promise<FabWorkerRow | null> {
  const rows = await prisma.$queryRaw<FabWorkerRow[]>`
    SELECT id, name, active FROM fab_worker
    WHERE id = ${id} AND active = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function createFabWorker(name: string, createdById: string): Promise<FabWorkerRow> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO fab_worker (id, name, active, created_at, created_by_id)
    VALUES (${id}, ${name}, true, NOW(), ${createdById})
  `;
  return { id, name, active: true };
}

export async function setFabWorkerActive(id: string, active: boolean): Promise<FabWorkerRow | null> {
  const updated = await prisma.$executeRaw`
    UPDATE fab_worker SET active = ${active} WHERE id = ${id}
  `;
  if (updated === 0) return null;
  const rows = await prisma.$queryRaw<FabWorkerRow[]>`
    SELECT id, name, active FROM fab_worker WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}
