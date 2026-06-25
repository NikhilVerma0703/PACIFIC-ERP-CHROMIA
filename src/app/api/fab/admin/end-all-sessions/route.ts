// POST /api/fab/admin/end-all-sessions
// Force-closes every active machine session.
// Used by supervisor/admin when operators forgot to log out (e.g. after a shift).

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  const fabRole  = (session?.user as any)?.fabRole;
  const mainRole = (session?.user as any)?.role;
  if (!["FAB_ADMIN","FAB_MANAGER","FAB_SUPERVISOR"].includes(fabRole) && mainRole !== "ADMIN")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const result = await prisma.fabMachineSession.updateMany({
    where: { isActive: true },
    data:  { isActive: false, logoutTime: now },
  });

  return Response.json({ success: true, closed: result.count });
}
