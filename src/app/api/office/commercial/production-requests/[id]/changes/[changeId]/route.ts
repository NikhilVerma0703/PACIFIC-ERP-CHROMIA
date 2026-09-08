// POST /api/office/commercial/production-requests/[id]/changes/[changeId]
//      { action: "addBack" | "remove" }
//
// The answer to a row on the "planned but not scheduled" panel (answer 13):
// something was taken off the plan, and the planner now either puts it back
// — the figure returns to what it was before the cut and the row reads
// ADDED_BACK — or confirms it is gone, and the row reads REMOVED so the panel
// stops asking. A row that is not OPEN was already answered; answering it
// again would restore a figure somebody has since changed on purpose
// (production-rules.resolveChange).
//
// Gates "plan": what is on the plan is the planner's.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { parseChangeAction, resolveChange, figureLabel, type PlanChangeLike } from "@/lib/commercial/production-rules";
import { db, loadRequest } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; changeId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("plan");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, changeId } = await params;
    if (!id || !changeId) fail(400, "Missing id");
    const row = await loadRequest(id);
    const change = await db.commercialProductionPlanChange.findFirst({ where: { id: changeId, requestId: id } });
    if (!change) fail(404, "That plan change is not on this request");

    const body = await readBody<{ action?: unknown }>(req);
    const action = parseChangeAction(body.action);
    if (!action) fail(400, "action must be addBack or remove");
    const res = resolveChange(change as PlanChangeLike, action);
    if (!res.ok) fail(409, res.reason);

    const stamp = actorStamp(g.user);
    const now = new Date();
    const ops = [
      db.commercialProductionPlanChange.update({ where: { id: changeId }, data: { status: res.status, resolvedAt: now, resolvedById: stamp.id } }),
    ];
    if (res.restore) ops.push(db.commercialProductionRequest.update({ where: { id }, data: { [res.restore.field]: res.restore.value } }));
    await db.$transaction(ops);

    if (row.orderId) {
      const field = String(change.field);
      const current = row[field as keyof typeof row];
      await logOrderEvent(String(row.orderId), "plan_changed", {
        note: res.restore
          ? `${figureLabel(field)} for ${row.design} ${row.thickness} added back: ${current ?? "—"} → ${res.restore.value ?? "—"}`
          : `${figureLabel(field)} reduction for ${row.design} ${row.thickness} (${change.fromValue ?? "—"} → ${change.toValue ?? "—"}) confirmed removed`,
        by: g.user,
        payload: res.restore
          ? { requestId: id, changeId, field, from: current, to: res.restore.value, action }
          : { requestId: id, changeId, field, from: change.fromValue, to: change.toValue, action },
      });
    }
    return json(plain(await loadRequest(id)));
  });
}
