// PATCH /api/office/commercial/production-requests/reorder — { ids: string[] }
//
// The drag. The ids the planner sent, in the order sent, become priorities
// 1..n. Only requests that still exist are written; a stale screen naming one
// that was produced meanwhile simply does not move it, and a request the
// planner did not name keeps the priority it has.
//
// Gates "plan": deciding what the plant runs next is the planner's, not
// Commercial's (access-rules.ts — ADMIN only, today).
//
// A static segment beside [id]: Next matches "reorder" here before the dynamic
// route, which is why this is a folder of its own and not a special-cased id.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { reorderPriorities, OPEN_STATUSES } from "@/lib/commercial/production-rules";
import { db, REQUEST_INCLUDE } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const g = await commercialGate("plan");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<{ ids?: unknown }>(req);
    if (!Array.isArray(body.ids)) fail(400, "Send ids as the full ordered list");
    const all: Array<{ id: string }> = await db.commercialProductionRequest.findMany({ select: { id: true } });
    const patches = reorderPriorities(body.ids, all);
    if (!patches.length) fail(400, "None of those requests exist any more — refresh the queue.");
    await db.$transaction(patches.map((p) => db.commercialProductionRequest.update({ where: { id: p.id }, data: { priority: p.priority } })));
    const items = await db.commercialProductionRequest.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      orderBy: [{ priority: "asc" }, { raisedAt: "asc" }],
      include: REQUEST_INCLUDE,
      take: 200,
    });
    return json(plain({ updated: patches.length, items }));
  });
}
