import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "./auth.config";

// ---- failed-login throttle (per email+IP, fixed window) ----
// In-memory: per serverless instance, so it slows distributed brute force
// rather than hard-stopping it — good enough for a small internal user base.
// 5 failures -> locked for 15 minutes (success clears the counter).
const FAILS_MAX = 5;
const FAIL_WINDOW_MS = 15 * 60_000;
const failedLogins = new Map<string, { n: number; first: number }>();
function throttleKey(email: string, req: Request | undefined): string {
  const ip = req?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  return `${email.toLowerCase()}|${ip}`;
}
function isLocked(key: string): boolean {
  const f = failedLogins.get(key);
  if (!f) return false;
  if (Date.now() - f.first > FAIL_WINDOW_MS) { failedLogins.delete(key); return false; }
  return f.n >= FAILS_MAX;
}
function recordFailure(key: string) {
  const f = failedLogins.get(key);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failedLogins.set(key, { n: 1, first: Date.now() });
  else f.n += 1;
  if (failedLogins.size > 5000) failedLogins.clear(); // bound memory
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  branch: z.enum(["SHOP_FLOOR", "OFFICE"]).optional(),
});

// Full config (Node runtime: API routes + server actions). Adds the Prisma-backed
// Credentials provider on top of the edge-safe authConfig.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        branch: { label: "Branch", type: "text" },
      },
      authorize: async (raw, request) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, branch } = parsed.data;
        const tkey = throttleKey(email, request as Request | undefined);
        if (isLocked(tkey)) return null; // too many failures — wait out the window
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) { recordFailure(tkey); return null; }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) { recordFailure(tkey); return null; }
        failedLogins.delete(tkey);
        const userBranch = ((user as { branch?: string | null }).branch as string | null) ?? "SHOP_FLOOR";
        const isAdmin = String(user.role) === "ADMIN";
        // Non-admins may only sign into their own branch; ADMIN may enter either.
        if (branch && !isAdmin && userBranch !== branch) return null;
        const effectiveBranch = isAdmin ? (branch ?? userBranch) : userBranch;
        return { id: user.id, email: user.email, name: user.name, role: user.role, station: (user as { station?: string | null }).station ?? null, branch: effectiveBranch, sv: (user as { sessionVersion?: number }).sessionVersion ?? 1 } as never;
      },
    }),
  ],
});
