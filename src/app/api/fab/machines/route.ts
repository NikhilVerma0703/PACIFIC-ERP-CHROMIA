import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId  = g.user.id as string | undefined;

  // Auto-expire sessions older than 12 hours
  const expiryCutoff = new Date(Date.now() - SESSION_MAX_MS);
  await prisma.fabMachineSession.updateMany({
    where: { isActive: true, loginTime: { lt: expiryCutoff } },
    data:  { isActive: false, logoutTime: new Date() },
  });

  const [machines, activeSessions] = await Promise.all([
    prisma.fabMachine.findMany({ orderBy: [{ type: "asc" }, { code: "asc" }] }),
    prisma.fabMachineSession.findMany({
      where:   { isActive: true },
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  // Map machine → session, tagging whether it belongs to the current user
  const sessionByMachine: Record<string, {
    user: { name: string | null };
    shift: string;
    loginTime: Date;
    isCurrentUser: boolean;
  }> = {};
  for (const s of activeSessions) {
    sessionByMachine[s.machineId] = {
      user:          s.user,
      shift:         s.shift,
      loginTime:     s.loginTime,
      isCurrentUser: s.userId === userId,
    };
  }

  const body = machines.map(m => ({
    ...m,
    activeSession: sessionByMachine[m.id] ?? null,
  }));
  return Response.json(body, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
