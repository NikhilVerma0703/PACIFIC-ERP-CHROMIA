// PATCH /api/office/commercial/packing-lists/[plId]/slabs/assign — bulk crate
// assignment: { slabIds: string[], crateId: string | null }. Ticking twenty
// rows and choosing a crate once is how a list is actually built; doing it one
// PATCH at a time is twenty writes and twenty chances to lose one.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { db, loadList, paramPl, requireEditable } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    requireEditable(list);
    const body = await readBody<{ slabIds?: unknown; crateId?: unknown }>(req);

    const ids = Array.isArray(body.slabIds) ? body.slabIds.map((v) => String(v)).filter(Boolean) : [];
    if (!ids.length) fail(400, "Pick at least one slab");
    const onList = new Set(list.slabs.map((s) => s.id));
    const unknown = ids.filter((i) => !onList.has(i));
    if (unknown.length) fail(400, `${unknown.length} slab(s) are not on ${list.number}`);

    const crateId = str(body.crateId);
    if (crateId && !list.crates.some((c) => c.id === crateId)) fail(400, "That crate is not on this list");

    const res = await db.commercialPackedSlab.updateMany({ where: { packingListId: plId, id: { in: ids } }, data: { crateId } });
    const crateNo = crateId ? list.crates.find((c) => c.id === crateId)?.crateNo : null;
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: ${res.count} slab(s) ${crateId ? `moved to crate ${crateNo}` : "unassigned"}`,
      by: g.user,
      payload: { packingListId: plId, slabIds: ids, crateId },
    });
    return json(plain({ list: await loadList(plId), moved: res.count }));
  });
}
