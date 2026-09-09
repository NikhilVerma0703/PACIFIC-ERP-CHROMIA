// GET  /api/office/commercial/challans — the challan book (?from=&to=&q=&status=&orderId=)
// POST /api/office/commercial/challans — a new delivery challan
//
// A challan is a movement, not a sale: samples, display stands, goods to the
// sister company. It can hang off an order or stand alone, and its consignee
// can be a client from the master or free text.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, dateOnly } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { issueNumber } from "@/lib/commercial/sequence";
import { logOrderEvent } from "@/lib/commercial/events";
import { challansWhere, pageArgs, CHALLAN_DEFAULT_PO_REF, CHALLAN_DEFAULT_COMMODITY } from "@/lib/commercial/challan-rules";
import { istIsoDate } from "@/lib/commercial/invoice-rules";
import { db, CHALLAN_INCLUDE, consigneeFromBody, itemsPatch, isUniqueViolation } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "challans");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const where = challansWhere({
      status: u.searchParams.get("status"),
      orderId: u.searchParams.get("orderId"),
      from: u.searchParams.get("from"),
      to: u.searchParams.get("to"),
      q: u.searchParams.get("q"),
    });
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    // The declared value must be the value OF THE ROWS COUNTED — see the same
    // note on the invoice register.
    const sumWhere = "status" in where ? where : { ...where, status: { not: "CANCELLED" } };
    const [items, total, sum] = await Promise.all([
      db.commercialDeliveryChallan.findMany({ where, include: CHALLAN_INCLUDE, orderBy: [{ challanDate: "desc" }, { createdAt: "desc" }], skip, take }),
      db.commercialDeliveryChallan.count({ where }),
      db.commercialDeliveryChallan.aggregate({ where: sumWhere, _sum: { totalAmount: true } }),
    ]);
    return json(plain({ items, total, page, limit, totalValue: sum?._sum?.totalAmount ?? 0 }));
  });
}

export async function POST(req: Request) {
  const g = await commercialGate("write", "challans");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();

    // No date given → TODAY IN INDIA. The UTC day dated a challan raised before
    // 05:30 IST to yesterday — and one raised in that window on 1 April to
    // 31 March, taking its number from the previous FY's counter.
    const challanDate = dateOnly(body.challanDate) ?? dateOnly(istIsoDate())!;
    const orderId = str(body.orderId);
    if (orderId) {
      const order = await db.commercialOrder.findUnique({ where: { id: orderId }, select: { id: true } });
      if (!order) fail(400, "Order not found");
    }
    const consignee = await consigneeFromBody(body);
    const totals = itemsPatch(body.items);
    if (totals.items.length === 0) fail(400, "Add at least one line to the challan");

    const issued = await issueNumber("challan", challanDate, body.numberOverride);
    let created: { id: string };
    try {
      created = await db.commercialDeliveryChallan.create({
        data: {
          number: issued.number,
          challanDate,
          orderId,
          ...consignee,
          poRef: str(body.poRef) ?? CHALLAN_DEFAULT_PO_REF,
          commodity: str(body.commodity) ?? CHALLAN_DEFAULT_COMMODITY,
          purpose: str(body.purpose) ?? settings.texts.challanNote,
          ...totals,
          lorryNo: str(body.lorryNo),
          notes: str(body.notes),
          status: "DRAFT",
          createdById: g.user?.id ?? null,
        },
        select: { id: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `Challan number ${issued.number} already exists`);
      throw e;
    }

    if (orderId) {
      await logOrderEvent(orderId, "challan_created", {
        note: `Delivery challan ${issued.number} drafted${issued.overridden ? " (number typed by hand)" : ""}`,
        by: g.user,
        payload: { challanId: created.id, number: issued.number, lines: totals.items.length, totalAmount: totals.totalAmount },
      });
    }
    const row = await db.commercialDeliveryChallan.findUnique({ where: { id: created.id }, include: CHALLAN_INCLUDE });
    return json(plain(row), 201);
  });
}
