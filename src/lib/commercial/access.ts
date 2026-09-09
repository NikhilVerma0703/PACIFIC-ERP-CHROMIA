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
  areaAccessFor, commercialAreasFor, areaOfPath, commercialHomeFor,
  COMMERCIAL_AREAS, COMMERCIAL_AREA_ACCESS, AREA_LABEL,
  type CommercialActor, type CommercialAction, type CommercialArea, type AreaAccess,
} from "./access-rules";

export {
  commercialActorOf, commercialCan, commercialActionsFor, maySeeCommercialModule,
  isDispatchCheckPath, COMMERCIAL_ACTORS, COMMERCIAL_ACTIONS, COMMERCIAL_HOME,
  areaAccessFor, commercialAreasFor, areaOfPath, commercialHomeFor,
  COMMERCIAL_AREAS, COMMERCIAL_AREA_ACCESS, AREA_LABEL,
};
export type { CommercialActor, CommercialAction, CommercialArea, AreaAccess };

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
  /** Every screen this login reaches, with what it may do there. A route
   *  that hands its page a capability payload passes this on. */
  areas: Record<CommercialArea, AreaAccess>;
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

/**
 * Server gate. Revalidates the session (active + sessionVersion via
 * currentUser) and confirms the user may perform this action — and, when an
 * area is named, may perform it THERE.
 *
 * NAME THE AREA on every route where one login writes and another only reads,
 * which since the desk was split (DECISIONS-2.md 1 and 2) is most of them:
 * `commercialGate("write", "invoices")` refuses Murali, who holds the write
 * ACTION for his own screens and only reads invoices. Without an area this is
 * the action question alone; middleware still refuses the path, so an
 * unnamed route is covered but coarser than it should be.
 *
 * Default "view", the narrowest useful thing: a route that forgets to name its
 * action gets the read gate, which refuses the dispatch checker rather than
 * handing him the order book.
 */
export async function commercialGate(action: CommercialAction = "view", area?: CommercialArea): Promise<CommercialGate> {
  const raw = await currentUser();
  if (!raw) return { ok: false, status: 401, user: null, actor: null, actions: [], areas: commercialAreasFor(null) };
  const user = shape(raw);
  const actor = commercialActorOf(user);
  const actions = commercialActionsFor(user);
  const areas = commercialAreasFor(user);
  if (!commercialCan(user, action, area)) return { ok: false, status: 403, user, actor, actions, areas };
  return { ok: true, status: 200, user, actor, actions, areas };
}

/** "Who did this" for the *_by_id / *_by_name column pairs. */
export function actorStamp(u: CommercialUser | null): { id: string | null; name: string | null } {
  if (!u) return { id: null, name: null };
  return { id: u.id || null, name: u.name || u.email || null };
}
