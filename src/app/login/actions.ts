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
    const user = await prisma.user.findUnique({ where: { email }, select: { role: true, branch: true } });
    if (user && String(user.branch) === "FABRICATION") {
      const role = String(user.role);
      // Fabrication staff land in their part of the fab module (admins use the main shell)
      redirectTo =
        role === "ADMIN"        ? "/" :
        role === "LINE_MANAGER" ? "/fab/projects" :
        role === "INCHARGE"     ? "/fab/supervisor" :
                                  "/fab/session";   // OPERATOR -> pick machine
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
