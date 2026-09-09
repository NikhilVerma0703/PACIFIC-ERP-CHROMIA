// GET /api/office/commercial/dashboard — the overview's figures.
//
// EVERY FIGURE IS AREA-GATED, and the query behind a figure this login does not
// reach is not run at all (round two: the overview builds itself from
// commercialAreasFor(user), never from the role string). Raghav has no
// enquiries area, so he is neither shown an enquiry count nor sent one — a tile
// hidden in the client while the number travels to the browser is a hidden
// tile, not a refused one.
//
// A key the login does not reach is ABSENT rather than zero: the screen can
// then tell "you may not see this" from "there are none of these", and a zero
// invented here would be indistinguishable from a real one.
import { prisma } from "@/lib/prisma";
import { commercialGate } from "@/lib/commercial/access";
import { commercialAreasFor, type CommercialArea } from "@/lib/commercial/access-rules";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { advanceStatus, effectiveAdvancePct } from "@/lib/commercial/receipts-rules";
import { orderTotals, type ItemLike } from "@/lib/commercial/orders-rules";
import { advanceRatesFor } from "@/lib/commercial/advance-rate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/**
 * "Waiting for an advance" — the SAME arithmetic dispatch refuses with.
 *
 * Round one counted `receipts: { none: { kind: "ADVANCE" } }`: one rupee of
 * advance on a hundred-lakh order cleared the tile while the truck still
 * stood, and a waived order (answer 12) was counted forever because a waiver
 * writes no receipt. Round two, answer 11 made the gate a FIGURE — the share
 * of the order total the PI asked for, in the order's own currency — and
 * answer 12 let the manager waive it. This tile now asks advanceStatus the
 * question rather than restating a rule that has moved twice; the shape of the
 * query mirrors lib/commercial/order-stage.ts's loadStageFacts for that reason.
 *
 * NO SINGLE-QUERY FORM EXISTS: the required amount is a percentage (the
 * order's own, else the settings default for its kind) of Σ of the line
 * amounts — there is no total column — compared against the ADVANCE receipts
 * that are in the ORDER's currency. That is three tables and a currency test,
 * so the candidates are loaded and filtered in code.
 *
 * Waived orders are excluded IN THE QUERY: answer 12 settles them outright, so
 * they are not candidates at all and there is no reason to carry them here.
 */
const ADVANCE_SCAN_CAP = 500;

async function countAwaitingAdvance(): Promise<number> {
  const settings = await loadSettings();
  const orders = await db.commercialOrder.findMany({
    where: { status: { in: ["READY", "INVOICED"] }, advanceWaivedAt: null },
    // Newest first, capped: this is a headline count on an overview, not a
    // report. Two statuses out of eleven with the waived ones removed is a
    // small set today; the cap is what stops the tile turning into a table
    // scan the day it is not.
    orderBy: { createdAt: "desc" },
    take: ADVANCE_SCAN_CAP,
    select: {
      // id, because the rate is read per order below. Without it every order
      // asked for the rate of "" and was measured as though none existed.
      id: true, kind: true, currency: true, advancePct: true,
      items: { select: { amount: true } },
      receipts: { where: { kind: "ADVANCE" }, select: { kind: true, amount: true, currency: true } },
    },
  });
  // ONE query for every rate, not one per order: this loop runs over up to
  // ADVANCE_SCAN_CAP orders and it is drawing a single number on an overview.
  const rates = await advanceRatesFor((orders as Array<Record<string, unknown>>).map(o => String(o.id ?? "")));
  let waiting = 0;
  for (const o of orders as Array<Record<string, unknown>>) {
    const a = advanceStatus({
      receipts: o.receipts as Array<{ kind: string; amount: unknown; currency: string }>,
      orderTotal: orderTotals(o.items as ItemLike[]).amount,
      currency: String(o.currency ?? ""),
      advancePct: effectiveAdvancePct(o.advancePct, String(o.kind ?? ""), {
        domestic: settings.dispatch.advancePctDomestic,
        export: settings.dispatch.advancePctExport,
      }),
      // Round three, answer 10: the same rate the gate uses, so the tile and
      // the truck cannot disagree about whether an order is still waiting.
      rate: rates.get(String(o.id ?? "")) ?? null,
      // Every waived order was filtered out above; saying so here keeps the
      // call honest rather than relying on the reader to remember the where.
      waived: false,
    });
    if (!a.satisfied) waiting++;
  }
  return waiting;
}

export async function GET() {
  const g = await commercialGate("view", "overview");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const areas = commercialAreasFor(g.user);
    const reach = (a: CommercialArea) => areas[a] !== "none";
    const writes = (a: CommercialArea) => areas[a] === "write";

    const now = new Date();
    const soon = new Date(now.getTime() + 48 * 3600 * 1000);
    const seeEnquiries = reach("enquiries");
    const seeOrders = reach("orders");
    const seeStock = reach("stock");
    const seePlanning = reach("planning");
    const seePacking = reach("packing") || reach("dispatchCheck");
    // Answer 13: a reduction of a planned figure is written as an OPEN plan
    // change until somebody adds it back or removes it. Answer 16 then made the
    // planner the admin's alone, so the tile that leads to it is the admin's
    // too — nobody else can act on what it counts.
    const seeNotScheduled = writes("planning");
    // Answer 2: the truck does not leave before the advance, and answer 12 lets
    // the manager waive it. THE TILE GOES TO WHOEVER CAN CLEAR IT, and there
    // are two ways to, not one:
    //   record the ADVANCE receipt — POST orders/[id]/receipts gates on
    //     commercialGate("write", "orders"), so `writes("orders")` is exactly
    //     the set that can do it: the admin, Santosh, Setumani, Murali and the
    //     legacy login;
    //   waive it with a reason — `cancel`, the manager and the admin.
    // Narrowing this to `cancel` alone would take the tile off the three desks
    // that clear most of these by typing the receipt in, and would leave it
    // showing to nobody who is not already the manager. The one desk it must
    // NOT reach is Raghav (orders: view), who can do neither — and the union
    // below already excludes him. The tile's own copy narrows again: the
    // waiver sentence is rendered only for `cancel`.
    const seeAdvance = writes("orders") || g.actions.includes("cancel");

    const [openEnquiries, orderGroups, activeHolds, expiring, queued, inProduction, submitted, recent, notScheduled, awaitingAdvance] = await Promise.all([
      seeEnquiries ? db.commercialEnquiry.count({ where: { status: { in: ["NEW", "QUOTED"] } } }) : null,
      seeOrders ? db.commercialOrder.groupBy({ by: ["status"], _count: { _all: true } }) : null,
      seeStock ? db.commercialStockHold.count({ where: { status: "ACTIVE" } }) : null,
      seeStock ? db.commercialStockHold.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: soon } },
        orderBy: { expiresAt: "asc" }, take: 20,
        select: { id: true, reference: true, customer: true, expiresAt: true, orderId: true, _count: { select: { slabs: true } } },
      }) : null,
      seePlanning ? db.commercialProductionRequest.count({ where: { status: { in: ["QUEUED", "SCHEDULED"] } } }) : null,
      seePlanning ? db.commercialProductionRequest.count({ where: { status: "IN_PRODUCTION" } }) : null,
      seePacking ? db.commercialPackingList.count({ where: { status: "SUBMITTED" } }) : null,
      seeOrders ? db.commercialOrderEvent.findMany({ orderBy: { at: "desc" }, take: 12, include: { order: { select: { number: true } } } }) : null,
      seeNotScheduled ? db.commercialProductionPlanChange.count({ where: { status: "OPEN" } }) : null,
      seeAdvance ? countAwaitingAdvance() : null,
    ]);

    const out: Record<string, unknown> = {};
    if (seeEnquiries) out.enquiries = { open: openEnquiries };
    if (seeOrders) {
      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const row of (orderGroups ?? []) as Array<{ status: string; _count: { _all: number } }>) { byStatus[row.status] = row._count._all; total += row._count._all; }
      out.orders = { byStatus, total };
      out.recent = (recent as Array<Record<string, unknown>>).map((e) => ({ id: e.id, orderId: e.orderId, orderNumber: (e.order as { number: string }).number, kind: e.kind, note: e.note, byName: e.byName, at: e.at }));
    }
    if (seeStock) {
      out.holds = {
        active: activeHolds,
        expiringSoon: (expiring as Array<Record<string, unknown>>).map((h) => ({ id: h.id, reference: h.reference, customer: h.customer, expiresAt: h.expiresAt, orderId: h.orderId, slabs: (h._count as { slabs: number }).slabs })),
      };
    }
    if (seePlanning || seeNotScheduled) {
      out.queue = {
        ...(seePlanning ? { queued, inProduction } : {}),
        ...(seeNotScheduled ? { notScheduled } : {}),
      };
    }
    if (seePacking) out.packing = { submitted };
    if (seeAdvance) out.receipts = { awaitingAdvance };
    return json(plain(out));
  });
}
