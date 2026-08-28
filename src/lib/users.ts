// Server-side user directory helpers. Uses (prisma as any) so it compiles
// before `prisma generate` refreshes the client for station/createdById.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const db = prisma as any;

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  station: string | null;
  active: boolean;
  branch: string;
  createdAt: Date;
  createdByName: string | null;
  // International Sales duty + factory scope (users.sales_role / sales_factory, scripts/0020)
  salesRole: string | null;
  salesFactory: string | null;
  // The SECOND granted role+branch — the other job of somebody who holds two
  // (users.alt_role / users.alt_branch, scripts/0052). Null for everybody else,
  // and null for everybody until that script is applied.
  altRole: string | null;
  altBranch: string | null;
}

/** EXACTLY THE COLUMNS THIS LIST MAPS, AND NOT ONE MORE.
 *
 *  Without it Prisma returns every scalar on the row, which now includes
 *  passwordHash and — since the smtp_* columns were declared on the model so
 *  `db push` stops dropping them — a salesperson's outbound mail PASSWORD. The
 *  mapping below never forwards either, so nothing leaked; but fetching a
 *  password into the admin screen's memory to throw it away is a hazard waiting
 *  for someone to add a spread, and the fix costs one object. */
const USER_LIST_SELECT = {
  id: true, email: true, name: true, role: true, station: true,
  active: true, branch: true, createdAt: true, createdById: true,
  salesRole: true, salesFactory: true,
} as const;

export async function listUsersRows(branch?: string | string[] | null): Promise<UserRow[]> {
  let rows: any[];
  try {
    rows = await db.user.findMany({ select: USER_LIST_SELECT, where: branch ? { branch: Array.isArray(branch) ? { in: branch } : branch } : undefined, orderBy: [{ active: "desc" }, { email: "asc" }] });
  } catch {
    // branch column (or an enum VALUE, e.g. INTERNATIONAL_SALES before 0023)
    // not migrated yet — fall back to unfiltered, then filter in JS so a failed
    // WHERE can never leak other departments' users into a branch-scoped list.
    rows = await db.user.findMany({ select: USER_LIST_SELECT, orderBy: [{ active: "desc" }, { email: "asc" }] });
    if (branch) {
      const want = Array.isArray(branch) ? branch : [branch];
      rows = rows.filter((u) => want.includes(String(u.branch ?? "SHOP_FLOOR")));
    }
  }
  const nameById = new Map<string, string>(rows.map((u) => [u.id, u.name ?? u.email]));
  // The second granted pair, in ONE extra query rather than one per row. Its
  // own guard: an empty map (script 0052 not applied) reads as "nobody holds a
  // second job", which is what the screen showed before this feature.
  const alts = await listAltContexts();
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: String(u.role),
    station: u.station ?? null,
    active: !!u.active,
    branch: String(u.branch ?? "SHOP_FLOOR"),
    createdAt: u.createdAt,
    createdByName: u.createdById ? (nameById.get(u.createdById) ?? null) : null,
    salesRole: u.salesRole ?? null,
    salesFactory: u.salesFactory ?? null,
    altRole: alts.get(u.id)?.altRole ?? null,
    altBranch: alts.get(u.id)?.altBranch ?? null,
  }));
}

export async function getUserRole(id: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id }, select: { role: true } });
  return u?.role ? String(u.role) : null;
}

/**
 * EVERY ROLE A LOGIN CAN REACH — primary and alternate — for the callers that
 * ask "how senior is this account".
 *
 * getUserRole answers with the PRIMARY only, and that is the right answer for
 * "what is this person's job". It is the wrong answer for an authority check,
 * because a login with a second job can switch into it: judging it by the
 * primary alone judges it by its weaker half. A rank-2 INCHARGE could reset the
 * password of a rank-1 OPERATOR who also holds a rank-3 LINE_MANAGER
 * alternate, sign in as them, switch context, and come out above where they
 * started.
 *
 * So authority is measured against the HIGHEST role the account can wear, not
 * the one it happens to be wearing. Callers that want the label — a table cell,
 * a heading — keep using getUserRole.
 *
 * Fails closed: getAltContext returns nulls when 0052 has not been applied, and
 * the result is then exactly the primary, which is what the screen did before
 * second jobs existed.
 */
