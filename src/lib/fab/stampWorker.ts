// Stamp worker/shift on operations and slab jobs via SQL so a stale Prisma
// client (generated before those columns existed) does not throw "Unknown arg
// workerId" on create/update.

import { prisma } from "@/lib/prisma";

type Sql = Pick<typeof prisma, "$executeRaw">;

export async function stampOperationWorker(
  db: Sql,
  operationId: string,
  workerId: string | null | undefined,
  shift: string | null | undefined,
): Promise<void> {
  if (!workerId) return;
  await db.$executeRaw`
    UPDATE fab_operation
    SET worker_id = ${workerId}, shift = ${shift ?? null}
    WHERE id = ${operationId}
  `;
}

export async function stampSlabJobWorker(
  db: Sql,
  slabJobId: string,
  workerId: string | null | undefined,
): Promise<void> {
  if (!workerId) return;
  await db.$executeRaw`
    UPDATE fab_slab_job SET worker_id = ${workerId} WHERE id = ${slabJobId}
  `;
}
