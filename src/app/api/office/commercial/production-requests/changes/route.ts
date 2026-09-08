// GET /api/office/commercial/production-requests/changes?status=OPEN
//     → { items: (PlanChangeDto & { request })[], total, statuses }
//
// Every commercial_production_plan_change row in the statuses asked (OPEN by
// default), newest first, each joined to its request (design, thickness,
// status, order number, customer). This is what feeds the "Planned but not
// scheduled" panel (answer 13): a reduction is never simply gone, and the
// panel must show EVERY open one — not only those on the rows the queue
// happened to load on the current page. Before this route the panel read the
// changes riding on the loaded rows, so an open cut on a request past the
// page limit, or on a produced request older than the last thirty, vanished.
//
// Gates "view", like the queue itself: seeing what was cut is reading;
// answering it (changes/[changeId]) is the planner's.
//
// A static segment beside [id]: Next matches "changes" here before the dynamic
// route, which is why this is a folder of its own.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { parseChangeStatusFilter } from "@/lib/commercial/production-rules";
import { pageArgs } from "@/lib/commercial/holds-rules";
import { db } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANGE_INCLUDE = {
  request: {
    select: {
      id: true, design: true, thickness: true, status: true, plannedSlabs: true, plannedHours: true, cleaningHours: true,
      order: { select: { id: true, number: true, status: true, client: { select: { id: true, name: true } } } },
    },
  },
} as const;

export async function GET(req: Request) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const statuses = parseChangeStatusFilter(u.searchParams.get("status"));
    const where = { status: { in: statuses } };
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const [items, total] = await Promise.all([
      db.commercialProductionPlanChange.findMany({ where, orderBy: { changedAt: "desc" }, skip, take: limit, include: CHANGE_INCLUDE }),
      db.commercialProductionPlanChange.count({ where }),
    ]);
    return json(plain({ items, total, page, limit, statuses }));
  });
}
