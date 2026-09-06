// Commercial module access — the server half. The rule itself lives in
// ./access-rules (pure, edge-safe, node --test importable) and is imported
// here rather than restated, so the tests exercise the rule the routes run.
//
// Put `const g = await commercialGate("write"); if (!g.ok) return deny(g)` at
// the top of every /api/office/commercial route, and the layout gate on every
// /office/commercial page. Middleware stops the request at the path prefix;
// this stops a direct render and a revoked session (middleware runs without
// the database, so a deactivated login keeps a valid JWT for up to 8 hours —
// only currentUser() catches it).
import { currentUser } from "@/lib/rbac";
import {
  commercialActorOf, commercialCan, commercialActionsFor, maySeeCommercialModule,
  isDispatchCheckPath, COMMERCIAL_ACTORS, COMMERCIAL_ACTIONS, COMMERCIAL_HOME,
  type CommercialActor, type CommercialAction,
} from "./access-rules";

export {
  commercialActorOf, commercialCan, commercialActionsFor, maySeeCommercialModule,
  isDispatchCheckPath, COMMERCIAL_ACTORS, COMMERCIAL_ACTIONS, COMMERCIAL_HOME,
};
export type { CommercialActor, CommercialAction };

export interface CommercialUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  branch: string;
}

export interface CommercialGate {
  ok: boolean;
  status: number;                       // 401 no session · 403 not allowed · 200 ok
  user: CommercialUser | null;
  actor: CommercialActor | null;
  actions: CommercialAction[];
}

function shape(u: unknown): CommercialUser {
  const x = (u ?? {}) as Record<string, unknown>;
  return {
    id: String(x.id ?? ""),
    name: (x.name as string | null | undefined) ?? null,
    email: (x.email as string | null | undefined) ?? null,
    role: String(x.role ?? ""),
    branch: String(x.branch ?? ""),
  };
}

/** Server gate. Revalidates the session (active + sessionVersion via
 *  currentUser) and confirms the user may perform this action. Default "view",
 *  the narrowest useful thing: a route that forgets to name its action gets
 *  the read gate, which refuses the dispatch checker rather than handing him
 *  the order book. */
export async function commercialGate(action: CommercialAction = "view"): Promise<CommercialGate> {
  const raw = await currentUser();
  if (!raw) return { ok: false, status: 401, user: null, actor: null, actions: [] };
  const user = shape(raw);
  const actor = commercialActorOf(user);
  const actions = commercialActionsFor(user);
  if (!commercialCan(user, action)) return { ok: false, status: 403, user, actor, actions };
  return { ok: true, status: 200, user, actor, actions };
}

/** "Who did this" for the *_by_id / *_by_name column pairs. */
export function actorStamp(u: CommercialUser | null): { id: string | null; name: string | null } {
  if (!u) return { id: null, name: null };
  return { id: u.id || null, name: u.name || u.email || null };
}
