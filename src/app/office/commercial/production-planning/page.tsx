// /office/commercial/production-planning — MOVED to /office/production-planning
// on 2026-09-17 ("separate tab for production planning from commercial").
//
// This stub stays because the old path is in the wild: the Production queue KPI
// and the "Open production planning" link on the Commercial overview, the
// "Open the planning queue" link on an order's Stock tab, and whatever anyone
// bookmarked over the months it lived here. All three in-app links now point at
// the new path; this catches the bookmarks.
//
// A REDIRECT, NOT A DELETE, and not a copy of the board either. Two pages
// rendering the same board would be two gates to keep in step, which is the
// arrangement this whole move exists to end.
//
// It is still reached through the Commercial module's own gate — the path is
// under /office/commercial, so middleware's maySeeCommercialModule ran before
// this file did, and `production-planning` is still mapped to the `planning`
// area in SEGMENT_AREA for exactly that reason. A login without the area is
// refused at the prefix and never arrives here to be redirected.
import { redirect, permanentRedirect } from "next/navigation";
import { currentUser } from "@/lib/rbac";
import { mayPlanProduction, PLANNING_BOARD_PATH } from "@/lib/production-plan/access-rules";

export const dynamic = "force-dynamic";

export default async function MovedProductionPlanningPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Ask the destination's question here rather than bouncing someone to a page
  // that will only bounce them again: a login with the Commercial area but no
  // `planning` write reaches this path and would land on /no-access with the
  // NEW path in `from`, which reads as a broken link rather than a refusal.
  if (!mayPlanProduction(user)) redirect("/no-access?from=/office/commercial/production-planning");
  permanentRedirect(PLANNING_BOARD_PATH);
}
