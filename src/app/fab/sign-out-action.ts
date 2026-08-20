"use server";

import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

/**
 * Combined fab sign-out — logs out from ALL devices:
 * 1. Bumps user.sessionVersion → any JWT issued before this moment is rejected
 *    by the jwt callback in auth.ts, forcing re-login on every other device.
 * 2. Ends ALL active FabMachineSessions for the user (shop-floor tablets).
 * 3. Clears machine cookies on this device.
 * 4. Signs out of NextAuth (clears this device's JWT cookie).
 */
export async function fabSignOut() {
  const session = await auth();
  if (session?.user) {
    const userId = (session.user as any).id as string | undefined;
    if (userId) {
      // Bump sessionVersion — all other devices' JWT tokens become invalid
      await prisma.user.update({
        where: { id: userId },
        data:  { sessionVersion: { increment: 1 } },
      });
      // End all active machine sessions across all devices
      await prisma.fabMachineSession.updateMany({
        where: { userId, isActive: true },
        data:  { isActive: false, logoutTime: new Date() },
      });
    }
    const cookieStore = await cookies();
    for (const name of [
      "fab_machine_type","fab_machine_id","fab_machine_name","fab_session_id",
      "fab_ps_CUTTING","fab_ps_POLISHING","fab_ps_SINK_CUTTING","fab_ps_FABRICATION","fab_ps_PACKAGING",
    ]) {
      cookieStore.delete(name);
    }
  }
  await signOut({ redirectTo: "/login" });
}
