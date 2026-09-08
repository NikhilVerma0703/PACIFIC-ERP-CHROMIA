// GET   /api/office/commercial/packing-lists/[plId] — the whole list
// PATCH /api/office/commercial/packing-lists/[plId] — the stuffing header
//
// Container, seal, liner OTL, vehicle and the weights are known when the
// container is stuffed, which is AFTER the dispatch check — so unlike crates
// and slabs, the header stays editable until the slabs have left the yard.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { packagesSummary, canSetUnit, PACKING_STATUS_LABEL, type PackingStatus } from "@/lib/commercial/packing-rules";
import { parseMeasurementUnit } from "@/lib/commercial/measure";
import { db, loadList, paramPl, requireHeaderEditable } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

const TEXT_FIELDS = ["containerNo", "sealNo", "linerOtlNo", "vehicleNo", "packagesSummary", "notes"] as const;
const NUM_FIELDS = ["grossWeightKg", "netWeightKg"] as const;

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => json(plain(await loadList(await paramPl(params)))));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    requireHeaderEditable(list);
    const body = await readBody<Record<string, unknown>>(req);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

    const data: Record<string, unknown> = {};
    for (const k of TEXT_FIELDS) if (has(k)) data[k] = str(body[k]);
    for (const k of NUM_FIELDS) if (has(k)) data[k] = num(body[k]);

    // A blanked summary is refilled from the crates rather than left empty:
    // the invoice's Packages column reads it, and nobody should have to count
    // crates by hand to fill a column the crates already answer.
    if (has("packagesSummary") && !data.packagesSummary) data.packagesSummary = packagesSummary(list.crates);

    // The unit (answer 17) is not a header field: it changes what every size
    // on the sheet reads, so it is closed the moment the dispatch team has the
    // list, while the container number stays open.
    if (has("measurementUnit")) {
      const unit = parseMeasurementUnit(body.measurementUnit);
      if (!unit) fail(400, "The unit is cm or in");
      if (!canSetUnit(list.status)) {
        fail(409, `${list.number} is ${PACKING_STATUS_LABEL[list.status as PackingStatus]?.toLowerCase() ?? list.status} — the unit can only be switched while the list is with Commercial`);
      }
      if (unit !== list.measurementUnit) data.measurementUnit = unit;
    }

    if (!Object.keys(data).length) return json(plain(list));
    await db.commercialPackingList.update({ where: { id: plId }, data });
    await logOrderEvent(list.orderId, "edited", {
      note: `Packing list ${list.number} header updated (${Object.keys(data).join(", ")})`,
      by: g.user,
      payload: { packingListId: plId, fields: Object.keys(data) },
    });
    return json(plain(await loadList(plId)));
  });
}
