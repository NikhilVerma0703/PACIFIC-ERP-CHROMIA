// GET /api/office/commercial/dashboard — the overview's figures.
import { prisma } from "@/lib/prisma";
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export async function GET() {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + 48 * 3600 * 1000);
    const [openEnquiries, orderGroups, activeHolds, expiring, queued, inProduction, submitted, recent] = await Promise.all([
      db.commercialEnquiry.count({ where: { status: { in: ["NEW", "QUOTED"] } } }),
      db.commercialOrder.groupBy({ by: ["status"], _count: { _all: true } }),
      db.commercialStockHold.count({ where: { status: "ACTIVE" } }),
      db.commercialStockHold.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: soon } },
        orderBy: { expiresAt: "asc" }, take: 20,
        select: { id: true, reference: true, customer: true, expiresAt: true, orderId: true, _count: { select: { slabs: true } } },
      }),
      db.commercialProductionRequest.count({ where: { status: { in: ["QUEUED", "SCHEDULED"] } } }),
      db.commercialProductionRequest.count({ where: { status: "IN_PRODUCTION" } }),
      db.commercialPackingList.count({ where: { status: "SUBMITTED" } }),
      db.commercialOrderEvent.findMany({ orderBy: { at: "desc" }, take: 12, include: { order: { select: { number: true } } } }),
    ]);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const g of orderGroups as Array<{ status: string; _count: { _all: number } }>) { byStatus[g.status] = g._count._all; total += g._count._all; }
    return json(plain({
      enquiries: { open: openEnquiries },
      orders: { byStatus, total },
      holds: { active: activeHolds, expiringSoon: (expiring as Array<Record<string, unknown>>).map((h) => ({ id: h.id, reference: h.reference, customer: h.customer, expiresAt: h.expiresAt, orderId: h.orderId, slabs: (h._count as { slabs: number }).slabs })) },
      queue: { queued, inProduction },
      packing: { submitted },
      recent: (recent as Array<Record<string, unknown>>).map((e) => ({ id: e.id, orderId: e.orderId, orderNumber: (e.order as { number: string }).number, kind: e.kind, note: e.note, byName: e.byName, at: e.at })),
    }));
  });
}
