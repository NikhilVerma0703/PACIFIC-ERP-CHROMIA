/**
 * Acting user resolution.
 *
 * The standalone module had no sign-in: every action was attributed to whoever
 * `CHROMIA_ACTING_USER` named in the environment, with a TODO saying this is the
 * one file that changes when authentication arrives. This is that change.
 *
 * The acting user is now the signed-in ERP user (next-auth session, revalidated
 * by `currentUser()` so a deactivated or revoked login stops writing rows). The
 * shape is unchanged, so the ten server actions that call `requireActingUser()`
 * did not have to be touched.
 *
 * `employeeCode` carries the user's email: the Chromia tables record it for
 * human-readable audit trails, and email is the ERP's stable identifier for a
 * person. `id` is the ERP `users.id` — the same value every `*ById` column in
 * the chromia_* tables stores (deliberately without a foreign key, so the
 * module's history survives a user row being archived).
 */
import { currentUser } from "@/lib/rbac";

export interface ActingUser {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
}

export async function getActingUser(): Promise<ActingUser | null> {
  const user = await currentUser();
  const id = (user as { id?: string } | null)?.id;
  if (!user || !id) return null;

  const u = user as { name?: string | null; email?: string | null; role?: string | null };
  return {
    id: String(id),
    name: String(u.name || u.email || "Unknown"),
    employeeCode: String(u.email ?? id),
    role: String(u.role ?? ""),
  };
}

/**
 * Same as `getActingUser`, but throws when there is no session at all. Every
 * Chromia write goes through this, so an expired cookie fails loudly at the
 * action boundary instead of silently writing rows attributed to nobody.
 */
export async function requireActingUser(): Promise<ActingUser> {
  const user = await getActingUser();
  if (!user) throw new Error("Not signed in — the Chromia module needs an ERP session to record who did this.");
  return user;
}
