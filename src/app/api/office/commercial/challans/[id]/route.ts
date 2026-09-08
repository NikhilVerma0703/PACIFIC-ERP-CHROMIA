// GET   /api/office/commercial/challans/[id] — one challan
// PATCH /api/office/commercial/challans/[id] — edit a DRAFT
//
// Editing re-settles every line's approximate amount, the total and the total
// in words, so the row and the printed page can never disagree. The number is
// not editable — it came from the counter.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { canEditChallan } from "@/lib/commercial/challan-rules";
import { db, CHALLAN_INCLUDE, challanIdOf, loadChallan, challanPatchFromBody, consigneeFromBody } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view", "challans");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await challanIdOf(params);
    return json(plain(await loadChallan(id)));
  });
}

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("write", "challans");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await challanIdOf(params);
    const row = await loadChallan(id);
    if (!canEditChallan(String(row.status))) fail(409, `Only a draft can be edited (this challan is ${String(row.status).toLowerCase()})`);
    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();

    const data = challanPatchFromBody(body, settings);
    if (has(body, "consigneeName") || has(body, "consigneeClientId") || has(body, "consigneeAddress") || has(body, "consigneeGstin")) {
      Object.assign(data, await consigneeFromBody({
        consigneeClientId: has(body, "consigneeClientId") ? body.consigneeClientId : row.consigneeClientId,
        consigneeName: has(body, "consigneeName") ? body.consigneeName : row.consigneeName,
        consigneeAddress: has(body, "consigneeAddress") ? body.consigneeAddress : row.consigneeAddress,
        consigneeGstin: has(body, "consigneeGstin") ? body.consigneeGstin : row.consigneeGstin,
      }));
    }
    if (Object.keys(data).length === 0) return json(plain(row));
    if (data.orderId) {
      const order = await db.commercialOrder.findUnique({ where: { id: data.orderId as string }, select: { id: true } });
      if (!order) fail(400, "Order not found");
    }

    await db.commercialDeliveryChallan.update({ where: { id }, data });
    const orderId = (data.orderId as string | null | undefined) ?? (row.orderId as string | null);
    if (orderId) {
      await logOrderEvent(orderId, "note", {
        note: `Delivery challan ${row.number} edited`,
        by: g.user,
        payload: { challanId: id, fields: Object.keys(data) },
      });
    }
    const after = await db.commercialDeliveryChallan.findUnique({ where: { id }, include: CHALLAN_INCLUDE });
    return json(plain(after));
  });
}
