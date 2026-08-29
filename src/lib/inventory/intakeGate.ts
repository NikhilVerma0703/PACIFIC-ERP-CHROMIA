// The async session variant of the slab-intake rule — the shape the sampling
// module set (pure rule in one file, server gate beside it): intakeAccess.ts
// must stay import-free so middleware and node --test can both load it, and a
// gate that calls currentUser() cannot.
import { currentUser } from "@/lib/rbac";
import { canUseSlabIntake } from "./intakeAccess";

export { canUseSlabIntake, slabIntakeEmails } from "./intakeAccess";

export interface SlabIntakeGate {
  ok: boolean;
  status: number; // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
}

/** Server gate for the /slab-intake page and each of its actions. Revalidates
 *  the session (active + sessionVersion via currentUser) and runs the SAME
 *  pure rule the middleware carve-out runs, on the same env var — the door and
 *  the room cannot drift apart. Every action re-checks it: a UI condition is
 *  not an authorisation. */
export async function slabIntakeGate(): Promise<SlabIntakeGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  if (!canUseSlabIntake(String(u.role ?? ""), String(u.email ?? ""), process.env.SLAB_INTAKE_EMAILS))
    return { ok: false, status: 403, user };
  return { ok: true, status: 200, user };
}
