import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Role hierarchy (low -> high). Kept as string-typed so this compiles even
// before `prisma generate` refreshes the @prisma/client enum.
export type RoleName = "OPERATOR" | "INCHARGE" | "LINE_MANAGER" | "ADMIN" | "FINANCE" | "ACCOUNTS" | "SALES" | "COMMERCIAL" | "STORE" | "MAINTENANCE" | "ROBO";
export type StationName =
  | "PRESS" | "OVEN" | "JOT" | "MIXER" | "KREOS"
  | "DISTRIBUTOR" | "SILO" | "POLISH_QC" | "POLISH_ENTRY" | "CUTTING";

export const STATIONS: StationName[] = ["PRESS", "OVEN", "JOT", "MIXER", "KREOS", "DISTRIBUTOR", "SILO", "POLISH_QC", "POLISH_ENTRY", "CUTTING"];
export const STATION_LABEL: Record<string, string> = {
  PRESS: "Press", OVEN: "Oven", JOT: "Jot", MIXER: "Mixer", KREOS: "Kreos",
  DISTRIBUTOR: "Distributor", SILO: "Silo", POLISH_QC: "Polish QC", POLISH_ENTRY: "Polish Entry", CUTTING: "Cutting",
};

// FINANCE and ACCOUNTS are flat office roles directly under ADMIN (rank 2:
// they may edit office tables, but user management stays admin-only in Office).
export const ROLE_RANK: Record<string, number> = { OPERATOR: 1, STORE: 1, MAINTENANCE: 1, SALES: 1, COMMERCIAL: 1, ROBO: 1, INCHARGE: 2, FINANCE: 2, ACCOUNTS: 2, LINE_MANAGER: 3, ADMIN: 4 };
export const ROLE_LABEL: Record<string, string> = {
  OPERATOR: "Operator", INCHARGE: "Incharge", LINE_MANAGER: "Line Manager", ADMIN: "Administrator",
  FINANCE: "Finance", ACCOUNTS: "Accounts", SALES: "Sales", COMMERCIAL: "Commercial", STORE: "Store Incharge", MAINTENANCE: "Maintenance Manager",
  ROBO: "Robo Operator",
};
export function rankOf(role?: string | null): number { return ROLE_RANK[String(role ?? "")] ?? 0; }

/** Fabrication shares the ONE role hierarchy with Shop Floor (LINE_MANAGER /
 * INCHARGE / OPERATOR — see lib/fab/access.ts's fabTierOf: there is no
 * parallel fabRole field), but the generic ROLE_LABEL names ("Line Manager",
 * "Incharge", "Operator") don't read as fabrication-specific anywhere the
 * role is displayed — most visibly in Users & Roles, where an admin picking
 * the Fabrication department couldn't find "Fabrication Manager" /
 * "Fabrication Supervisor" / "Fabrication Machine Operator" by name. This
 * gives the SAME underlying roles department-appropriate display names
 * without introducing a second role system or touching the Role enum/DB. */
export const FAB_ROLE_LABEL: Record<string, string> = {
  LINE_MANAGER: "Fabrication Manager",
  INCHARGE: "Fabrication Supervisor",
  OPERATOR: "Fabrication Machine Operator",
};
/** Role label, department-aware: Fabrication uses FAB_ROLE_LABEL for the
 * roles it shares with Shop Floor; every other branch (and any role with no
 * fabrication-specific name) falls back to the generic ROLE_LABEL. */
export function roleLabelFor(role?: string | null, branch?: string | null): string {
  const r = String(role ?? "");
  if (branch === "FABRICATION" && FAB_ROLE_LABEL[r]) return FAB_ROLE_LABEL[r];
  return ROLE_LABEL[r] ?? r;
}

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
  if (branch === "OFFICE") return r >= ROLE_RANK.ADMIN ? (["FINANCE", "ACCOUNTS", "SALES", "COMMERCIAL"] as RoleName[]) : [];
  if (branch === "FABRICATION") return (["LINE_MANAGER", "INCHARGE", "OPERATOR"] as RoleName[]).filter((x) => ROLE_RANK[x] < r);
  return (["LINE_MANAGER", "INCHARGE", "OPERATOR", "STORE", "MAINTENANCE", "ROBO"] as RoleName[]).filter((x) => ROLE_RANK[x] < r);
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
/**
 * Who may RAISE a maintenance request.
 *
 * Its own helper rather than borrowing canRectify(), which means "may fix batch
 * errors" — an unrelated permission that happened to admit the right people and
 * would have stopped doing so the moment either rule moved. A gate should say
 * what it gates.
 *
 * Incharge and above on the shop floor, because a maintenance queue is only
 * worth a fitter's walk if the entries are, and the incharge already owns that
 * judgement. FINANCE and ACCOUNTS share rank 2 and are therefore included —
 * deliberately, not incidentally: the log covers "machinery or whatever is
 * relevant", and an office lamp or a jammed printer is a real request. So is
 * MAINTENANCE itself, who could not previously log their own work because the
 * capped role sits at rank 1, below INCHARGE.
 */
export async function canRaiseMaintenance(): Promise<boolean> {
  const role = await currentRole();
  return role === "MAINTENANCE" || rankOf(role) >= ROLE_RANK.INCHARGE;
}

/**
 * Who may PERMANENTLY delete a robo production record (the slab and every
 * delay logged against it).
 *
 * ADMIN only — deliberately NOT the ROBO role, even though ROBO owns every
 * other action in the module.
 *
 * ROBO sits at rank 1 alongside OPERATOR: a shop-floor tablet user on a
 * shared, often unattended 10-inch device. The delete is irreversible in the
 * module's own terms — there is no soft-delete column on RoboProductionRecord,
 * the record's RoboDelayLog rows go with it, and the numbers feed the shift
 * reports, the Excel exports and MIS. A mis-tap would leave a shift silently
 * short a slab with nothing on screen to say so. Correcting a mistyped slab is
 * what EDIT is for, and edit stays open to ROBO on every slab in every shift
 * (including closed ones) precisely so the operator never needs delete to fix
 * their own mistake: correction stays on the tablet, destruction moves up.
 *
 * ADMIN rather than INCHARGE because middleware already admits only ADMIN and
 * ROBO to /robo and /api/robo — an INCHARGE gate would name a rank that cannot
 * reach the route at all, which reads like a permission but is really a
 * no-one. This says what it means: everyone who can reach the endpoint except
 * the tablet.
 *
 * This must be enforced INSIDE the route handler. Middleware matches on path
 * prefix only and cannot tell DELETE from GET, and hiding the button is a
 * courtesy to the operator, not a control — the endpoint is reachable with a
 * fetch from the same signed-in session.
 */
export async function canDeleteRoboSlab(): Promise<boolean> {
  return rankOf(await currentRole()) >= ROLE_RANK.ADMIN;
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
