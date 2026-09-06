// PATCH  /…/packing-lists/[plId]/slabs/[slabId] — crate, the customer's own
//        slab and batch numbers, measured centimetres, sort order
// DELETE /…/packing-lists/[plId]/slabs/[slabId] — take the slab off the list
//
// Measured centimetres are the floor's, not the inventory's: the stored inches
// are nominal on almost every slab (137 × 79), and the measurement list prints
// what was actually measured. Whichever side is typed replaces the stored one
// and the areas follow (remeasure).
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num, int } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { unpackSlabs } from "@/lib/commercial/inventory-bridge";
import { remeasure, fmtSlabNo, restoredSlabs } from "@/lib/commercial/packing-rules";
import { db, loadList, paramTwo, requireEditable, byOf, isAdminOf } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string; slabId: string }> };

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, slabId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "slabId");
    const list = await loadList(plId);
    requireEditable(list);
    const slab = list.slabs.find((s) => s.id === slabId);
    if (!slab) fail(404, "Slab not found on this list");
    const body = await readBody<Record<string, unknown>>(req);

    const data: Record<string, unknown> = {};
    if (has(body, "crateId")) {
      const crateId = str(body.crateId);
      if (crateId && !list.crates.some((c) => c.id === crateId)) fail(400, "That crate is not on this list");
      data.crateId = crateId;
    }
    if (has(body, "customerSlabNo")) data.customerSlabNo = str(body.customerSlabNo);
    if (has(body, "customerBatchNo")) data.customerBatchNo = str(body.customerBatchNo);
    if (has(body, "customerSku")) data.customerSku = str(body.customerSku);
    if (has(body, "sortOrder")) {
      const n = int(body.sortOrder);
      if (n === null) fail(400, "Sort order must be a number");
      data.sortOrder = n;
    }
    if (has(body, "lengthCm") || has(body, "widthCm")) {
      const lengthCm = has(body, "lengthCm") ? num(body.lengthCm) : null;
      const widthCm = has(body, "widthCm") ? num(body.widthCm) : null;
      if (has(body, "lengthCm") && body.lengthCm !== null && body.lengthCm !== "" && lengthCm === null) fail(400, "Length must be a number of centimetres");
      if (has(body, "widthCm") && body.widthCm !== null && body.widthCm !== "" && widthCm === null) fail(400, "Width must be a number of centimetres");
      const m = remeasure(
        { lengthCm: Number(slab.lengthCm) || null, widthCm: Number(slab.widthCm) || null },
        { lengthCm, widthCm },
      );
      data.lengthCm = m.lengthCm; data.widthCm = m.widthCm; data.sqm = m.sqm; data.sqft = m.sqft;
    }
    if (!Object.keys(data).length) return json(plain(slab));

    const updated = await db.commercialPackedSlab.update({ where: { id: slabId }, data });
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: slab #${fmtSlabNo(Number(slab.slabNumber))} updated (${Object.keys(data).join(", ")})`,
      by: g.user,
      payload: { packingListId: plId, slabId, fields: Object.keys(data) },
    });
    return json(plain(updated));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, slabId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "slabId");
    const list = await loadList(plId);
    requireEditable(list);
    const slab = list.slabs.find((s) => s.id === slabId);
    if (!slab) fail(404, "Slab not found on this list");

    // A list reopened after a rejection still has its FIT slabs PACKED in the
    // inventory. Pulling one off the list has to hand it back, or it sits
    // PACKED against nothing for ever.
    //
    // AND THE ROW IS ONLY DELETED IF IT CAME BACK. This row is the one thing in
    // the module that points at the slab. If the list packed it and the bridge
    // could not release it — it could not read the row, or the inventory refused
    // — deleting the row here is what strands the slab: PACKED, on no list, and
    // findable only by someone who already knows the number.
    const n = Number(slab.slabNumber);
    const back = await unpackSlabs({ slabNumbers: [n], by: byOf(g), isAdmin: isAdminOf(g) });
    const { failed } = restoredSlabs([n], back);
    if (failed.length && list.submittedAt) {
      fail(409, `Slab #${fmtSlabNo(n)} is still PACKED in finished goods (${failed[0].reason}) — it stays on ${list.number} until it can be put back.`);
    }
    await db.commercialPackedSlab.delete({ where: { id: slabId } });
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: slab #${fmtSlabNo(n)} removed${back.updated ? " and returned to stock" : ""}`,
      by: g.user,
      payload: { packingListId: plId, slabId, slabNumber: slab.slabNumber, returnedToStock: back.updated },
    });
    return json(plain({ list: await loadList(plId), returnedToStock: back.updated }));
  });
}
