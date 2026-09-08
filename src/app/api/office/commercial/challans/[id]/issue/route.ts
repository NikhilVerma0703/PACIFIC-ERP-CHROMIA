// POST /api/office/commercial/challans/[id]/issue — a draft becomes real.
// Stamps issuedAt and, when the challan hangs off an order, logs it there.
// After this the challan is read-only; a mistake is cancelled, not edited.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { refuseChallanIssue } from "@/lib/commercial/challan-rules";
import { db, CHALLAN_INCLUDE, challanIdOf, loadChallan, itemsOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await challanIdOf(params);
    const row = await loadChallan(id);
    const refusal = refuseChallanIssue({ status: String(row.status), items: itemsOf(row) });
    if (refusal) fail(409, refusal);

    await db.commercialDeliveryChallan.update({ where: { id }, data: { status: "ISSUED", issuedAt: new Date() } });
    if (row.orderId) {
      await logOrderEvent(String(row.orderId), "challan_issued", {
        note: `Delivery challan ${row.number} issued to ${row.consigneeName}`,
        by: g.user,
        payload: { challanId: id, number: row.number, totalAmount: row.totalAmount },
      });
    }
    const after = await db.commercialDeliveryChallan.findUnique({ where: { id }, include: CHALLAN_INCLUDE });
    return json(plain(after));
  });
}
