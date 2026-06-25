import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "./auth.config";

// ---- failed-login throttle (per email+IP, fixed window) ----
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
  if (failedLogins.size > 5000) failedLogins.clear();
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  branch: z.enum(["SHOP_FLOOR", "OFFICE"]).optional(),
});

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
        if (isLocked(tkey)) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) { recordFailure(tkey); return null; }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) { recordFailure(tkey); return null; }
        failedLogins.delete(tkey);
        const userBranch = ((user as { branch?: string | null }).branch as string | null) ?? "SHOP_FLOOR";
        const isAdmin = String(user.role) === "ADMIN";
        if (branch && !isAdmin && userBranch !== branch) return null;
        const effectiveBranch = isAdmin ? (branch ?? userBranch) : userBranch;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          station: (user as { station?: string | null }).station ?? null,
          branch: effectiveBranch,
          sv: (user as { sessionVersion?: number }).sessionVersion ?? 1,
          fabRole: (user as any).fabRole ?? null,
        } as never;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Validate sessionVersion on every JWT refresh.
     * When the user logs out, fabSignOut bumps user.sessionVersion in DB.
     * Any JWT with an older sv is rejected here, forcing re-login on all devices.
     */
    async jwt(params) {
      const { token, user } = params;

      // Initial sign-in: user object present — set token fields
      if (user) {
        token.role     = (user as any).role;
        token.uid      = user.id as string;
        token.station  = (user as any).station ?? null;
        token.branch   = (user as any).branch ?? null;
        token.sv       = (user as any).sv ?? 1;
        token.fabRole  = (user as any).fabRole ?? null;
        return token;
      }

      // Subsequent requests: validate sessionVersion against DB
      // (runs every updateAge = 30 min, or when auth() is called)
      if (token.uid) {
        const dbUser = await prisma.user.findUnique({
          where:  { id: token.uid as string },
          select: { sessionVersion: true, active: true },
        }).catch(() => null);

        // If user deactivated OR sessionVersion bumped (logout-all triggered) → invalidate
        if (!dbUser || !dbUser.active || dbUser.sessionVersion !== (token.sv as number ?? 1)) {
          return null as any; // NextAuth treats null return as invalid session
        }
      }

      return token;
    },
  },
});
