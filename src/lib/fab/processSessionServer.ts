import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  FAB_PROCESS_LABEL,
  FAB_PROCESS_TYPES,
  PROCESS_SESSION_COOKIE_MAX_AGE,
  processSessionCookie,
  type FabProcessType,
  type ProcessSession,
} from "./processSession";

export async function readProcessSession(
  type: FabProcessType,
): Promise<ProcessSession | null> {
  const store = await cookies();
  const sessionId = store.get(processSessionCookie(type))?.value;
  if (!sessionId) return null;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    user_id: string;
    machine_id: string;
    shift: string;
    worker_id: string | null;
    worker_name: string | null;
    worker_active: boolean | null;
    machine_name: string;
    machine_type: string;
  }>>`
    SELECT s.id, s.user_id, s.machine_id, s.shift, s.worker_id,
           w.name AS worker_name, w.active AS worker_active,
           m.name AS machine_name, m.type::text AS machine_type
    FROM fab_machine_session s
    JOIN fab_machine m ON m.id = s.machine_id
    LEFT JOIN fab_worker w ON w.id = s.worker_id
    WHERE s.id = ${sessionId} AND s.is_active = true
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.machine_type !== type || !row.worker_id || !row.worker_name || !row.worker_active) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    machineId: row.machine_id,
    machineName: row.machine_name,
    workerId: row.worker_id,
    workerName: row.worker_name,
    shift: row.shift,
    processType: type,
  };
}

export async function requireProcessSession(
  type: FabProcessType,
): Promise<{ ok: true; session: ProcessSession } | { ok: false; status: number; error: string }> {
  const session = await readProcessSession(type);
  if (!session) {
    return {
      ok: false,
      status: 409,
      error: `Start a ${FAB_PROCESS_LABEL[type]} session (name and shift) before recording work.`,
    };
  }
  return { ok: true, session };
}

export async function setProcessSessionCookie(type: FabProcessType, sessionId: string) {
  const store = await cookies();
  store.set(processSessionCookie(type), sessionId, {
    httpOnly: true,
    path: "/",
    maxAge: PROCESS_SESSION_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}

export async function clearProcessSessionCookie(type: FabProcessType) {
  const store = await cookies();
  store.delete(processSessionCookie(type));
}

export async function listCookieSessions(): Promise<Partial<Record<FabProcessType, ProcessSession>>> {
  const out: Partial<Record<FabProcessType, ProcessSession>> = {};
  for (const type of FAB_PROCESS_TYPES) {
    const s = await readProcessSession(type);
    if (s) out[type] = s;
  }
  return out;
}