export async function getUserRoles(id: string): Promise<string[]> {
  const u = await db.user.findUnique({ where: { id }, select: { role: true } });
  if (!u?.role) return [];
  const { altRole } = await getAltContext(id);
  const roles = [String(u.role)];
  if (altRole && altRole !== String(u.role)) roles.push(altRole);
  return roles;
}

/** A login's PRIMARY pair, straight from the row — what an alternate grant has
 *  to be checked against (a second job that is the same job is not one). */
export async function getUserPrimary(id: string): Promise<{ role: string; branch: string } | null> {
  const u = await db.user.findUnique({ where: { id }, select: { role: true, branch: true } });
  if (!u) return null;
  return { role: String(u.role), branch: String(u.branch ?? "SHOP_FLOOR") };
}

export async function createUserRecord(input: {
  email: string; name: string | null; password: string; role: string; station: string | null; createdById: string | null; branch?: string | null;
  // International Sales only: duty + factory scope written to users.sales_role / sales_factory
  salesRole?: string | null; salesFactory?: string | null;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const base = {
    email: input.email,
    name: input.name,
    passwordHash,
    role: input.role,
    station: input.station,
    createdById: input.createdById,
  };
  const sales = input.salesRole !== undefined || input.salesFactory !== undefined
    ? { salesRole: input.salesRole ?? null, salesFactory: input.salesFactory ?? null }
    : {};
  try {
    return await db.user.create({ data: { ...base, ...sales, branch: input.branch ?? "SHOP_FLOOR" } });
  } catch (e: any) {
    if (String(e?.message || "").includes("branch")) return db.user.create({ data: base }); // pre-migration fallback
    throw e;
  }
}

export async function setActiveRecord(id: string, active: boolean) {
  // deactivation also kills every live session of that user
  const data = active ? { active } : { active, sessionVersion: { increment: 1 } };
  try { return await db.user.update({ where: { id }, data }); }
  catch { return db.user.update({ where: { id }, data: { active } }); } // pre-migration fallback
}

export async function resetPasswordRecord(id: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  // a password reset signs the user out of all devices
  try { return await db.user.update({ where: { id }, data: { passwordHash, sessionVersion: { increment: 1 } } }); }
  catch { return db.user.update({ where: { id }, data: { passwordHash } }); }
}

/** Sign one user out of every device. */
export async function bumpSessionVersion(id: string) {
  return db.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
}

/** Sign EVERYONE out of every device (incl. the admin doing it). */
export async function bumpAllSessionVersions() {
  return db.user.updateMany({ data: { sessionVersion: { increment: 1 } } });
}

export async function setStationRecord(id: string, station: string | null) {
  return db.user.update({ where: { id }, data: { station } });
}

// ---------------------------------------------------------------------------
// The SECOND GRANTED PAIR (users.alt_role / users.alt_branch, scripts/0052).
//
// RAW SQL, not the Prisma client, and guarded — for the reason every other
// column added out-of-band in this repo is: `prisma generate` is not run here
// (the build runs it, this working copy cannot), so the generated client does
// not know these columns and would neither select nor write them. Raw SQL asks
// the database directly, and a failure means the script has not been applied
// yet: read answers "no alternate" and write answers false, so Users & Roles
// degrades to exactly the single-role screen it was before rather than
// throwing. The same shape as the sessionVersion and sales_role fallbacks
// above.
// ---------------------------------------------------------------------------

export interface AltContext { altRole: string | null; altBranch: string | null }

/** The alternate pair granted to one login, or nulls when there is none (or
 *  when scripts/0052 has not been applied). Never throws. */
export async function getAltContext(id: string): Promise<AltContext> {
  try {
    const rows = await prisma.$queryRaw<Array<{ alt_role: string | null; alt_branch: string | null }>>`
      SELECT alt_role::text AS alt_role, alt_branch::text AS alt_branch
      FROM users WHERE id = ${id} LIMIT 1
    `;
    return { altRole: rows[0]?.alt_role ?? null, altBranch: rows[0]?.alt_branch ?? null };
  } catch {
    return { altRole: null, altBranch: null };
  }
}

/** Every login's alternate pair, keyed by id — one query for the Users & Roles
 *  list rather than one per row. Empty map when 0052 has not been applied. */
export async function listAltContexts(): Promise<Map<string, AltContext>> {
  const out = new Map<string, AltContext>();
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; alt_role: string | null; alt_branch: string | null }>>`
      SELECT id, alt_role::text AS alt_role, alt_branch::text AS alt_branch
      FROM users WHERE alt_role IS NOT NULL OR alt_branch IS NOT NULL
    `;
    for (const r of rows) out.set(r.id, { altRole: r.alt_role ?? null, altBranch: r.alt_branch ?? null });
  } catch {
    /* column not applied yet — nobody holds a second job */
  }
  return out;
}

