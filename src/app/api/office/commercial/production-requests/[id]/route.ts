// GET    /api/office/commercial/production-requests/[id]
// PATCH  /api/office/commercial/production-requests/[id]
//        { status?, producedBatchKeys?, plannedSlabs?, plannedHours?, cleaningHours?,   ← plan
//          notes?, cleaningNote?, plannedBatch?, reason? }                              ← write
// DELETE /api/office/commercial/production-requests/[id]                               ← write (answer 15)
//
// Two permissions in one handler, deliberately. `notes`, the cleaning note and
// the planned batch are hand-edits answer 15 gives anyone who may write. The
// status, the produced batch keys and the plan's own figures (answer 13) are
// the PLANNER's, and a body naming any of them without `plan` is refused
// whatever else it carries (patchNeedsPlan).
//
// Every figure that moves writes a commercial_production_plan_change row
// (production-rules.planChanges): a reduction arrives OPEN and shows on the
// "planned but not scheduled" panel until somebody adds it back or removes it;
// an increase is logged already resolved. Each writes a plan_changed event on
// the order with field / from / to, so the order's log explains its plan.
//
// PRODUCED writes an event on the order too, so the order log says production
// ran — the order screen is where Commercial looks, not the queue.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  canMoveStatus, statusPatch, patchNeedsPlan, parseBatchKeys, label, isProductionStatus,
  parsePlanFigures, planChanges, figureLabel, canDeleteRequest, type PlanFigureField,
} from "@/lib/commercial/production-rules";
import { db, REQUEST_INCLUDE, loadRequest, recomputeQueue } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "planning");
  if (!g.ok) return deny(g);
  return handle(async () => json(plain(await loadRequest(await paramId(params)))));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "planning");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const row = await loadRequest(id);
    const body = await readBody<Record<string, unknown>>(req);
    if (patchNeedsPlan(body) && !g.actions.includes("plan")) {
      return json({ error: "Only production planning may change a request's status, produced batches or planned figures." }, 403);
    }

    const stamp = actorStamp(g.user);
    const now = new Date();
    const data: Record<string, unknown> = {};
    if (has(body, "notes")) data.notes = str(body.notes);
    if (has(body, "cleaningNote")) data.cleaningNote = str(body.cleaningNote);
    if (has(body, "plannedBatch")) data.plannedBatch = str(body.plannedBatch);
    if (has(body, "producedBatchKeys")) data.producedBatchKeys = parseBatchKeys(body.producedBatchKeys);

    const figures = parsePlanFigures(body);
    if (!figures.ok) fail(400, figures.reason);
    const before: Partial<Record<PlanFigureField, unknown>> = {
      plannedSlabs: row.plannedSlabs, plannedHours: row.plannedHours, cleaningHours: row.cleaningHours,
    };
    const changes = planChanges(before, figures.figures, stamp, { requestId: id, now, reason: str(body.reason) });
    for (const c of changes) data[c.field] = c.toValue;

    let moved: string | null = null;
    if (has(body, "status") && body.status != null && body.status !== "") {
      const to = String(body.status).trim().toUpperCase();
      if (!isProductionStatus(to)) fail(400, `Unknown status ${to}`);
      const check = canMoveStatus(String(row.status), to);
      if (!check.ok) fail(409, check.reason);
      Object.assign(data, statusPatch(to, now, stamp.id));
      moved = to;
    }

    if (!Object.keys(data).length) fail(400, "Nothing to change");
    // One transaction: the figure and its plan-change rows land together, or
    // not at all. Two writes could leave a reduction on the plan with no OPEN
    // row on the "planned but not scheduled" panel — the slab answer 13 says
    // must never be "simply gone".
    await db.$transaction([
      db.commercialProductionRequest.update({ where: { id }, data }),
      ...(changes.length ? [db.commercialProductionPlanChange.createMany({ data: changes })] : []),
    ]);

    if (row.orderId) {
      const orderId = String(row.orderId);
      for (const c of changes) {
        await logOrderEvent(orderId, "plan_changed", {
          note: `${figureLabel(c.field)} for ${row.design} ${row.thickness}: ${c.fromValue ?? "—"} → ${c.toValue ?? "—"}`
            + (c.status === "OPEN" ? " (reduction — on the not-scheduled list)" : "")
            + (c.reason ? ` — ${c.reason}` : ""),
          by: g.user,
          payload: { requestId: id, field: c.field, from: c.fromValue, to: c.toValue, delta: c.delta, reason: c.reason, open: c.status === "OPEN" },
        });
      }
      if (moved === "PRODUCED") {
        const keys = (data.producedBatchKeys as string[] | undefined) ?? (row.producedBatchKeys as string[] | undefined) ?? [];
        await logOrderEvent(orderId, "production_produced", {
          note: `${row.qtyShort} slab(s) of ${row.design} ${row.thickness} marked produced` + (keys.length ? ` (batch ${keys.join(", ")})` : ""),
          by: g.user,
          payload: { requestId: id, design: row.design, thickness: row.thickness, qtyShort: row.qtyShort, batches: keys },
        });
      } else if (moved) {
        await logOrderEvent(orderId, "note", {
          note: `Production request for ${row.design} ${row.thickness}: ${label(String(row.status))} → ${label(moved)}`,
          by: g.user,
          payload: { requestId: id, from: row.status, to: moved },
        });
      }
    }

    // A status move takes a row into or out of the chain, so the rows behind
    // it face a different predecessor.
    const queue = moved ? await recomputeQueue(g.user, `${row.design} ${label(moved).toLowerCase()}`) : { recomputed: 0, warnings: [] };
    const updated = await loadRequest(id);
    return json(plain({ ...updated, changesWritten: changes.length, recomputed: queue.recomputed, warnings: queue.warnings }));
  });
}

/** Answer 15: delete a request by hand. Write may take away one the plant has
 *  not acted on; IN_PRODUCTION / PRODUCED need plan (canDeleteRequest). The
 *  plan-change rows go with it (cascade); the order's log keeps the fact. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "planning");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const row = await loadRequest(id);
    const guard = canDeleteRequest(String(row.status), g.actions);
    if (!guard.ok) fail(403, guard.reason);
    await db.commercialProductionRequest.delete({ where: { id } });
    if (row.orderId) {
      await logOrderEvent(String(row.orderId), "plan_changed", {
        note: `Production request for ${row.qtyShort} slab(s) of ${row.design} ${row.thickness} deleted by hand (was ${label(String(row.status)).toLowerCase()})`,
        by: g.user,
        payload: { requestId: id, field: "request", from: row.status, to: null, deleted: true, design: row.design, thickness: row.thickness, qtyShort: row.qtyShort },
      });
    }
    const queue = await recomputeQueue(g.user, `${row.design} deleted from the queue`);
    return json(plain({ deleted: true, id, recomputed: queue.recomputed, warnings: queue.warnings }));
  });
}
