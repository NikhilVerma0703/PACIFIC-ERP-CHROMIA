// POST /api/office/commercial/packing-lists/[plId]/slabs — add slabs
//
// Body: { slabNumbers: number[] | "150903, 150904 150905-150910", fromHoldId? }.
// Slabs that may not be packed (cut-marked, held under someone else's PI,
// already on this list) come back in `skipped` with the reason, and the ones
// that could are added — a partial add is better than a refused one when a
// clerk has typed thirty numbers and one is wrong.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import { slabNumberList, nextSortOrder, type OrderItemLike } from "@/lib/commercial/packing-rules";
import { db, loadList, paramPl, requireEditable, intakeSlabs, isAdminOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    requireEditable(list);
    const body = await readBody<Record<string, unknown>>(req);

    const fromHoldId = str(body.fromHoldId);
    let slabNumbers: number[];
    if (fromHoldId) {
      const hold = (list.order.holds as Array<Record<string, unknown>>).find((h) => h.id === fromHoldId);
      if (!hold) fail(400, "That hold does not belong to this order");
      await reconcileHold(fromHoldId);
      const rows: Array<{ slabNumber: number; releasedAt: Date | null }> =
        await db.commercialStockHoldSlab.findMany({ where: { holdId: fromHoldId }, orderBy: { slabNumber: "asc" } });
      slabNumbers = rows.filter((s) => !s.releasedAt).map((s) => Number(s.slabNumber));
      if (!slabNumbers.length) fail(409, "That hold has no slabs still held");
    } else {
      slabNumbers = slabNumberList(body.slabNumbers);
      if (!slabNumbers.length) fail(400, "Name the slabs to add");
    }

    const intake = await intakeSlabs({
      slabNumbers,
      order: {
        number: list.order.number,
        items: list.order.items as OrderItemLike[],
        holds: list.order.holds as Array<{ reference?: string | null }>,
        enquiry: (list.order.enquiry as { number?: string | null } | null) ?? null,
      },
      already: list.slabs,
      startSortOrder: nextSortOrder(list.slabs),
      isAdmin: isAdminOf(g),
    });
    if (intake.rows.length) {
      await db.commercialPackedSlab.createMany({ data: intake.rows.map((r) => ({ ...r, packingListId: plId })) });
      await logOrderEvent(list.orderId, "edited", {
        note: `${list.number}: ${intake.rows.length} slab(s) added${intake.skipped.length ? `; ${intake.skipped.length} refused` : ""}`,
        by: g.user,
        payload: { packingListId: plId, added: intake.rows.length, skipped: intake.skipped },
      });
    }
    return json(plain({ list: await loadList(plId), added: intake.rows.length, skipped: intake.skipped }), intake.rows.length ? 201 : 200);
  });
}