/**
 * Grant or revoke the second job.
 *
 * BOTH HALVES MOVE TOGETHER. A pair is granted whole or not at all: passing
 * either half null clears both, because a role without a branch is not a job
 * and lib/roleContext.ts treats a half-filled grant as no grant anyway. Writing
 * one half and leaving the other would leave a row that reads as revoked while
 * an admin believes it is granted.
 *
 * The values are interpolated as Prisma parameters and CAST to the enum types,
 * so anything that is not a real Role/Branch is rejected by Postgres rather
 * than stored — the same door the role and branch columns already stand behind.
 *
 * IT REPORTS WHY IT FAILED, and that is the whole reason it does not return a
 * bare boolean any more.
 *
 * A plain `catch { return false }` made the caller print ONE message — "apply
 * scripts/0052 first" — for every possible failure. So an admin who had already
 * applied 0052 was told to apply it again, with no hint that the real fault was
 * an enum value the database does not know, a row that had been deleted, or a
 * connection to the wrong database entirely. The message was confident, wrong,
 * and unfalsifiable from the screen.
 *
 * Postgres already distinguishes these; the codes below are simply passed on:
 *
 *   42703  undefined_column          alt_role / alt_branch are missing —
 *                                    scripts/0052 genuinely has not been run
 *                                    HERE, against THIS database.
 *   42704 / 22P02                    the Role or Branch enum has no such value.
 *          invalid_text_representation
 *                                    Usually a newer role (SAMPLING arrived
 *                                    with 0051) against an older database.
 *   42P01  undefined_table           no users table — wrong database.
 *
 * Anything else is handed back verbatim rather than translated, because a
 * message nobody predicted is still better than a guess.
 */
export type AltContextWrite = { ok: true } | { ok: false; reason: string };

export async function setAltContextRecord(
  id: string,
  altRole: string | null,
  altBranch: string | null,
): Promise<AltContextWrite> {
  const grant = altRole && altBranch ? { role: altRole, branch: altBranch } : null;
  try {
    if (grant) {
      await prisma.$executeRaw`
        UPDATE users SET alt_role = ${grant.role}::"Role", alt_branch = ${grant.branch}::"Branch" WHERE id = ${id}
      `;
    } else {
      await prisma.$executeRaw`UPDATE users SET alt_role = NULL, alt_branch = NULL WHERE id = ${id}`;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: explainAltContextError(e, grant) };
  }
}

/** Turns a Postgres failure into something an admin can act on. Exported so a
 *  test can pin the mapping without a database. */
export function explainAltContextError(
  e: unknown,
  grant: { role: string; branch: string } | null,
): string {
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  // Prisma puts the SQLSTATE in meta.code for raw queries and code for others.
  const sqlstate = String(err?.meta?.code ?? err?.code ?? "");
  const message = String(err?.message ?? "").trim();

  if (sqlstate === "42703" || /alt_role|alt_branch/.test(message)) {
    return "The alt_role / alt_branch columns are missing from THIS database. " +
      "Apply scripts/0052-user-alt-role-context.sql to the database DATABASE_URL points at " +
      "(check you are not pointed at Neon while testing locally, or the reverse).";
  }
  if (sqlstate === "42P01") {
    return "There is no users table in this database — DATABASE_URL is pointing somewhere unexpected.";
  }
  if (sqlstate === "22P02" || sqlstate === "42704" || /invalid input value for enum/i.test(message)) {
    const which = grant ? `"${grant.role}" or "${grant.branch}"` : "that value";
    return `This database's Role / Branch enums have no value ${which}. ` +
      "A newer role needs the script that added it — SAMPLING arrives with " +
      "scripts/0051-sampling-and-catalogue.sql — applied to this same database.";
  }
  // Never swallowed. An unpredicted message is worth more than a tidy guess.
  return message
    ? `The database refused the change: ${message}`
    : "The database refused the change, and gave no reason.";
}

