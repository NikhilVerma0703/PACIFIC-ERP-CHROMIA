"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { currentUser, currentRole, canManageUsers, creatableRoles, rankOf, ROLE_RANK, STATIONS } from "@/lib/rbac";
import { createUserRecord, setActiveRecord, resetPasswordRecord, setStationRecord, getUserRole, bumpSessionVersion, bumpAllSessionVersions } from "@/lib/users";
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

async function canManageTarget(id: string): Promise<{ ok: boolean; message: string }> {
  if (!(await canManageUsers())) return { ok: false, message: "You don't have permission to manage users." };
  const me = await currentUser();
  if (me?.id === id) return { ok: false, message: "You cannot manage your own account here." };
  const myRank = rankOf(await currentRole());
  const targetRank = rankOf(await getUserRole(id));
  if (targetRank >= myRank) return { ok: false, message: "You can only manage users below your own role." };
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
    if (!(tier === "ADMIN" || callerDuty === "SALES_ADMIN" || callerDuty === "REPORTING_MANAGER"))
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
  const assignable = rankOf(myRole) >= ROLE_RANK.ADMIN
    ? (myBranch === "OFFICE" ? ["OFFICE"] : ["SHOP_FLOOR", "FABRICATION"])
    : [myBranch];
  const branch = assignable.includes(branchRaw) ? branchRaw : myBranch;
  const allowed = creatableRoles(myRole, branch);
  if (!allowed.includes(role as any)) return `You can only create: ${allowed.join(", ") || "(no roles)"}.`;

  let station: string | null = null;
  if (role === "OPERATOR") {
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
