import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Role hierarchy (low -> high). Kept as string-typed so this compiles even
// before `prisma generate` refreshes the @prisma/client enum.
export type RoleName = "OPERATOR" | "INCHARGE" | "LINE_MANAGER" | "ADMIN" | "FINANCE" | "ACCOUNTS" | "STORE" | "MAINTENANCE";
export type StationName =
  | "PRESS" | "OVEN" | "JOT" | "MIXER" | "KREOS"
  | "DISTRIBUTOR" | "SILO" | "POLISH_QC" | "POLISH_ENTRY";

export const STATIONS: StationName[] = ["PRESS", "OVEN", "JOT", "MIXER", "KREOS", "DISTRIBUTOR", "SILO", "POLISH_QC", "POLISH_ENTRY"];
export const STATION_LABEL: Record<string, string> = {
  PRESS: "Press", OVEN: "Oven", JOT: "Jot", MIXER: "Mixer", KREOS: "Kreos",
  DISTRIBUTOR: "Distributor", SILO: "Silo", POLISH_QC: "Polish QC", POLISH_ENTRY: "Polish Entry",
};

// FINANCE and ACCOUNTS are flat office roles directly under ADMIN (rank 2:
// they may edit office tables, but user management stays admin-only in Office).
export const ROLE_RANK: Record<string, number> = { OPERATOR: 1, STORE: 1, MAINTENANCE: 1, INCHARGE: 2, FINANCE: 2, ACCOUNTS: 2, LINE_MANAGER: 3, ADMIN: 4 };
export const ROLE_LABEL: Record<string, string> = {
  OPERATOR: "Operator", INCHARGE: "Incharge", LINE_MANAGER: "Line Manager", ADMIN: "Administrator",
  FINANCE: "Finance", ACCOUNTS: "Accounts", STORE: "Store Incharge", MAINTENANCE: "Maintenance Manager",
};
export function rankOf(role?: string | null): number { return ROLE_RANK[String(role ?? "")] ?? 0; }

/** The session user, REVALIDATED against the database on every request:
 * a deactivated user or a bumped sessionVersion is treated as signed out
 * immediately, on every device. Request-cached so gates share one query. */
export const currentUser = cache(async () => {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = await (prisma as any).user.findUnique({ where: { id: u.id }, select: { active: true, sessionVersion: true } });
    if (!row || row.active === false) return null;
    const tokenSv = Number((u as { sv?: number }).sv ?? 1);
    if (Number(row.sessionVersion ?? 1) !== tokenSv) return null; // revoked -> signed out everywhere
  } catch { /* sessionVersion not migrated yet — allow */ }
  return u;
});
export async function currentRole(): Promise<string> {
  return String((await currentUser())?.role ?? "");
}

/** Any authenticated user may enter production data (operators do this). */
export async function canEnterData(): Promise<boolean> {
  return !!(await currentUser());
}

/** Incharge and above can rectify batch errors (dedupe, add missing, design fix, undo) and edit records. */
export async function canRectify(): Promise<boolean> {
  return rankOf(await currentRole()) >= ROLE_RANK.INCHARGE;
}

/** Line-manager and above (kept for broader admin gates). */
export async function isManager(): Promise<boolean> {
  return rankOf(await currentRole()) >= ROLE_RANK.LINE_MANAGER;
}

export async function isAdmin(): Promise<boolean> {
  return rankOf(await currentRole()) >= ROLE_RANK.ADMIN;
}

/** Shop Floor: incharge and above manage users. Office: ADMIN only
 * (Finance and Accounts are flat — neither manages the other). */
export async function canManageUsers(): Promise<boolean> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const branch = ((u as any)?.branch as string | undefined) ?? "SHOP_FLOOR";
  const rank = rankOf((u as { role?: string } | null)?.role);
  return branch === "OFFICE" ? rank >= ROLE_RANK.ADMIN : rank >= ROLE_RANK.INCHARGE;
}

/** The roles a given role may create, per branch.
 * Shop Floor: anything strictly below (LM -> Incharge -> Operator).
 * Office: ADMIN creates the flat Finance / Accounts roles; nobody else creates. */
export function creatableRoles(role?: string | null, branch?: string | null): RoleName[] {
  const r = rankOf(role);
  if (branch === "OFFICE") return r >= ROLE_RANK.ADMIN ? (["FINANCE", "ACCOUNTS"] as RoleName[]) : [];
  return (["LINE_MANAGER", "INCHARGE", "OPERATOR", "STORE", "MAINTENANCE"] as RoleName[]).filter((x) => ROLE_RANK[x] < r);
}

/** Store Incharge (or incharge+) manage the two-tier RM store (upload + assign). */
export async function canManageRm(): Promise<boolean> {
  const role = await currentRole();
  return role === "STORE" || rankOf(role) >= ROLE_RANK.ADMIN;
}
/** True when the signed-in user is a Store Incharge (capped role). */
export async function isStore(): Promise<boolean> {
  return (await currentRole()) === "STORE";
}
/** True when the signed-in user is a Maintenance Manager (capped role). */
export async function isMaintenance(): Promise<boolean> {
  return (await currentRole()) === "MAINTENANCE";
}
/** Maintenance Manager or admin may fill the maintenance response on a downtime incident. */
export async function canRespondDowntime(): Promise<boolean> {
  const role = await currentRole();
  return role === "MAINTENANCE" || rankOf(role) >= ROLE_RANK.ADMIN;
}

/** A stable synthetic Airtable-style id for records created in the new system. */
export function localId(prefix = "local"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
