// GET   /api/office/commercial/holds/[id] — one hold, reconciled first
// PATCH /api/office/commercial/holds/[id] — its note (nothing else: the slabs
//        and the expiry change only through release / extend, which touch
//        finished goods too)
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { db, HOLD_INCLUDE, loadHold, reconcileAndLoad } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadHold(id);                       // 404 before touching inventory
    return json(plain(await reconcileAndLoad(id)));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadHold(id);
    const body = await readBody<{ notes?: unknown }>(req);
    const has = Object.prototype.hasOwnProperty.call(body, "notes");
    const row = has
      ? await db.commercialStockHold.update({ where: { id }, data: { notes: str(body.notes) }, include: HOLD_INCLUDE })
      : await loadHold(id);
    return json(plain(row));
  });
}
