// WHO REACHES THE PRODUCTION PLAN, and which rows count as "approved".
//
// Production planning used to be a screen inside the Commercial module, at
// /office/commercial/production-planning. It is its own Office tab now
// (/office/production-planning), because the plant is not Commercial's audience
// and a production plan buried three levels inside the sales module is a plan
// nobody on the floor opens.
//
// THAT MOVE IS A SECURITY EVENT, not a cosmetic one, and this file is the
// answer to it. Every path under /office/commercial is refused by
// maySeeCommercialModule in middleware; a path OUTSIDE that prefix inherits
// none of it. Moving the page without writing a new rule would not have kept
// its old gate — it would have dropped it, and handed the queue to every login
// that reaches /office. So the two new paths are gated here, in a module with
// no React, no Next, no Prisma and no auth, and middleware imports these two
// functions rather than repeating the test by hand. That is the lesson
// nav-rules.ts records at the top of itself: a rule kept in two places is a
// rule kept in neither.
//
// TWO DOORS, DELIBERATELY DIFFERENT:
//
//   · /office/production-planning — the planner's board. Unchanged reach: the
//     `planning` area, exactly as when it lived under Commercial. Whoever could
//     re-order the queue yesterday can re-order it today, and nobody else.
//
//   · /office/approved-plan — the manager's read-only view. A DIFFERENT
//     audience, which is the whole point of the second page: LINE_MANAGER and
//     above, who run the plant and need to read the plan without being able to
//     touch it. They are rank 3; every Commercial desk, the manager included,
//     is rank 1, so this gate does not open the board to them and their gate
//     does not open the plan to the floor. Planners are admitted too, so the
//     planner can see what the plant sees.
import { rankOf, ROLE_RANK } from "../roles.ts";
import { commercialAreasFor } from "../commercial/access-rules.ts";

/** The page paths this module governs. Exported so middleware and the tests
 *  name them once rather than spelling them out at each site. */
export const PLANNING_BOARD_PATH = "/office/production-planning";
export const APPROVED_PLAN_PATH = "/office/approved-plan";

/**
 * THE APPROVED PLAN IS THE COMMITTED PART OF THE QUEUE, and there is no
 * APPROVED status to read instead — commercial_production_status is
 * QUEUED | SCHEDULED | IN_PRODUCTION | PRODUCED | CANCELLED, and adding a sixth
 * value was refused as a bigger change than was asked for (owner, 2026-09-17).
 *
 * So "approved" means SCHEDULED or IN_PRODUCTION: a request somebody has
 * committed the plant to. QUEUED is deliberately excluded — it is the part
 * still being argued over, and showing the floor a running order that has not
 * been settled is how the floor starts working to the wrong one. PRODUCED and
 * CANCELLED are history, not plan.
 */
export const APPROVED_PLAN_STATUSES = Object.freeze(["SCHEDULED", "IN_PRODUCTION"] as const);

export type ApprovedPlanStatus = (typeof APPROVED_PLAN_STATUSES)[number];

/** Is this one of the statuses the manager's page shows? Takes the raw string
 *  a row carries, so an unknown value from a widened enum reads as "not
 *  approved" rather than throwing or leaking. */
export function isApprovedPlanStatus(status: unknown): status is ApprovedPlanStatus {
  return (APPROVED_PLAN_STATUSES as readonly string[]).includes(String(status ?? ""));
}

/**
 * May this login open the planning board and act on it?
 *
 * WRITE, not "not none", for the reason nav-rules.ts gives about its own row:
 * answer 16 made the production planner the admin's alone, and a `view` here
 * would be a page whose every control is refused. This is the same test the
 * Commercial sidebar applied to the row, lifted out so the path keeps its gate
 * now that the path has left the module.
 */
export function mayPlanProduction(user: unknown): boolean {
  return commercialAreasFor(user).planning === "write";
}

/**
 * May this login read the approved plan?
 *
 * LINE_MANAGER AND ABOVE — the plant's managers, which is what the page was
 * asked for — plus anyone who may plan, so the planner can check what the
 * floor is being shown. INCHARGE (rank 2) is deliberately NOT admitted: if the
 * shift incharges should see it too, this one comparison is the only edit.
 */
export function maySeeApprovedPlan(user: unknown): boolean {
  const role = (user as { role?: unknown } | null | undefined)?.role;
  if (rankOf(typeof role === "string" ? role : String(role ?? "")) >= ROLE_RANK.LINE_MANAGER) return true;
  return mayPlanProduction(user);
}

/**
 * The middleware rule for both paths in one place: given a path, the predicate
 * that decides it, or null when this module does not govern the path.
 *
 * Exact-or-subpath, like the /office/batch-verify clause in routeCaps, so a
 * future /office/production-planning-admin is not opened by this rule.
 */
export function productionPlanGuard(p: string): ((user: unknown) => boolean) | null {
  const path = p.split("?")[0];
  const under = (base: string) => path === base || path.startsWith(base + "/");
  if (under(PLANNING_BOARD_PATH)) return mayPlanProduction;
  if (under(APPROVED_PLAN_PATH)) return maySeeApprovedPlan;
  return null;
}
