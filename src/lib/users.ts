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
}

export async function listUsersRows(branch?: string | null): Promise<UserRow[]> {
  let rows: any[];
  try {
    rows = await db.user.findMany({ where: branch ? { branch } : undefined, orderBy: [{ active: "desc" }, { email: "asc" }] });
  } catch {
    // branch column not migrated yet — fall back to unfiltered
    rows = await db.user.findMany({ orderBy: [{ active: "desc" }, { email: "asc" }] });
  }
  const nameById = new Map<string, string>(rows.map((u) => [u.id, u.name ?? u.email]));
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
  }));
}

export async function getUserRole(id: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id }, select: { role: true } });
  return u?.role ? String(u.role) : null;
}

export async function createUserRecord(input: {
  email: string; name: string | null; password: string; role: string; station: string | null; createdById: string | null; branch?: string | null;
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
  try {
    return await db.user.create({ data: { ...base, branch: input.branch ?? "SHOP_FLOOR" } });
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
