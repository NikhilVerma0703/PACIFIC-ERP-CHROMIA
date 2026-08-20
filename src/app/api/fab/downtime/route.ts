import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { FAB_PROCESS_LABEL, FAB_SHIFTS, isFabProcessType } from "@/lib/fab/processSession";
import { requireProcessSession } from "@/lib/fab/processSessionServer";
import { downtimeLabel, isDowntimeReason } from "@/lib/fab/downtimeReasons";
import { getActiveFabWorker } from "@/lib/fab/workersDb";

export async function GET(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const openOnly = url.searchParams.get("open") === "1";

  if (type && !isFabProcessType(type)) {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }

  const rows = type
    ? openOnly
      ? await prisma.$queryRaw<DowntimeRow[]>`
          SELECT d.id, d.process_type, d.reason, d.notes, d.started_at, d.ended_at,
                 d.shift, w.name AS worker_name, m.name AS machine_name
          FROM fab_machine_downtime d
          LEFT JOIN fab_worker w ON w.id = d.worker_id
          LEFT JOIN fab_machine m ON m.id = d.machine_id
          WHERE d.process_type = ${type} AND d.ended_at IS NULL
          ORDER BY d.started_at DESC
          LIMIT 1
        `
      : await prisma.$queryRaw<DowntimeRow[]>`
          SELECT d.id, d.process_type, d.reason, d.notes, d.started_at, d.ended_at,
                 d.shift, w.name AS worker_name, m.name AS machine_name
          FROM fab_machine_downtime d
          LEFT JOIN fab_worker w ON w.id = d.worker_id
          LEFT JOIN fab_machine m ON m.id = d.machine_id
          WHERE d.process_type = ${type}
          ORDER BY d.started_at DESC
          LIMIT 50
        `
    : await prisma.$queryRaw<DowntimeRow[]>`
        SELECT d.id, d.process_type, d.reason, d.notes, d.started_at, d.ended_at,
               d.shift, w.name AS worker_name, m.name AS machine_name
        FROM fab_machine_downtime d
        LEFT JOIN fab_worker w ON w.id = d.worker_id
        LEFT JOIN fab_machine m ON m.id = d.machine_id
        ORDER BY d.started_at DESC
        LIMIT 80
      `;

  return Response.json(rows.map(serialize));
}

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const body = await req.json().catch(() => null);
  const action = body?.action === "end" ? "end" : body?.action === "log" ? "log" : "start";
  const processType = body?.processType;
  if (!isFabProcessType(processType)) {
    return Response.json({ error: "processType required" }, { status: 400 });
  }

  if (action === "log") return logPast(g.user.id as string, processType, body);
  if (action === "end") return endDowntime(g.tier, processType, body);
  return startLive(g.user.id as string, processType, body);
}

async function startLive(userId: string, processType: string, body: Record<string, unknown> | null) {
  const gate = await requireProcessSession(processType as never);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  const sess = gate.session;

  const reason = body?.reason;
  if (!isDowntimeReason(reason)) {
    return Response.json({ error: "Pick a downtime reason." }, { status: 400 });
  }
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  const open = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM fab_machine_downtime
    WHERE process_type = ${processType} AND ended_at IS NULL
    LIMIT 1
  `;
  if (open[0]) {
    return Response.json({ error: "This station already has open downtime. End it first." }, { status: 409 });
  }

  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO fab_machine_downtime (
      id, machine_id, process_type, reason, notes, started_at,
      worker_id, shift, session_id, user_id
    )
    VALUES (
      ${id}, ${sess.machineId}, ${processType}, ${reason}, ${notes || null}, NOW(),
      ${sess.workerId}, ${sess.shift}, ${sess.id}, ${userId}
    )
  `;

  return Response.json({ success: true, id, reasonLabel: downtimeLabel(reason) });
}

