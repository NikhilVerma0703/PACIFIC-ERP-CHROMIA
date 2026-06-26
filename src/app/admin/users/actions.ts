"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { currentUser, currentRole, canManageUsers, creatableRoles, rankOf, ROLE_RANK, STATIONS } from "@/lib/rbac";
import { createUserRecord, setActiveRecord, resetPasswordRecord, setStationRecord, getUserRole, bumpSessionVersion, bumpAllSessionVersions } from "@/lib/users";
import { isAdmin } from "@/lib/rbac";

export interface Res { ok: boolean; message: string }

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
