"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { currentUser, currentRole, canManageUsers, creatableRoles, assignableBranches, rankOf, ROLE_RANK, STATIONS, roleLabelFor } from "@/lib/rbac";
import { createUserRecord, setActiveRecord, resetPasswordRecord, setStationRecord, getUserRoles, getUserPrimary, setAltContextRecord, bumpSessionVersion, bumpAllSessionVersions } from "@/lib/users";
import { contextKey } from "@/lib/roleContext";
import { isAdmin } from "@/lib/rbac";
import { salesTierOf } from "@/lib/sales/access";
import { salesDutyFor } from "@/lib/sales/session";

export interface Res { ok: boolean; message: string }

// International Sales duties (users.sales_role) -> modest platform role.
// Derived from lib/sales/access.ts + session.ts: the platform role only sets
// the module TIER (LINE_MANAGER+ rank = MANAGER, below = MEMBER) and the duty
// string refines it. Member duties ride on SALES (rank 1) — NOT platform
// ACCOUNTS/COMMERCIAL: ACCOUNTS is rank 2 and would grant canManageUsers.
// SALES_ADMIN deliberately does NOT get platform ADMIN: no sales route calls
// salesGate above MEMBER — every admin check is `salesRole === "SALES_ADMIN"`,
// so MANAGER tier + the duty is enough, and middleware keeps the account
// confined to /sales (+ /admin/users).
const SALES_DUTY_TO_ROLE: Record<string, string> = {
  SALESPERSON: "SALES", COMMERCIAL: "SALES", ACCOUNTS: "SALES",
  REPORTING_MANAGER: "LINE_MANAGER", SALES_ADMIN: "LINE_MANAGER",
};
const SALES_DUTIES = Object.keys(SALES_DUTY_TO_ROLE);

/**
 * THE TARGET IS RANKED BY THE HIGHEST ROLE IT CAN WEAR, NOT ITS PRIMARY.
 *
 * This used to read the primary role alone (getUserRole selects `{ role }` and
 * nothing else), so an account's second job was invisible to the check that
 * guards password resets, disabling, station changes and alternate grants. A
 * rank-2 INCHARGE could reset the password of a rank-1 OPERATOR who also held a
 * rank-3 LINE_MANAGER alternate, sign in as them, switch context, and gain
 * /maintenance, /office/batch-verify and canRaiseMaintenance — an escalation
 * that needed no bug beyond this one comparison.
 *
 * The CALLER is still ranked by their ACTIVE context, which is what
 * currentRole() resolves through the role-context overlay. That is deliberate
 * and the conservative half of the pair: you wield the authority of the hat you
 * are wearing, not the best hat you own, so a manager working a shop-floor
 * shift does not carry manager powers into it.
 */