async function endDowntime(
  tier: string | null,
  processType: string,
  body: Record<string, unknown> | null,
) {
  const id = typeof body?.id === "string" ? body.id : "";
  const canSkipSession = tier === "SUPERVISOR" || tier === "MANAGER" || tier === "ADMIN";

  if (!canSkipSession) {
    const gate = await requireProcessSession(processType as never);
    if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  }

  const ended = id
    ? await prisma.$executeRaw`
        UPDATE fab_machine_downtime SET ended_at = NOW()
        WHERE id = ${id} AND ended_at IS NULL AND process_type = ${processType}
      `
    : await prisma.$executeRaw`
        UPDATE fab_machine_downtime SET ended_at = NOW()
        WHERE process_type = ${processType} AND ended_at IS NULL
      `;
  if (ended === 0) return Response.json({ error: "No open downtime to end." }, { status: 400 });
  return Response.json({ success: true });
}

async function logPast(userId: string, processType: string, body: Record<string, unknown> | null) {
  const reason = body?.reason;
  if (!isDowntimeReason(reason)) {
    return Response.json({ error: "Pick a downtime reason." }, { status: 400 });
  }
  const workerId = typeof body?.workerId === "string" ? body.workerId.trim() : "";
  const shift = typeof body?.shift === "string" ? body.shift.trim() : "";
  if (!workerId) return Response.json({ error: "Pick who was on the machine." }, { status: 400 });
  if (!FAB_SHIFTS.some(s => s.id === shift)) {
    return Response.json({ error: "Pick a shift." }, { status: 400 });
  }
  const worker = await getActiveFabWorker(workerId);
  if (!worker) return Response.json({ error: "That name is not on the roster." }, { status: 404 });

  const startedAt = parseWhen(body?.startedAt);
  if (!startedAt) return Response.json({ error: "Start time is required." }, { status: 400 });
  const endedRaw = body?.endedAt;
  const endedAt = endedRaw == null || endedRaw === "" ? null : parseWhen(endedRaw);
  if (endedRaw && !endedAt) return Response.json({ error: "End time is not a valid date." }, { status: 400 });
  if (endedAt && endedAt.getTime() < startedAt.getTime()) {
    return Response.json({ error: "End time cannot be before start time." }, { status: 400 });
  }

  const machines = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM fab_machine WHERE type::text = ${processType} ORDER BY code ASC LIMIT 1
  `;
  if (!machines[0]) {
    return Response.json({ error: `No ${FAB_PROCESS_LABEL[processType as never]} machine is set up.` }, { status: 404 });
  }

  if (!endedAt) {
    const open = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM fab_machine_downtime
      WHERE process_type = ${processType} AND ended_at IS NULL
      LIMIT 1
    `;
    if (open[0]) {
      return Response.json({ error: "This station already has open downtime. End it or give an end time." }, { status: 409 });
    }
  }

  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO fab_machine_downtime (
      id, machine_id, process_type, reason, notes, started_at, ended_at,
      worker_id, shift, session_id, user_id
    )
    VALUES (
      ${id}, ${machines[0].id}, ${processType}, ${reason}, ${notes || null},
      ${startedAt}, ${endedAt},
      ${worker.id}, ${shift}, ${null}, ${userId}
    )
  `;

  return Response.json({ success: true, id, reasonLabel: downtimeLabel(reason) });
}

function parseWhen(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

interface DowntimeRow {
  id: string;
  process_type: string;
  reason: string;
  notes: string | null;
  started_at: Date;
  ended_at: Date | null;
  shift: string | null;
  worker_name: string | null;
  machine_name: string | null;
}

function serialize(r: DowntimeRow) {
  return {
    id: r.id,
    processType: r.process_type,
    reason: r.reason,
    reasonLabel: downtimeLabel(r.reason),
    notes: r.notes,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    shift: r.shift,
    workerName: r.worker_name,
    machineName: r.machine_name,
    open: r.ended_at == null,
  };
}
