// GET   /api/office/commercial/production-requests/[id]
// PATCH /api/office/commercial/production-requests/[id]
//        { status?, cleaningNote?, plannedBatch?, notes?, producedBatchKeys? }
//
// Two permissions in one handler, deliberately. `notes` is Commercial's — the
// person who raised the shortfall adding what the customer said — and needs
// only `write`. The status, the cleaning note, the planned batch and the
// produced batch keys are the PLANNER's, and a body naming any of them without
// the `plan` action is refused whatever else it carries (patchNeedsPlan).
//
// PRODUCED writes an event on the order too, so the order log says production
// ran — the order screen is where Commercial looks, not the queue.
import { commercialGate, actorStamp, commercialCan } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  canMoveStatus, statusPatch, patchNeedsPlan, parseBatchKeys, label, isProductionStatus,
} from "@/lib/commercial/production-rules";
import { db, REQUEST_INCLUDE, loadRequest } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => json(plain(await loadRequest(await paramId(params)))));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const row = await loadRequest(id);
    const body = await readBody<Record<string, unknown>>(req);
    if (patchNeedsPlan(body) && !commercialCan(g.user, "plan")) {
      return json({ error: "Only production planning may change a request's status, batch or cleaning note." }, 403);
    }

    const stamp = actorStamp(g.user);
    const data: Record<string, unknown> = {};
    if (has(body, "notes")) data.notes = str(body.notes);
    if (has(body, "cleaningNote")) data.cleaningNote = str(body.cleaningNote);
    if (has(body, "plannedBatch")) data.plannedBatch = str(body.plannedBatch);
    if (has(body, "producedBatchKeys")) data.producedBatchKeys = parseBatchKeys(body.producedBatchKeys);

    let moved: string | null = null;
    if (has(body, "status") && body.status != null && body.status !== "") {
      const to = String(body.status).trim().toUpperCase();
      if (!isProductionStatus(to)) fail(400, `Unknown status ${to}`);
      const check = canMoveStatus(String(row.status), to);
      if (!check.ok) fail(409, check.reason);
      Object.assign(data, statusPatch(to, new Date(), stamp.id));
      moved = to;
    }

    if (!Object.keys(data).length) fail(400, "Nothing to change");
    const updated = await db.commercialProductionRequest.update({ where: { id }, data, include: REQUEST_INCLUDE });

    if (row.orderId) {
      const orderId = String(row.orderId);
      if (moved === "PRODUCED") {
        await logOrderEvent(orderId, "production_produced", {
          note: `${row.qtyShort} slab(s) of ${row.design} ${row.thickness} marked produced`
            + (updated.producedBatchKeys?.length ? ` (batch ${updated.producedBatchKeys.join(", ")})` : ""),
          by: g.user,
          payload: { requestId: id, design: row.design, thickness: row.thickness, qtyShort: row.qtyShort, batches: updated.producedBatchKeys ?? [] },
        });
      } else if (moved) {
        await logOrderEvent(orderId, "note", {
          note: `Production request for ${row.design} ${row.thickness}: ${label(String(row.status))} → ${label(moved)}`,
          by: g.user,
          payload: { requestId: id, from: row.status, to: moved },
        });
      }
    }

    return json(plain(updated));
  });
}