async function canManageTarget(id: string): Promise<{ ok: boolean; message: string }> {
  if (!(await canManageUsers())) return { ok: false, message: "You don't have permission to manage users." };
  const me = await currentUser();
  if (me?.id === id) return { ok: false, message: "You cannot manage your own account here." };
  const myRole = await currentRole();
  const myRank = rankOf(myRole);
  const targetRank = Math.max(0, ...(await getUserRoles(id)).map(rankOf));
  if (targetRank >= myRank) return { ok: false, message: "You can only manage users below your own role." };

  // AND RANK ALONE IS NOT AUTHORITY — THE DEPARTMENT HAS TO MATCH TOO.
  //
  // This compared ranks and nothing else, and never loaded the target's branch.
  // Every id is a cuid posted to a server action, so the only thing keeping a
  // Shop Floor INCHARGE (rank 2) away from an International Sales salesperson
  // or an Office Commercial login (both rank 1) was that no page hands out
  // those ids — an IDOR behind id secrecy, and one password reset away from
  // signing in as them. It ran the other way too: a sales REPORTING_MANAGER /
  // SALES_ADMIN carries LINE_MANAGER rank 3, passes canManageUsers, and so
  // outranked every Office FINANCE/ACCOUNTS login and every shop-floor incharge
  // in the plant.
  //
  // So the department rule createUser applies a few lines down is applied here
  // too, on the ONE gate every mutating path already goes through (reset
  // password, deactivate, station, second role). The allowed set is exactly
  // what Users & Roles LISTS — assignableBranches, plus the caller's own
  // branch, plus retired CHROMIA for a non-office admin (the `visible` list in
  // admin/users/page.tsx) — because a row you can see and cannot act on is a
  // support call, and a row you cannot see and CAN act on is this defect.
  //
  // The caller's own branch is in the set for a reason worth keeping: below
  // ADMIN, assignableBranches already returns exactly [their branch], so it
  // changes nothing for them — but it answers an ADMIN signed in on the sales
  // card with ["SHOP_FLOOR","FABRICATION"], and without this a platform admin
  // doing Sales Admin work would be locked out of the International Sales
  // logins that are the only rows their own page shows them.
  const myBranch = (((me as any)?.branch as string | undefined) ?? "SHOP_FLOOR");
  const target = await getUserPrimary(id);
  if (!target) return { ok: false, message: "That login no longer exists." };
  const manageable = new Set([...assignableBranches(myRole, myBranch), myBranch]);
  // Retired department: nothing new may be created on CHROMIA, but the logins
  // the old integration left there are listed for an admin precisely so they
  // can still be deactivated or reset. Goes when scripts/0046 has emptied it.
  if (myRank >= ROLE_RANK.ADMIN && myBranch !== "OFFICE") manageable.add("CHROMIA");
  if (!manageable.has(target.branch)) return { ok: false, message: "You can only manage users in your own department." };

  return { ok: true, message: "" };
}

export async function createUser(_prev: string | undefined, fd: FormData): Promise<string | undefined> {
  if (!(await canManageUsers())) return "You don't have permission to create users.";
  const me = await currentUser();
  const myRole = String(me?.role ?? "");

  const email = String(fd.get("email") || "").trim().toLowerCase();
  const name = String(fd.get("name") || "").trim() || null;
  const password = String(fd.get("password") || "");
  const role = String(fd.get("role") || "");
  const stationRaw = String(fd.get("station") || "").trim();

  if (!email || !password) return "Email and password are required.";
  if (password.length < 8) return "Password must be at least 8 characters.";

  const myBranch = (((me as any)?.branch as string | undefined) ?? "SHOP_FLOOR");

  // ── International Sales context: duty roles, not factory roles ──────────
  if (myBranch === "INTERNATIONAL_SALES") {
    const tier = salesTierOf(me);
    const callerDuty = tier ? await salesDutyFor(String(me?.id ?? ""), tier) : "";
    if (!(tier === "ADMIN" || callerDuty === "SALES_ADMIN")) // Sales Admin only (user directive)
      return "You don't have permission to create users.";
    // Platform admins hand out every duty; sales managers only the member duties.
    const allowedDuties = tier === "ADMIN" ? SALES_DUTIES : SALES_DUTIES.filter((d) => SALES_DUTY_TO_ROLE[d] === "SALES");
    if (!allowedDuties.includes(role)) return `You can only create: ${allowedDuties.join(", ")}.`;
    const salesFactoryRaw = String(fd.get("salesFactory") || "").trim();
    const salesFactory = salesFactoryRaw === "QUARTZ" || salesFactoryRaw === "GRANITE" ? salesFactoryRaw : null;
    try {
      await createUserRecord({
        email, name, password,
        role: SALES_DUTY_TO_ROLE[role], // tier via rank; the duty lives in users.sales_role
        station: null, createdById: me?.id ?? null, branch: "INTERNATIONAL_SALES",
        salesRole: role, salesFactory,
      });
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("Unique") || msg.includes("unique")) return "A user with that email already exists.";
      return `Create failed: ${msg}`;
    }
    revalidatePath("/admin/users");
    return "ok";
  }

  const branchRaw = String(fd.get("branch") || "").trim();
  const assignable = assignableBranches(myRole, myBranch);
  const branch = assignable.includes(branchRaw) ? branchRaw : myBranch;
  const allowed = creatableRoles(myRole, branch);
  if (!allowed.includes(role as any)) return `You can only create: ${allowed.map((r) => roleLabelFor(r, branch)).join(", ") || "(no roles)"}.`;

  // Fabrication has no shop-floor machine/station of its own — a fab
  // employee picks their machine at /fab/session (a cookie), not via this
  // column — so don't require (or accept) a Press/Oven/… station for them.
  let station: string | null = null;
  if (role === "OPERATOR" && branch !== "FABRICATION") {
    if (!stationRaw || !STATIONS.includes(stationRaw as any)) return "Operators must be assigned a machine/station.";
    station = stationRaw;
  }

  try {
    await createUserRecord({ email, name, password, role, station, createdById: me?.id ?? null, branch });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("Unique") || msg.includes("unique")) return "A user with that email already exists.";
    return `Create failed: ${msg}`;
  }
  revalidatePath("/admin/users");
  return "ok";
}

