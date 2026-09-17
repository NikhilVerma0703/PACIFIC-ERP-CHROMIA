// /office/production-planning — the shortfall queue, as its own Office tab.
//
// MOVED OUT OF /office/commercial/production-planning (owner, 2026-09-17:
// "separate tab for production planning from commercial, in office only"). The
// screen itself is unchanged — same board, same actions, same API under
// /api/office/commercial/production-requests, which stays where it is because
// moving the API too would have been a far larger change than was asked for.
// What changed is where it hangs: the plant is not Commercial's audience.
//
// IT CARRIES ITS OWN GATE NOW. Under /office/commercial the module layout
// asked commercialGate("view") and middleware refused the prefix through
// maySeeCommercialModule; out here neither applies, so the page asks
// mayPlanProduction directly and middleware asks the same function through
// productionPlanGuard. One rule, two callers, no copy.
//
// WRITE, NOT VIEW, and this is the one deliberate narrowing in the move. The
// old page gated commercialGate("view", "planning") so anyone in Commercial
// could SEE the queue while only "plan" could re-order it — right when the
// queue sat inside the module the requesters work in. Out here it is a tab of
// its own, and a tab that opens a board whose every control is refused is worse
// than no tab: the Commercial sidebar's own row already demanded write for
// exactly that reason. Commercial still reads the queue where it always did —
// the Production queue KPI and the order Stock tab both link here, and both are
// shown to logins that have the area.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { commercialGate } from "@/lib/commercial/access";
import { mayPlanProduction, APPROVED_PLAN_PATH } from "@/lib/production-plan/access-rules";
import { ProductionPlanningBoard } from "@/components/commercial/production/ProductionPlanningBoard";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Production planning" };

export default async function ProductionPlanningPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!mayPlanProduction(user)) redirect("/no-access?from=/office/production-planning");
  // The board still takes its action list from the commercial table, because
  // the actions it enables (plan, write, cancel) are that table's vocabulary.
  const g = await commercialGate("view", "planning");
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Production planning</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What Commercial is short of, in the order the plant should make it, with the shade of each design and the
          slabs, hours and cleaning hours planned. Drag a row (or use ▲▼) to change the order — a light design straight
          after a dark one is flagged and costs the longer clean — edit the plan in place, and mark a request produced
          once the slabs are in finished goods. Anything cut from a plan waits below until it is added back or removed.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Once a row is scheduled it appears on the{" "}
          <Link href={APPROVED_PLAN_PATH} className="font-medium text-brand hover:underline">approved plan</Link>{" "}
          the plant managers read. Queued rows stay here until then.
        </p>
      </div>
      <ProductionPlanningBoard actions={g.actions} />
    </Shell>
  );
}
