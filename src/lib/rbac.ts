import { cache } from "react";
import { auth } from "@/auth";
import { sessionUserRow } from "@/lib/sessionRevalidation";
// The active role context. THE ONE PLACE the two granted pairs are collapsed
// into the one this request runs as — see currentUser() below.
import { applyRoleContext, resolveRoleContext } from "@/lib/roleContext";
import { readRoleContextCookie } from "@/lib/roleContextServer";

// Role hierarchy: ROLE_RANK/rankOf moved to lib/roles.ts (a pure, import-free
// module) so node --test can reach them — imported AND re-exported here so
// every existing `from "@/lib/rbac"` import keeps working unchanged.
import { ROLE_RANK, rankOf, STATIONS, STATION_LABEL, ROLE_LABEL, FAB_ROLE_LABEL, roleLabelFor, COMMERCIAL_ROLES, isCommercialRole } from "@/lib/roles";
import type { RoleName, StationName } from "@/lib/roles";
export { ROLE_RANK, rankOf, STATIONS, STATION_LABEL, ROLE_LABEL, FAB_ROLE_LABEL, roleLabelFor, COMMERCIAL_ROLES, isCommercialRole };
// Imported as well as re-exported: `export type { RoleName } from ...` alone
// forwards the name to importers without binding it locally, so creatableRoles
// below could not see it and the whole app failed to typecheck.
export type { RoleName, StationName };
// The station and role LABEL tables moved to lib/roles.ts with the rank table,
// for a second reason beyond testability: the one client component that needs
// them (Users & Roles) imported them from here, and this module imports
// @/auth — so next-auth, jose, bcryptjs, zod, a crypto polyfill and the Prisma
// browser stub (≈240 kB gzipped) shipped to that page for four string tables.
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
 * query runs once per request.
 *
 * AS THE ADMIN GRANTED IT: role/branch are the login's own primary pair, and
 * altRole/altBranch (the second job, NULL for almost everybody) are alongside
 * them. NO active-context overlay — this is the "what were you given" question,
 * and only the switcher asks it. Every gate wants currentUser() below.
 *
 * This is verbatim what currentUser() was before the role switcher landed; the
 * switcher needs an un-overlaid user to list the pairs it may offer, because an
 * overlaid one describes the job you are standing in as your primary. */
