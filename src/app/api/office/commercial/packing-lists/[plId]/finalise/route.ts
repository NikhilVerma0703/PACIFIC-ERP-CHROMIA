// POST /api/office/commercial/packing-lists/[plId]/finalise — the list the
// dispatch team passed becomes the document the container is stuffed from.
// Only a VERIFIED list may be finalised; the order goes READY.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { canFinalise, PACKING_STATUS_LABEL, type PackingStatus } from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    if (!canFinalise(list.status)) {
      fail(409, `${list.number} is ${PACKING_STATUS_LABEL[list.status as PackingStatus]?.toLowerCase() ?? list.status} — only a verified list can be finalised`);
    }
    await readBody(req);
    await db.commercialPackingList.update({ where: { id: plId }, data: { status: "FINAL", finalisedAt: new Date() } });
    await bumpOrder(list.orderId, "READY", g.user, `Packing list ${list.number} final`);
    await logOrderEvent(list.orderId, "packing_final", {
      note: `Packing list ${list.number} finalised — ${list.slabs.length} slab(s) in ${list.crates.length} package(s)`,
      by: g.user,
      payload: { packingListId: plId, number: list.number, slabs: list.slabs.length, crates: list.crates.length },
    });
    return json(plain(await loadList(plId)));
  });
}
