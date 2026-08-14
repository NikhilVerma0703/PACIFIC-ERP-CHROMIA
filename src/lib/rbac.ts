import { cache } from "react";
import { auth } from "@/auth";
import { sessionUserRow } from "@/lib/sessionRevalidation";

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

/** `auth()` once per request. Every `auth()` call runs the jwt callback, which
 * revalidates the User row — so Shell calling `auth()` AND `currentUser()` (which
 * called `auth()` again) paid the jwt-callback query twice per navigation
 * (measured 2026-08-14: 3 sequential User lookups before any page data).
 * Request-cached here so the whole render shares one decode + one validation. */
export const sessionOnce = cache(() => auth());

/** The session user, REVALIDATED against the database on every request:
 * a deactivated user or a bumped sessionVersion is treated as signed out
 * immediately, on every device. Request-cached so gates share one query —
 * and the row itself comes from sessionUserRow, the same request-scoped
 * lookup the jwt callback uses, so the check runs on every request but the
 * query runs once per request. */
export const currentUser = cache(async () => {
  const session = await sessionOnce();
  const u = session?.user;
  if (!u?.id) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = await sessionUserRow(u.id);
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
 * LINE MANAGER and above, plus MAINTENANCE itself.
 *
 * It was INCHARGE and above, which also swept in FINANCE and ACCOUNTS on rank 2.
 * Narrowed on the owner's instruction to "manager and above, not incharge": the
 * queue is a fitter's work list, and the wider it is raised the less each entry
 * means. An incharge who finds a fault still has the route that matters — log
 * the stoppage in MIS, and the hour appears in this same queue as an incident.
 *
 * MAINTENANCE is named explicitly because the capped role sits at rank 1, below
 * every rank test, and would otherwise be the one role unable to log its own
 * work on its own page.
 */
export async function canRaiseMaintenance(): Promise<boolean> {
  const role = await currentRole();
  return role === "MAINTENANCE" || rankOf(role) >= ROLE_RANK.LINE_MANAGER;
}

/** Who may OPEN the maintenance log at all.
 *
 *  Deliberately the same set as canRaiseMaintenance: on this page reading and
 *  raising are the same act — you open it to see what is outstanding and to add
 *  to it — so two different answers would only produce a screen with its own
 *  form greyed out. Answering is narrower still (canRespondDowntime: the
 *  Maintenance Manager and admins).
 *
 *  Kept beside the middleware rule for /maintenance, not instead of it: the
 *  middleware stops the request, this stops a direct render, and each is
 *  useless on its own the day the other is edited. */
export async function canSeeMaintenanceLog(): Promise<boolean> {
  return canRaiseMaintenance();
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
 * THE ROBO TABLET AND ADMIN. It was admin-only when this landed, and the owner
 * has since opened it to the operator deliberately, knowing what it costs.
 *
 * The argument for giving it to the tablet is that the mistake it undoes is the
 * operator's own and is made seconds earlier: a slab keyed against the wrong
 * number, noticed while he is still standing at the machine. Sending that to an
 * admin means the wrong row sits in the shift until someone else is free, and
 * the count is wrong for as long as it does.
 *
 * The argument against is that it cascades — the slab's delay logs go with it —
 * and a tablet is a device people mis-tap. What makes it survivable is that the
 * delete is NOT actually irreversible: the handler writes its reversal payload
 * into action_log inside the same transaction, so an admin can restore a row
 * that should not have gone. That is the whole reason this can be widened at
 * all, and it is why the audit write must never be moved out of the
 * transaction or made best-effort.
 *
 * ROBO is named rather than tested by rank: the capped role sits at rank 1,
 * below every rank comparison, so a rank test cannot express "the tablet".
 * INCHARGE is deliberately still absent — middleware admits only ADMIN and ROBO
 * to /robo and /api/robo, so naming it would read like a permission and be a
 * no-one.
 *
 * This must be enforced INSIDE the route handler. Middleware matches on path
 * prefix only and cannot tell DELETE from GET, and hiding the button is a
 * courtesy to the operator, not a control — the endpoint is reachable with a
 * fetch from the same signed-in session.
 */
export async function canDeleteRoboSlab(): Promise<boolean> {
  const role = await currentRole();
  return role === "ROBO" || rankOf(role) >= ROLE_RANK.ADMIN;
}

/**
 * Who may EDIT a saved robo production setup in place — PATCH
 * /api/robo/batch-recipes/[id] with an `entries` array, which deletes and
 * recreates every RoboBatchRecipeEntry on that setup.
 *
 * ADMIN **and** the ROBO tablet — deliberately WIDER than canDeleteRoboSlab()
 * above, and the difference between the two is the whole argument.
 *
 * Slab delete could move up a rank without taking any workflow with it,
 * because the operator had a clean alternative: edit the slab. Setup edit has
 * no clean alternative. An operator who mistyped the design, a program or a
 * cycle time at the top of the shift can already press "New batch" — that
 * button is open to ROBO and always has been — and doing so is the WORSE
 * outcome, not a safe fallback: the shift ends up carrying two setups, every
 * slab already logged stays attached to the first, and the design is left
 * linked to a spare setup that then blocks the design from ever being deleted.
 * Withholding the edit does not prevent that mess, it is what produces it. The
 * upstream change exists precisely to give the operator the correcting action
 * instead of the duplicating one.
 *
 * The edit is also not destructive in the way the delete is. No slab row is
 * touched: RoboProductionRecord.batchRecipeId keeps pointing at the same
 * setup, which is exactly why the update is in place. What is lost is the
 * previous per-machine settings, which are configuration the operator typed
 * minutes earlier — not production data anyone reconciles against paper.
 *
 * Today this set matches what middleware already allows through to /api/robo,
 * so the check adds no one and turns no one away. It still earns its place
 * twice over. Middleware matches on path prefix and cannot tell this PATCH
 * from the GET the reports page makes against the same URL, and the delete
 * port established that the handler is where a destructive verb is gated. And
 * it is an allowlist rather than an inheritance: if /api/robo is ever opened
 * to INCHARGE or LINE_MANAGER for reporting, the rebuild does not quietly go
 * with it.
 */
export async function canEditRoboSetup(): Promise<boolean> {
  const role = await currentRole();
  return role === "ROBO" || rankOf(role) >= ROLE_RANK.ADMIN;
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
