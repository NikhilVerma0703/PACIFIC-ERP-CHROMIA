// PATCH /api/office/commercial/dispatch-check/[plId]/slabs/[slabId]
// { fit: "FIT" | "UNFIT", unfitReason? } — one slab's verdict from the floor.
//
// UNFIT must say why: an unfit slab sends the whole list back and pulls the
// order to PACKING, and "no reason given" is not something Commercial can act
// on at eight in the evening with a container booked.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { fitPatch, canVerify, fitCounts, checkerMaySee, checkerSlabView } from "@/lib/commercial/packing-rules";
import { db, paramTwo } from "../../../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string; slabId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("verify");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, slabId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "slabId");
    const list = await db.commercialPackingList.findUnique({ where: { id: plId }, select: { id: true, number: true, status: true } });
    // Same two gates as the GET beside this one: a list outside the dispatch
    // check's three statuses does not exist here, so a DRAFT list is a 404 and
    // not a status message that confirms it.
    if (!list || !checkerMaySee(String(list.status))) fail(404, "Packing list not found");
    if (!canVerify(list.status)) {
      fail(409, `${list.number} is ${list.status === "VERIFIED" ? "already verified" : "already rejected"} — it is not waiting for a check`);
    }
    const slab = await db.commercialPackedSlab.findUnique({ where: { id: slabId }, select: { id: true, packingListId: true, slabNumber: true } });
    if (!slab || slab.packingListId !== plId) fail(404, "Slab not found on this list");

    const body = await readBody<{ fit?: unknown; unfitReason?: unknown }>(req);
    const patch = fitPatch(body.fit, body.unfitReason);
    if (!patch.ok) fail(400, patch.reason);

    const stamp = actorStamp(g.user);
    const updated = await db.commercialPackedSlab.update({
      where: { id: slabId },
      data: { fit: patch.fit, unfitReason: patch.unfitReason, checkedById: stamp.id, checkedAt: new Date() },
    });
    const slabs: Array<{ fit: string }> = await db.commercialPackedSlab.findMany({ where: { packingListId: plId }, select: { fit: true } });
    // The slab as the floor screen reads it, not the row as it is stored: this
    // segment answers a login that may check slabs and nothing else.
    return json(plain({ slab: checkerSlabView(plain<Record<string, unknown>>(updated)), fit: fitCounts(slabs) }));
  });
}
