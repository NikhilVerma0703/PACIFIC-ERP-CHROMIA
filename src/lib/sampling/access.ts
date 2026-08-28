// Sampling access model. Sampling is a capped ROLE (Role.SAMPLING), gated
// exactly like Robo and Chromia: ONE dedicated login owns the module, admins
// span every department, and middleware caps that login to /sampling +
// /api/sampling. There is NO Branch.SAMPLING and none should be added — see the
// note at the head of ./actions for why the department shape was abandoned
// after Chromia was retired as one.
//
// The rule itself lives in ./actions — a pure, alias-free module that node
// --test AND the edge middleware can both import — and is imported here rather
// than restated, so the tests exercise the rule the routes run. See that file
// for who may do what, and for why the Fabrication Supervisor appears in a
// sampling gate at all.
//
// GATE ON THE ACTION, NOT ON A MINIMUM TIER, which is where this deviates from
// fabGate(min) / chromiaGate(min). The rules here are not a ladder: the
// Fabrication Supervisor may add stock and may NOT see the inventory or touch a
// dispatch, so "tier >= X" cannot express them. Asking for the action also
// keeps the call site honest — samplingGate("dispatch") says what it is about
// to do.
import { currentUser } from "@/lib/rbac";
import {
  samplingActorOf, samplingCan, samplingActionsFor, maySeeSamplingModule,
  isFabStockContributor, SAMPLING_ACTORS, SAMPLING_ACTIONS,
  type SamplingActor, type SamplingAction,
} from "./actions";

export {
  samplingActorOf, samplingCan, samplingActionsFor, maySeeSamplingModule,
  isFabStockContributor, SAMPLING_ACTORS, SAMPLING_ACTIONS,
};
export type { SamplingActor, SamplingAction };

export interface SamplingGate {
  ok: boolean;
  status: number;                                  // 401 no session · 403 not allowed · 200 ok
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null;
  /** Which kind of login this is — SAMPLING, FAB_SUPERVISOR, ADMIN, or null for
   *  a signed-in user with no business here at all. */
  actor: SamplingActor | null;
  /** Everything this user may do, so a page can render without a second pass. */
  actions: SamplingAction[];
}

/** Server gate for sampling endpoints/pages. Revalidates the session (active +
 *  sessionVersion via currentUser) and confirms the user may perform this
 *  action. Put at the top of every /api/sampling route and every /sampling
 *  page — middleware stops the request at the path prefix, this stops a direct
 *  render, and each is useless on its own the day the other is edited.
 *
 *  The default is "view", the narrowest useful thing: a route that forgets to
 *  name its action gets the read gate, which refuses the Fabrication Supervisor
 *  rather than handing him the inventory. */
export async function samplingGate(action: SamplingAction = "view"): Promise<SamplingGate> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, user: null, actor: null, actions: [] };
  const actor = samplingActorOf(user);
  const actions = samplingActionsFor(user);
  if (!samplingCan(user, action)) return { ok: false, status: 403, user, actor, actions };
  return { ok: true, status: 200, user, actor, actions };
}