export async function setActive(id: string, active: boolean): Promise<Res> {
  const guard = await canManageTarget(id);
  if (!guard.ok) return guard;
  await setActiveRecord(id, active);
  revalidatePath("/admin/users");
  return { ok: true, message: active ? "User reactivated." : "User deactivated." };
}

export async function resetPassword(id: string, password: string): Promise<Res> {
  const me = await currentUser();
  const self = me?.id === id;
  if (!self) {
    const guard = await canManageTarget(id);
    if (!guard.ok) return guard;
  } else if (!(await canManageUsers())) return { ok: false, message: "You don't have permission." };
  if (!password || password.length < 8) return { ok: false, message: "Password must be at least 8 characters." };
  await resetPasswordRecord(id, password); // also signs that user out everywhere
  revalidatePath("/admin/users");
  return { ok: true, message: self ? "Your password is changed — sign in again with the new one." : "Password reset." };
}

export async function setStation(id: string, station: string | null): Promise<Res> {
  const guard = await canManageTarget(id);
  if (!guard.ok) return guard;
  if (station && !STATIONS.includes(station as any)) return { ok: false, message: "Unknown station." };
  await setStationRecord(id, station);
  revalidatePath("/admin/users");
  return { ok: true, message: "Station updated." };
}

/**
 * Grant — or take away — a SECOND ROLE AND DEPARTMENT on one login.
 *
 * One person does two jobs (Line Manager on the line, Fabrication Supervisor
 * next door) and had two email accounts to do them. This is where the second
 * job is handed out: users.alt_role + users.alt_branch, NULL for everybody
 * else, and a login with either half NULL has no switcher and behaves exactly
 * as it always did.
 *
 * THE PAIR IS MATCHED, NEVER PARSED. `key` comes from a <select> and is
 * therefore untrusted, so it is not split into a role and a branch — every pair
 * this admin may actually grant is enumerated from creatableRoles() and
 * assignableBranches() (the SAME two functions the Create-a-login form is
 * filtered by, so a role nobody may create is not a role anybody may be handed
 * as a second job), and the request has to equal one of their keys. Anything
 * else is refused. That is the same shape lib/roleContext.ts's selectContext
 * uses, for the same reason: a value that is only ever compared cannot become a
 * permission.
 *
 * canManageTarget first, so the ordinary rules still hold: you cannot do this to
 * yourself, and you cannot do it to anybody at or above your own rank. Combined
 * with creatableRoles, that also means ADMIN can never be a second role —
 * creatableRoles only ever returns roles strictly below the caller's.
 *
 * IT SIGNS THE TARGET OUT OF EVERY DEVICE, and that is not politeness. Both
 * granted pairs travel in the JWT (there is nowhere else the two edge gates
 * could read them), and this app refreshes a JWT's role and branch only at
 * sign-in — so without the bump a revoked second job would keep working for the
 * rest of an 8-hour token. Bumping sessionVersion is how a grant, and more
 * importantly a REVOCATION, takes effect immediately on every device.
 */
