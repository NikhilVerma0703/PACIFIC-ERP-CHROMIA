// GET /api/office/commercial/production-requests?status=&orderId=&design=
//
// The Production Planning queue. Default is the three open statuses (QUEUED,
// SCHEDULED, IN_PRODUCTION) ordered by priority — the order the planner
// dragged them into. Ask for PRODUCED / CANCELLED and it reads as history,
// newest first, because a produced request's priority means nothing.
//
// The design master's colours and the two lightness thresholds ride along
// (round two, answers 14 and 15). The board draws the swatch from them and,
// while a drag is still optimistic, judges the changeover by the same L* and
// the same thresholds the server will — otherwise a row would flag amber on
// screen and come back unflagged, or the reverse.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain, str } from "@/lib/commercial/http";
import { parseStatusFilter, historyOnly } from "@/lib/commercial/production-rules";
import { pageArgs } from "@/lib/commercial/holds-rules";
import { db, REQUEST_INCLUDE, loadColourMap, loadPlanning } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "planning");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const statuses = parseStatusFilter(u.searchParams.get("status"));
    const orderId = str(u.searchParams.get("orderId"));
    const design = str(u.searchParams.get("design"));
    const where: Record<string, unknown> = { status: { in: statuses } };
    if (orderId) where.orderId = orderId;
    if (design) where.design = { contains: design, mode: "insensitive" };
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const orderBy = historyOnly(statuses)
      ? [{ raisedAt: "desc" as const }]
      : [{ priority: "asc" as const }, { raisedAt: "asc" as const }];
    const [items, total, colours, planning] = await Promise.all([
      db.commercialProductionRequest.findMany({ where, orderBy, skip, take: limit, include: REQUEST_INCLUDE }),
      db.commercialProductionRequest.count({ where }),
      loadColourMap(),
      loadPlanning(),
    ]);
    return json(plain({ items, total, page, limit, statuses, colours, planning }));
  });
}
