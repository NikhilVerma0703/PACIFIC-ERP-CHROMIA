// GET  /api/office/commercial/orders/[id]/packing-lists — this order's lists
// POST /api/office/commercial/orders/[id]/packing-lists — start a new one
//
// A list is started either from a hold ("pack what we reserved for this
// order") or from typed slab numbers. Both end in the same place: the
// inventory rows are read once, the ones that may not be packed are named
// rather than silently dropped, and the rest become commercial_packed_slab
// rows carrying our number, the customer's SKU from the matching order line,
// and centimetres from the stored inches.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId, str } from "@/lib/commercial/http";
import { issueNumber } from "@/lib/commercial/sequence";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { reconcileHold } from "@/lib/commercial/inventory-bridge";
import { slabNumberList, pageArgs, parsePackingStatus, canCreatePackingList, type OrderItemLike } from "@/lib/commercial/packing-rules";
import { parseMeasurementUnit } from "@/lib/commercial/measure";
import { db, loadList, intakeSlabs, isAdminOf } from "../../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const u = new URL(req.url);
    const status = parsePackingStatus(u.searchParams.get("status"));
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const where = { orderId: id, ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
      db.commercialPackingList.findMany({
        where, orderBy: { createdAt: "desc" }, skip, take,
        include: { crates: { orderBy: { crateNo: "asc" } }, slabs: { orderBy: { sortOrder: "asc" } } },
      }),
      db.commercialPackingList.count({ where }),
    ]);
    return json(plain({ items: rows, total, page, limit }));
  });
}

interface CreateBody {
  slabNumbers?: unknown;
  fromHoldId?: unknown;
  numberOverride?: unknown;
  notes?: unknown;
  measurementUnit?: unknown;
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const orderId = await paramId(params);
    const body = await readBody<CreateBody>(req);
    const order = await db.commercialOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { orderBy: { lineNo: "asc" } },
        enquiry: { select: { number: true } },
        holds: { include: { slabs: { orderBy: { slabNumber: "asc" } } }, orderBy: { placedAt: "desc" } },
        packingLists: { select: { number: true, status: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!order) fail(404, "Order not found");

    // One PI, one packing list (answer 18): a REJECTED list is reopened, not
    // replaced, and anything else already IS this order's list.
    const one = canCreatePackingList(order.packingLists as Array<{ number: string; status: string }>);
    if (!one.ok) fail(409, one.reason);

    // Where the slab numbers come from.
    const fromHoldId = str(body.fromHoldId);
    let slabNumbers: number[];
    if (fromHoldId) {
      const hold = (order.holds as Array<Record<string, unknown>>).find((h) => h.id === fromHoldId);
      if (!hold) fail(400, "That hold does not belong to this order");
      // Reconcile first: a hold whose five days lapsed yesterday must not offer
      // slabs the inventory has already handed back.
      await reconcileHold(fromHoldId);
      const slabs: Array<{ slabNumber: number; releasedAt: Date | null }> =
        await db.commercialStockHoldSlab.findMany({ where: { holdId: fromHoldId }, orderBy: { slabNumber: "asc" } });
      slabNumbers = slabs.filter((s) => !s.releasedAt).map((s) => Number(s.slabNumber));
      if (!slabNumbers.length) fail(409, "That hold has no slabs still held");
    } else {
      slabNumbers = slabNumberList(body.slabNumbers);
      if (!slabNumbers.length) fail(400, "Name the slabs to pack, or pick a hold");
    }

    const intake = await intakeSlabs({
      slabNumbers,
      order: {
        number: order.number as string,
        items: order.items as OrderItemLike[],
        holds: order.holds as Array<{ reference?: string | null }>,
        enquiry: order.enquiry as { number?: string | null } | null,
      },
      already: [],
      startSortOrder: 1,
      isAdmin: isAdminOf(g),
    });
    if (!intake.rows.length) {
      fail(409, `No slab could be packed: ${intake.skipped.map((s) => `#${s.slab} (${s.reason})`).join("; ") || "nothing to pack"}`);
    }

    const now = new Date();
    // The unit the sheets print in (answer 17) comes from Settings; the body
    // may name one, and anything that is not cm or in falls back rather than
    // being stored.
    const settings = await loadSettings();
    const measurementUnit = parseMeasurementUnit(body.measurementUnit) ?? parseMeasurementUnit(settings.measurementUnitDefault) ?? "cm";
    const issued = await issueNumber("packingList", now, body.numberOverride);
    const stamp = actorStamp(g.user);
    let created: { id: string };
    try {
      created = await db.commercialPackingList.create({
        data: {
          orderId,
          number: issued.number,
          status: "DRAFT",
          measurementUnit,
          notes: str(body.notes),
          createdById: stamp.id,
          createdByName: stamp.name,
          slabs: { create: intake.rows },
        },
        select: { id: true },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        fail(409, `Packing list number ${issued.number} already exists`);
      }
      throw e;
    }

    await logOrderEvent(orderId, "packing_created", {
      note: `Packing list ${issued.number} started — ${intake.rows.length} slab(s)${intake.skipped.length ? `; ${intake.skipped.length} refused` : ""}`,
      by: g.user,
      payload: { packingListId: created.id, number: issued.number, slabs: intake.rows.length, skipped: intake.skipped, fromHoldId: fromHoldId ?? null },
    });

    const list = await loadList(created.id);
    return json(plain({ list, skipped: intake.skipped }), 201);
  });
}
