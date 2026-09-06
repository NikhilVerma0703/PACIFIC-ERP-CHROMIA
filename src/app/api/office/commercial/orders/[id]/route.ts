// GET   /api/office/commercial/orders/[id] — the order detail (DESIGN.md §5)
// PATCH /api/office/commercial/orders/[id] — header edit; checklist re-prefilled; event "edited"
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { changedFields } from "@/lib/commercial/orders-rules";
import { db, headerPatchFromBody, loadClient, loadOrderDetail, loadOrderWithItems, refreshChecklist } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    return json(plain(await loadOrderDetail(id)));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const existing = await loadOrderWithItems(id);
    const body = await readBody<Record<string, unknown>>(req);
    const data = headerPatchFromBody(body, { allowKind: true, allowClient: true });
    if (data.clientId && data.clientId !== existing.clientId) await loadClient(String(data.clientId));
    const changed = changedFields(existing, data);
    if (changed.length === 0) {
      return json(plain(await loadOrderDetail(id)));
    }
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = data[k];
    try {
      await db.commercialOrder.update({ where: { id }, data: patch });
    } catch (e) {
      if ((e as { code?: string }).code === "P2003") fail(400, "That client or enquiry does not exist");
      throw e;
    }
    await refreshChecklist(id);
    await logOrderEvent(id, "edited", {
      note: `Edited ${changed.join(", ")}`,
      by: g.user,
      payload: { fields: changed },
    });
    return json(plain(await loadOrderDetail(id)));
  });
}