export const grantedUser = cache(async () => {
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

/**
 * The session user AS THE ACTIVE ROLE CONTEXT — the same revalidated login,
 * with role/branch set to whichever of the granted pairs the request is running
 * as.
 *
 * THIS IS THE ONLY PLACE THE OVERLAY HAPPENS. Every gate downstream —
 * canRectify, canManageUsers, fabTierOf, chromiaGate, samplingGate,
 * canSeeModel, the whole of lib/branch.ts — keeps working untouched, because
 * each still does nothing but read `.role` and `.branch`. Teaching individual
 * gates about contexts is exactly the drift lib/routeCaps.ts exists to end, one
 * layer up: two gates disagreeing about who somebody is.
 *
 * A login with no alternate is not merely treated the same, it is UNTOUCHED:
 * applyRoleContext returns the identical object when the primary is active, so
 * this adds a cookie read and nothing else for everybody but the handful of
 * people who hold two jobs.
 *
 * The cookie cannot widen anything. It names a pair; resolveRoleContext
 * compares that name against the pairs THIS user was granted and falls back to
 * the primary when it matches neither. See lib/roleContext.ts.
 */
export const currentUser = cache(async () => {
  const u = await grantedUser();
  if (!u) return null;
  return applyRoleContext(u, resolveRoleContext(u, await readRoleContextCookie()));
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
  // COMMERCIAL_MANAGER sits BEFORE COMMERCIAL, not after it: UserAdmin defaults
  // the Role dropdown to the LAST creatable role (see the Shop Floor note
  // below), and the default for a new office login must stay Commercial.
  if (branch === "OFFICE") return r >= ROLE_RANK.ADMIN ? (["FINANCE", "ACCOUNTS", "SALES", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS", "COMMERCIAL"] as RoleName[]) : [];
  if (branch === "FABRICATION") return (["LINE_MANAGER", "INCHARGE", "OPERATOR"] as RoleName[]).filter((x) => ROLE_RANK[x] < r);
  // CHROMIA is a retired department (the module is a role now). Existing logins
  // there stay visible and usable; nothing new may be created on it, and it
  // must not fall through to the Shop Floor superset below.
  if (branch === "CHROMIA") return [];
  // CHROMIA sits before ROBO deliberately: UserAdmin defaults the Role dropdown
  // to the LAST creatable role, so appending would silently change what an
  // admin creates when they don't touch the dropdown. SAMPLING is inserted
  // before ROBO for exactly that reason and NOT appended — the default must
  // stay what it was.
  return (["LINE_MANAGER", "INCHARGE", "OPERATOR", "STORE", "MAINTENANCE", "CHROMIA", "SAMPLING", "ROBO"] as RoleName[]).filter((x) => ROLE_RANK[x] < r);
}

/**
 * The departments a given login may put a user in — and, since the role
 * switcher, the departments a SECOND role may be granted in.
 *
 * ONE COPY. This expression was written out twice, in admin/users/page.tsx (to
 * build the Department dropdown and the visible list) and in
 * admin/users/actions.ts (to check what createUser was sent); the alternate-role
 * grant needed the same answer a third time, which is the point at which a
 * duplicated rule stops being a duplicate and starts being a drift. Same reason
 * lib/routeCaps.ts exists.
 *
 * INTERNATIONAL_SALES IS ABSENT AND MUST STAY ABSENT. That department has its
 * own screen (the `sales` mode of UserAdmin, keyed on duties rather than
 * roles), and — the reason that matters here — seven of its route handlers read
 * the role straight off the raw session instead of currentUser(), so they would
 * answer from the login's PRIMARY pair no matter which job it had switched
 * into. A second role that touched that branch would leave both sets of
 * permissions live at once. Nothing to add here; just do not add it.
 */
export function assignableBranches(role?: string | null, branch?: string | null): string[] {
  if (rankOf(role) < ROLE_RANK.ADMIN) return [String(branch ?? "SHOP_FLOOR")];
  return branch === "OFFICE" ? ["OFFICE"] : ["SHOP_FLOOR", "FABRICATION"];
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

/**
 * The in-route gate for EVERY /api/robo handler — the same shape as fabGate
 * (lib/fab/access.ts) and chromiaGate (lib/chromia/access.ts), and admitting
 * exactly the set middleware already admits to /robo and /api/robo: the ROBO
 * tablet and admins. It turns no valid session away that reaches the route
 * today, so every robo screen keeps working unchanged.
 *
 * It exists because middleware was the ONLY lock on 33 of these routes, and
 * middleware runs the edge auth config WITHOUT the database: a login that has
 * been deactivated, or whose sessionVersion was bumped to sign it out
 * everywhere, kept a valid JWT working against /api/robo for the rest of the
 * 8-hour token life, while every other module refused it at once through
 * currentUser(). The revocation is the documented point of sessionVersion; a
 * module it does not reach is a module it does not protect. The gate also
 * makes the route its own boundary for the day the matcher or a branch block
 * is edited — the three-layer rule every other module follows.
 *
 * Returns a ready refusal (401 no session · 403 not the robo audience) or
 * null, so a handler adds two lines and nothing else. ROBO is named rather
 * than ranked for the reason canDeleteRoboSlab gives: the capped role sits at
 * rank 1, below every rank test.
 */
export async function roboGate(): Promise<Response | null> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const role = String((user as { role?: string | null }).role ?? "");
  if (role === "ROBO" || rankOf(role) >= ROLE_RANK.ADMIN) return null;
  return Response.json({ error: "Not authorized" }, { status: 403 });
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
