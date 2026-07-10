// Auto-expire FabMachineSessions that have been active for longer than
// SESSION_MAX_HOURS without an explicit logout (e.g. operator shut down PC).
// Called at the top of session/start and CEO routes so stale rows are cleaned
// up the moment someone next interacts with the fab system.

import { prisma } from "@/lib/prisma";

const SESSION_MAX_HOURS = 14; // longer than the 12-h cookie so nothing valid is cut

export async function expireStaleSessions() {
  const cutoff = new Date(Date.now() - SESSION_MAX_HOURS * 60 * 60 * 1000);
  await prisma.fabMachineSession.updateMany({
    where: { isActive: true, loginTime: { lt: cutoff } },
    data:  { isActive: false, logoutTime: cutoff },
  });
}