export async function setAltContext(id: string, key: string): Promise<Res> {
  const guard = await canManageTarget(id);
  if (!guard.ok) return guard;

  const me = await currentUser();
  const myRole = String(me?.role ?? "");
  const myBranch = (((me as any)?.branch as string | undefined) ?? "SHOP_FLOOR");

  const target = await getUserPrimary(id);
  if (!target) return { ok: false, message: "That login no longer exists." };
  // Their own screen, their own duty model, and — the reason that matters —
  // seven of its route handlers judge a request by the RAW session rather than
  // currentUser(), so a sales login in a second job would keep its sales
  // permissions while wearing the other hat. See assignableBranches().
  if (target.branch === "INTERNATIONAL_SALES") {
    return { ok: false, message: "International Sales logins cannot hold a second role." };
  }

  const signedOut = " That login is signed out of every device and signs in again.";

  if (!key) {
    const cleared = await setAltContextRecord(id, null, null);
    if (!cleared.ok) return { ok: false, message: cleared.reason };
    await bumpSessionVersion(id).catch(() => { /* session_version not migrated */ });
    revalidatePath("/admin/users");
    return { ok: true, message: "Second role removed." + signedOut };
  }

  // INTERNATIONAL SALES IS REFUSED IN BOTH DIRECTIONS.
  //
  // The check above stops a sales login taking a second job elsewhere. This
  // stops the reverse — a shop-floor login being handed a second job INSIDE
  // sales — which is the same hole seen from the other side, and the more
  // reachable one: assignableBranches() hands INTERNATIONAL_SALES back to any
  // caller already on that branch (contradicting its own doc block), so a Sales
  // Admin's grantable set contains sales pairs. Filtered here rather than in
  // assignableBranches because that function also feeds createUser, where a
  // Sales Admin creating sales logins is exactly right.
  const grantable = assignableBranches(myRole, myBranch)
    .filter((b) => b !== "INTERNATIONAL_SALES")
    .flatMap((b) => creatableRoles(myRole, b).map((r) => ({ role: String(r), branch: b })));
  const pair = grantable.find((p) => contextKey(p.role, p.branch) === key);
  if (!pair) return { ok: false, message: "That is not a role and department you can grant." };
  if (pair.role === target.role && pair.branch === target.branch) {
    return { ok: false, message: "That is already their main role — a second role has to be a different job." };
  }

  // The reason comes from Postgres, not from a guess. The old single message
  // told an admin who HAD applied 0052 to apply it again.
  const written = await setAltContextRecord(id, pair.role, pair.branch);
  if (!written.ok) return { ok: false, message: written.reason };
  await bumpSessionVersion(id).catch(() => { /* session_version not migrated */ });
  revalidatePath("/admin/users");
  return { ok: true, message: `Second role: ${roleLabelFor(pair.role, pair.branch)}.` + signedOut };
}

/** Sign one user out of all their devices (phones, tablets, PCs). */
export async function signOutEverywhere(id: string): Promise<Res> {
  const me = await currentUser();
  if (me?.id !== id) {
    const guard = await canManageTarget(id);
    if (!guard.ok) return guard;
  } else if (!(await canManageUsers())) return { ok: false, message: "You don't have permission." };
  try { await bumpSessionVersion(id); }
  catch { return { ok: false, message: "Run prisma db push first (session_version column missing)." }; }
  revalidatePath("/admin/users");
  return { ok: true, message: "Signed out on every device." };
}

/** Nuclear option: sign EVERYONE out of every device (you included). */
export async function signOutEveryone(): Promise<Res> {
  if (!(await isAdmin())) return { ok: false, message: "Admin only." };
  try { await bumpAllSessionVersions(); }
  catch { return { ok: false, message: "Run prisma db push first (session_version column missing)." }; }
  return { ok: true, message: "All sessions on all devices are now invalid — everyone signs in again." };
}
