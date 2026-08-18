// POST /api/fab/admin/end-all-sessions
// Force-closes every active machine session.
// Used by supervisor/admin when operators forgot to log out (e.g. after a shift).

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST() {
  const g = await fabGate("MANAGER");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const now = new Date();
  const result = await prisma.fabMachineSession.updateMany({
    where: { isActive: true },
    data:  { isActive: false, logoutTime: now },
  });

  return Response.json({ success: true, closed: result.count });
}
