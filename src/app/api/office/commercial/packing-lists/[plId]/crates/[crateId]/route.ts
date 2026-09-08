// PATCH  /api/office/commercial/packing-lists/[plId]/crates/[crateId] — edit
// DELETE /api/office/commercial/packing-lists/[plId]/crates/[crateId] — remove
//
// Deleting a crate does not delete its slabs: they come back to the unassigned
// pool so they can be put in another crate. A slab is a real thing; a crate is
// how we chose to group them this morning.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num, int } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { db, loadList, paramTwo, requireEditable, syncPackages } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string; crateId: string }> };

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, crateId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "crateId");
    const list = await loadList(plId);
    requireEditable(list);
    const crate = list.crates.find((c) => c.id === crateId);
    if (!crate) fail(404, "Crate not found on this list");
    const body = await readBody<Record<string, unknown>>(req);

    const data: Record<string, unknown> = {};
    if (has(body, "kind")) data.kind = str(body.kind) ?? "Wooden Crate";
    for (const k of ["grossKg", "netKg", "lengthCm", "widthCm", "heightCm"]) if (has(body, k)) data[k] = num(body[k]);
    if (has(body, "remarks")) data.remarks = str(body.remarks);
    if (has(body, "crateNo")) {
      const n = int(body.crateNo);
      if (n === null || n < 1) fail(400, "A crate number starts at 1");
      if (list.crates.some((c) => c.id !== crateId && Number(c.crateNo) === n)) fail(409, `Crate ${n} is already on ${list.number}`);
      data.crateNo = n;
    }
    if (!Object.keys(data).length) return json(plain(crate));

    const updated = await db.commercialCrate.update({ where: { id: crateId }, data });
    await syncPackages(list);
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: crate ${updated.crateNo} updated`,
      by: g.user,
      payload: { packingListId: plId, crateId, fields: Object.keys(data) },
    });
    return json(plain(updated));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, crateId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "crateId");
    const list = await loadList(plId);
    requireEditable(list);
    const crate = list.crates.find((c) => c.id === crateId);
    if (!crate) fail(404, "Crate not found on this list");
    const freed = await db.commercialPackedSlab.updateMany({ where: { packingListId: plId, crateId }, data: { crateId: null } });
    await db.commercialCrate.delete({ where: { id: crateId } });
    await syncPackages(list);
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: crate ${crate.crateNo} removed${freed.count ? `, ${freed.count} slab(s) unassigned` : ""}`,
      by: g.user,
      payload: { packingListId: plId, crateId, crateNo: crate.crateNo, unassigned: freed.count },
    });
    return json(plain(await loadList(plId)));
  });
}
