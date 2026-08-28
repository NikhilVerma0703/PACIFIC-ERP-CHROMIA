import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sessionUserRow } from "@/lib/sessionRevalidation";
import { getAltContext } from "@/lib/users";
import { authConfig } from "./auth.config";

// ---- failed-login throttle (per email+IP, fixed window) ----
// Sensible for humans, hostile to bots: 10 wrong passwords in 15 minutes locks
// that email+IP pair, the lock lifts by itself when the window ends, and one
// successful login clears the count. Typos never lock anyone out for long.
const FAILS_MAX = 10;
const FAIL_WINDOW_MS = 15 * 60_000;
const failedLogins = new Map<string, { n: number; first: number }>();
function throttleKey(email: string, req: Request | undefined): string {
  const ip = req?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  return `${email.toLowerCase()}|${ip}`;
}
function isLockedMem(key: string): boolean {
  const f = failedLogins.get(key);
  if (!f) return false;
  if (Date.now() - f.first > FAIL_WINDOW_MS) { failedLogins.delete(key); return false; }
  return f.n >= FAILS_MAX;
}
function recordFailureMem(key: string) {
  const f = failedLogins.get(key);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failedLogins.set(key, { n: 1, first: Date.now() });
  else f.n += 1;
  if (failedLogins.size > 5000) failedLogins.clear();
}
// DB-backed versions: survive across serverless instances (the in-memory map is
// per-lambda, so alone it under-counts a distributed attack). If the
// login_attempt table is missing, fall back to the in-memory throttle.
async function isLocked(key: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT true AS locked FROM login_attempt
      WHERE key = ${key} AND n >= ${FAILS_MAX} AND first_at > now() - interval '15 minutes'`;
    return rows.length > 0;
  } catch { return isLockedMem(key); }
}
async function recordFailure(key: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO login_attempt (key, n, first_at) VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        n = CASE WHEN login_attempt.first_at < now() - interval '15 minutes' THEN 1 ELSE login_attempt.n + 1 END,
        first_at = CASE WHEN login_attempt.first_at < now() - interval '15 minutes' THEN now() ELSE login_attempt.first_at END`;
    // opportunistic cleanup of stale rows (cheap, tiny table)
    if (Math.random() < 0.02) await prisma.$executeRaw`DELETE FROM login_attempt WHERE first_at < now() - interval '1 day'`;
  } catch { recordFailureMem(key); }
}
async function clearFailures(key: string): Promise<void> {
  try { await prisma.$executeRaw`DELETE FROM login_attempt WHERE key = ${key}`; } catch { /* table absent */ }
  failedLogins.delete(key);
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  branch: z.enum(["SHOP_FLOOR", "OFFICE", "INTERNATIONAL_SALES"]).optional(),
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
        if (await isLocked(tkey)) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) { await recordFailure(tkey); return null; }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) { await recordFailure(tkey); return null; }
        const userBranch = ((user as { branch?: string | null }).branch as string | null) ?? "SHOP_FLOOR";
        const isAdmin = String(user.role) === "ADMIN";
        // Fabrication is shop-side: a fab user logs in via the Shop Floor portal,
        // then is routed to /fab by their DB branch. Only reject a true office<->shop mismatch.
        const side = (b: string) => (b === "OFFICE" ? "OFFICE" : b === "INTERNATIONAL_SALES" ? "SALES" : "SHOP");
        if (branch && !isAdmin && side(userBranch) !== side(branch)) return null;
        await clearFailures(tkey); // fully valid sign-in — reset the counter
        const effectiveBranch = isAdmin ? (branch ?? userBranch) : userBranch;
        // The SECOND GRANTED PAIR, read here so it can ride in the JWT: both
        // gates are Prisma-free and have nothing else to read it from, and a
        // gate that cannot see what was granted cannot agree with currentUser()
        // about which pair is active. Read by raw SQL and guarded (see
        // lib/users.ts) because the generated client does not know the columns
        // until scripts/0052 is applied and `prisma generate` re-runs; until
        // then this is nulls, which is "one job" — today's behaviour exactly.
        //
        // A REVOKED SECOND JOB THEREFORE LIVES UNTIL THE NEXT SIGN-IN, the same
        // as a changed role or branch already does in this app (the jwt
        // callback below revalidates sessionVersion and nothing else). Users &
        // Roles closes that window by bumping sessionVersion whenever it
        // changes the grant, which signs the login out of every device.
        const alt = await getAltContext(user.id);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          station: (user as { station?: string | null }).station ?? null,
          branch: effectiveBranch,
          altRole: alt.altRole,
          altBranch: alt.altBranch,
          sv: (user as { sessionVersion?: number }).sessionVersion ?? 1,
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
        token.role      = (user as any).role;
        token.uid       = user.id as string;
        token.station   = (user as any).station ?? null;
        token.branch    = (user as any).branch ?? null;
        // The second granted pair. Carried, never derived: the gates compare a
        // cookie against these two values and fall back to role/branch above.
        token.altRole   = (user as any).altRole ?? null;
        token.altBranch = (user as any).altBranch ?? null;
        token.sv        = (user as any).sv ?? 1;
        return token;
      }

      // Subsequent requests: validate sessionVersion against DB
      // (runs every updateAge = 30 min, or when auth() is called).
      // sessionUserRow is request-cached: Shell's auth(), currentUser()'s auth()
      // and currentUser()'s own revalidation used to fire this identical query
      // up to 3x per navigation (measured 2026-08-14) — the check still runs on
      // every request, it just shares one row per request.
      if (token.uid) {
        const dbUser = await sessionUserRow(token.uid as string).catch(() => null);

        // If user deactivated OR sessionVersion bumped (logout-all triggered) → invalidate
        if (!dbUser || !dbUser.active || dbUser.sessionVersion !== (token.sv as number ?? 1)) {
          return null as any; // NextAuth treats null return as invalid session
        }
      }

      return token;
    },
  },
});
