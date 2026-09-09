// POST /api/office/commercial/packing-lists/[plId]/crates — add a crate
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num, int } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { nextCrateNo, CRATE_KINDS } from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, requireEditable, syncPackages } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    requireEditable(list);
    const body = await readBody<Record<string, unknown>>(req);
    const crateNo = int(body.crateNo) ?? nextCrateNo(list.crates);
    if (crateNo < 1) fail(400, "A crate number starts at 1");
    if (list.crates.some((c) => Number(c.crateNo) === crateNo)) fail(409, `Crate ${crateNo} is already on ${list.number}`);
    const crate = await db.commercialCrate.create({
      data: {
        packingListId: plId,
        crateNo,
        kind: str(body.kind) ?? CRATE_KINDS[0],
        grossKg: num(body.grossKg), netKg: num(body.netKg),
        lengthCm: num(body.lengthCm), widthCm: num(body.widthCm), heightCm: num(body.heightCm),
        remarks: str(body.remarks),
      },
    });
    await syncPackages(list);
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: crate ${crateNo} (${crate.kind}) added`,
      by: g.user,
      payload: { packingListId: plId, crateId: crate.id, crateNo },
    });
    return json(plain(crate), 201);
  });
}
