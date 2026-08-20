import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { expireStaleSessions } from "@/lib/fab/expireStaleSessions";
import { FAB_PROCESS_LABEL, FAB_SHIFTS, isFabProcessType } from "@/lib/fab/processSession";
import {
  clearProcessSessionCookie,
  readProcessSession,
  setProcessSessionCookie,
} from "@/lib/fab/processSessionServer";
import { getActiveFabWorker } from "@/lib/fab/workersDb";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  await expireStaleSessions();

  const body = await req.json().catch(() => null);
  const processType = body?.processType;
  const workerId = typeof body?.workerId === "string" ? body.workerId.trim() : "";
  const shift = typeof body?.shift === "string" ? body.shift.trim() : "";
  const machineIdIn = typeof body?.machineId === "string" ? body.machineId.trim() : "";

  if (!isFabProcessType(processType)) {
    return Response.json({ error: "processType required" }, { status: 400 });
  }
  if (!workerId) return Response.json({ error: "Pick a name." }, { status: 400 });
  if (!FAB_SHIFTS.some(s => s.id === shift)) {
    return Response.json({ error: "Pick a shift." }, { status: 400 });
  }

  const worker = await getActiveFabWorker(workerId);
  if (!worker) return Response.json({ error: "That name is not on the roster." }, { status: 404 });

  const machines = await prisma.fabMachine.findMany({
    where: { type: processType },
    orderBy: { code: "asc" },
  });
  if (!machines.length) {
    return Response.json({ error: `No ${FAB_PROCESS_LABEL[processType]} machine is set up.` }, { status: 404 });
  }

  const machine = machineIdIn
    ? machines.find(m => m.id === machineIdIn)
    : machines[0];
  if (!machine) return Response.json({ error: "That machine is not a " + FAB_PROCESS_LABEL[processType] + " machine." }, { status: 400 });

  const existing = await readProcessSession(processType);

  const occupied = await prisma.fabMachineSession.findFirst({
    where: {
      machineId: machine.id,
      isActive: true,
      ...(existing ? { id: { not: existing.id } } : {}),
    },
    select: { id: true },
  });
  if (occupied) {
    const whoRows = await prisma.$queryRaw<Array<{ name: string | null }>>`
      SELECT w.name FROM fab_machine_session s
      LEFT JOIN fab_worker w ON w.id = s.worker_id
      WHERE s.id = ${occupied.id}
      LIMIT 1
    `;
    const who = whoRows[0]?.name ?? "someone else";
    return Response.json(
      { error: `${machine.name} is already in a session (${who}). End that session first.` },
      { status: 409 },
    );
  }

  if (existing) {
    await prisma.fabMachineSession.updateMany({
      where: { id: existing.id, isActive: true },
      data: { isActive: false, logoutTime: new Date() },
    });
  }

  const machineSession = await prisma.fabMachineSession.create({
    data: {
      userId: g.user.id as string,
      machineId: machine.id,
      shift,
      isActive: true,
    },
  });
  await prisma.$executeRaw`
    UPDATE fab_machine_session SET worker_id = ${worker.id} WHERE id = ${machineSession.id}
  `;

  await setProcessSessionCookie(processType, machineSession.id);

  return Response.json({
    success: true,
    session: {
      id: machineSession.id,
      processType,
      workerName: worker.name,
      shift,
      machineName: machine.name,
    },
  });
}
