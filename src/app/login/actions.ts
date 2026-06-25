"use server";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData
): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  let redirectTo = "/";
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { fabRole: true } });
    if (user?.fabRole) {
      const fabRole = user.fabRole as string;
      // FAB_ADMIN → main ERP home (can navigate to fab via sidebar)
      // FAB_MANAGER/SUPERVISOR/EMPLOYEE → direct fab landing
      redirectTo =
        fabRole === "FAB_ADMIN"       ? "/" :
        fabRole === "FAB_MANAGER"     ? "/fab/projects" :
        fabRole === "FAB_SUPERVISOR"  ? "/fab/supervisor" :
                                        "/fab/session";
    }
  } catch { /* non-critical */ }
  try {
    await signIn("credentials", {
      email:     formData.get("email"),
      password:  formData.get("password"),
      branch:    formData.get("branch") || undefined,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return "Invalid email or password — or this login belongs to the other branch.";
    throw error;
  }
}
