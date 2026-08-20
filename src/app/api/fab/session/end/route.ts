import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { isFabProcessType } from "@/lib/fab/processSession";
import { clearProcessSessionCookie, readProcessSession } from "@/lib/fab/processSessionServer";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const body = await req.json().catch(() => ({}));
  const processType = (body as { processType?: unknown }).processType;
  if (!isFabProcessType(processType)) {
    return Response.json({ error: "processType required" }, { status: 400 });
  }

  const existing = await readProcessSession(processType);
  if (existing) {
    await prisma.fabMachineSession.updateMany({
      where: { id: existing.id, isActive: true },
      data: { isActive: false, logoutTime: new Date() },
    });
  }
  await clearProcessSessionCookie(processType);

  return Response.json({ success: true });
}
