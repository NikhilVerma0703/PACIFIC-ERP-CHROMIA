import NextAuth, { CredentialsSignin } from "next-auth";
import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";
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
// MINUTES REMAINING, NOT A BOOLEAN. A throttled login used to be answered with
// "Invalid email or password", so somebody typing the RIGHT password during a
// 15-minute lock was told their password was wrong — they phoned for a reset,
// and the reset (resetPasswordRecord bumps sessionVersion) signed their phone
// and tablet out too. The window is what the person needs to hear, so the check
// has to be able to say it; see LoginThrottled below. 0 means not locked.
function lockedMinutesMem(key: string): number {
  const f = failedLogins.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > FAIL_WINDOW_MS) { failedLogins.delete(key); return 0; }
  if (f.n < FAILS_MAX) return 0;
  // Round UP, and never say "0 minutes": the last 59 seconds of a lock still
  // rejects the login, and "try again in 0 minutes" is how a support call starts.
  return Math.max(1, Math.ceil((FAIL_WINDOW_MS - (Date.now() - f.first)) / 60_000));
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
async function lockedMinutes(key: string): Promise<number> {
  try {
    // The countdown is computed by Postgres, from the same now() that wrote
    // first_at: a lambda whose clock has drifted from the database would
    // otherwise quote a window that does not match the one the WHERE clause
    // above is actually enforcing.
    const rows = await prisma.$queryRaw<{ mins: number }[]>`
      SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (first_at + interval '15 minutes' - now())) / 60))::int AS mins
      FROM login_attempt
      WHERE key = ${key} AND n >= ${FAILS_MAX} AND first_at > now() - interval '15 minutes'`;
    return Number(rows[0]?.mins ?? 0);
  } catch { return lockedMinutesMem(key); }
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

/**
 * "Too many attempts" instead of "wrong password" — WITHOUT saying whether the
 * address exists.
 *
 * Safe to show, because the throttle key is email+IP and a failure is recorded
 * for an UNKNOWN address exactly as it is for a real one (see authorize below):
 * ten wrong guesses at nobody@example.com from one IP lock that pair just the
 * same, so being told "locked" reveals only what the person at the keyboard
 * already did. What it does not do is call a correct password wrong.
 *
 * It is a CredentialsSignin subclass so Auth.js keeps treating it as an
 * ordinary failed sign-in: `type` stays "CredentialsSignin" (inherited via the
 * static), the API route still redirects to the login page, and only `code`
 * differs. The server action that calls signIn() catches AuthError and decides
 * what the person reads — `userMessage` is that string, kept separate from
 * `message` because AuthError's constructor appends "Read more at
 * errors.authjs.dev#..." to whatever message it is given.
 */
export class LoginThrottled extends CredentialsSignin {
  code = "throttled";
  readonly minutes: number;
  readonly userMessage: string;
  constructor(minutes: number) {
    super(`Login throttled for ${minutes} more minute(s)`);
    this.minutes = minutes;
    this.userMessage = `Too many failed attempts — try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
}

// A real bcrypt hash, at the SAME cost factor (10) createUserRecord hashes
// passwords with, of a passphrase nobody can type. It exists so that an unknown
// email costs the same as a known one: bcrypt at cost 10 is ~60-100 ms on the
// Vercel runtime and skipping it made a miss answer measurably sooner, which is
// all an attacker needs to sort a list of guessed addresses into "works here"
// and "does not". Never compare a real password against this for any other
// purpose, and do not lower the cost below the one used to hash real passwords
// or the two paths stop matching again.
const TIMING_DUMMY_HASH = "$2a$10$s/D6gZhZHTdRDwI2SetPTO6JL2X1vw/hIRGCRStByArHm7Qs8cRGO";

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
        const locked = await lockedMinutes(tkey);
        if (locked > 0) throw new LoginThrottled(locked);
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) {
          // Burn the same bcrypt round the found-user path burns below, so an
          // unknown (or deactivated) address takes as long to reject as a known
          // one. Discarded on purpose — the result is never used.
          await bcrypt.compare(password, TIMING_DUMMY_HASH);
          await recordFailure(tkey);
          return null;
        }
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
    async jwt(params: { token: JWT; user?: User | null }) {
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
