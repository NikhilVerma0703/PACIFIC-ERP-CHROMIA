// Who may do what in the Sampling module — the PURE half of
// lib/sampling/access.ts, split out exactly as lib/chromia/tier.ts was so that
// `node --test` can import it: no auth, no aliases beyond lib/roles.ts, which is
// itself import-free. The server gate (samplingGate, currentUser) lives in
// access.ts and IMPORTS this module rather than restating it, so the tests
// exercise the rule the routes actually run.
//
// Explicit .ts extension on the import, as chromia/tier.ts does: node's strict
// ESM resolver does not add one.
//
// NOT CALLED tier.ts, unlike its chromia and fab counterparts, BECAUSE THERE IS
// NO TIER. An earlier draft of this module was written when Sampling was going
// to be a Branch with the shared OPERATOR / INCHARGE / LINE_MANAGER ranks under
// it, and it carried a SAMPLING_TIER_RANK ladder and a SAMPLING_MIN_TIER table
// to match. Both are gone (see below). A file called tier.ts that exports no
// tier is the kind of stale name this codebase pays for elsewhere, so the name
// went with the concept.
//
// MIDDLEWARE IMPORTS THIS FILE, which makes it EDGE CODE. Nothing here may
// import Prisma, `next/headers` or any server-only module — the same rule
// lib/routeCaps.ts states at its head, and for the same reason: the path gate
// and the route gate must ask ONE question about who the Fabrication Supervisor
// is, and the only way to guarantee that is for both to call the same function.
// ../roles.ts is safe: it is the one role-rank table and imports nothing at all.
//
// -------------------------------------------------------------- SAMPLING ---
// SAMPLING IS A ROLE, NOT A DEPARTMENT. This is the one thing that changed
// between the design and the build, and it changed underneath: Chromia was
// built as Branch.CHROMIA, has since been RETIRED as a department
// (lib/branchNames.ts keeps the value only so old rows decode;
// scripts/0046-migrate-chromia-branch-users.sql moves those logins to
// SHOP_FLOOR + Role.CHROMIA), and Role.CHROMIA is now a capped tablet role
// "exactly like ROBO". Sampling follows the departments' successor, not the
// departments: Role.SAMPLING, capped to /sampling + /api/sampling, NO Branch
// value added.
//
// The ranks do not survive that move, and nothing is lost with them — the same
// point scripts/0046 makes about Chromia. The owner gave every sampling action
// to one person, the Sampling Incharge; there is no sampling operator login and
// no sampling manager above him. A three-rank ladder for a one-person module
// was a ladder with one rung on it.
//
// ----------------------------------------------------------------- ACTORS ---
// THREE KINDS OF LOGIN REACH THIS MODULE, and only one of them is sampling:
//
//   SAMPLING       (Role.SAMPLING)      everything: see the inventory, add
//                                       stock, release, dispatch, deliver
//   FAB_SUPERVISOR (branch FABRICATION,
//                   rank >= INCHARGE)   ADD STOCK ONLY
//   ADMIN          (any branch)         everything
//
// The fabrication half is there because the offcuts are theirs: a usable piece
// left over from a cut-to-size job becomes sample stock at the moment it comes
// off the saw, and the man who knows it exists is the fab supervisor. He gets
// that one action and nothing else — not the inventory, not the dispatches.
//
// ------------------------------------------------ GATE ON THE ACTION ---
// SAMPLING_ACTORS IS A TABLE OF ACTIONS, NOT A MINIMUM RANK, and that is the
// whole reason "the supervisor may add but may not view" is expressible at all.
// fabGate(min) and chromiaGate(min) ask "is this login at least tier X", which
// can only ever describe a ladder: any answer that admits addStock also admits
// everything below it. The rules here are not a ladder — the Fabrication
// Supervisor sits outside the module entirely and is allowed one action inside
// it — so the question has to be "may this login do THIS", asked per action.
//
// WHY THE FAB TEST IS RESTATED HERE rather than imported. It is the same test
// fabGate("SUPERVISOR") applies (fabTierOf maps FABRICATION + rank >= INCHARGE
// onto SUPERVISOR, and LINE_MANAGER onto MANAGER above it), but
// lib/fab/access.ts imports @/lib/rbac -> @/auth: it cannot be reached from a
// pure module, from node --test, or from the edge. Importing it would also
// couple sampling to the fabrication module and drag Prisma into middleware.
// The equivalence is pinned by tests/samplingAccess.test.ts instead: if
// fabTierOf ever changes what SUPERVISOR means, that test is the thing that
// says so.
import { rankOf, ROLE_RANK } from "../roles.ts";

/** Everything a signed-in user can be asked to do in this module. */
export type SamplingAction = "view" | "addStock" | "release" | "dispatch" | "deliver";
export const SAMPLING_ACTIONS: SamplingAction[] = ["view", "addStock", "release", "dispatch", "deliver"];

/** The three kinds of login this module recognises. Not a ranking — a
 *  FAB_SUPERVISOR is not "below" a SAMPLING login, he is a different person
 *  with one errand here. */
export type SamplingActor = "SAMPLING" | "FAB_SUPERVISOR" | "ADMIN";

/**
 * Who may perform each action.
 *
 * ADMIN is on every line rather than being special-cased in samplingCan,
 * because "admins span every department" is a fact about this table and should
 * be readable in it. The day one action is taken away from admins — nothing
 * suggests one will be — this is where it is written, and it is one word.
 *
 * addStock is the only line that is not the same as the others, and the whole
 * module exists around that difference.
 */
export const SAMPLING_ACTORS: Record<SamplingAction, readonly SamplingActor[]> = {
  view:     ["SAMPLING", "ADMIN"],
  addStock: ["SAMPLING", "FAB_SUPERVISOR", "ADMIN"],
  release:  ["SAMPLING", "ADMIN"],
  dispatch: ["SAMPLING", "ADMIN"],
  deliver:  ["SAMPLING", "ADMIN"],
};

/**
 * The Fabrication Supervisor tier that may add sample stock — branch
 * FABRICATION plus rank >= INCHARGE, which is exactly what fabGate("SUPERVISOR")
 * admits (SUPERVISOR and the MANAGER above it). A fab OPERATOR is not included:
 * the machine operator does not decide what is worth keeping.
 *
 * STILL BRANCH-BASED, deliberately, and this is not the stale half of the old
 * design leaking through. Fabrication IS still a department on main — branch
 * FABRICATION, with its own block in middleware.ts and its own tiers in
 * lib/fab/access.ts. Chromia stopped being one; fabrication did not. Writing
 * this as a role test would not match fabGate, which is the definition it has
 * to agree with.
 */
export function isFabStockContributor(user: unknown): boolean {
  if (!user) return false;
  const u = user as { role?: string | null; branch?: string | null };
  if (String(u.branch ?? "") !== "FABRICATION") return false;
  return rankOf(String(u.role ?? "")) >= ROLE_RANK.INCHARGE;
}

/**
 * Which kind of login this is, or null for everybody else.
 *
 * ADMIN first, then the role, then the fabrication seam: a login can only be
 * one of these, and the order is the precedence. Role SAMPLING is answered
 * WITHOUT looking at the branch, which mirrors roboGate() in lib/rbac.ts — a
 * capped role means the same thing wherever its branch happens to sit, and a
 * role/branch pair whose caps do not intersect is a configuration to reject in
 * Users & Roles, not something a gate can paper over.
 */
export function samplingActorOf(user: unknown): SamplingActor | null {
  if (!user) return null;
  const u = user as { role?: string | null; branch?: string | null };
  const role = String(u.role ?? "");
  if (rankOf(role) >= ROLE_RANK.ADMIN) return "ADMIN";   // admins span every department
  if (role === "SAMPLING") return "SAMPLING";
  if (isFabStockContributor(u)) return "FAB_SUPERVISOR";
  return null;
}

/** May this user do this? The whole access rule, in one call. */
export function samplingCan(user: unknown, action: SamplingAction): boolean {
  if (!SAMPLING_ACTIONS.includes(action)) return false;   // unknown action fails closed
  const actor = samplingActorOf(user);
  if (!actor) return false;
  return SAMPLING_ACTORS[action].includes(actor);
}

/** Everything this user may do — for a nav, an API's capability payload, or
 *  the coarse "may this login reach the module at all" question middleware
 *  asks at the path prefix. */
export function samplingActionsFor(user: unknown): SamplingAction[] {
  return SAMPLING_ACTIONS.filter((a) => samplingCan(user, a));
}

/**
 * May this login reach /sampling or /api/sampling AT ALL?
 *
 * The coarse gate, and the one middleware asks: it matches on a path prefix and
 * cannot tell an intake POST from an inventory GET, so it cannot say "add stock
 * but not view". Which action a request is allowed is decided in the route by
 * samplingGate(action) — the same split middleware.ts already documents on
 * /office/batch-verify ("this is the coarse gate; WHICH HALF a caller sees is
 * decided in the route itself").
 *
 * Defined as "can do at least one thing here" rather than as its own list of
 * roles, so it cannot drift from the table above: an actor added to
 * SAMPLING_ACTORS is admitted at the door by construction, and one removed from
 * every line is turned away at it.
 */
export function maySeeSamplingModule(user: unknown): boolean {
  return samplingActionsFor(user).length > 0;
}
