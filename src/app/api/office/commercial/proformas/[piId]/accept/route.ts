// POST /api/office/commercial/proformas/[piId]/accept — the customer has
// accepted the issued PI: ACCEPTED, acceptedAt stamped, event "pi_accepted".
// The order is not moved: acceptance is evidence, not a stage. The money the
// PI asks for is a receipt on the order (answer 29), recorded separately.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { canAccept } from "@/lib/commercial/proforma-rules";
import { db, loadProforma, snapshotOf, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    if (!canAccept(pi.status)) fail(400, `Only an issued PI can be accepted (this PI is ${pi.status.toLowerCase()})`);

    const body = await readBody<Record<string, unknown>>(req);
    const note = str(body.note);
    const snapshot = snapshotOf(pi);
    const now = new Date();

    await db.commercialProforma.update({ where: { id: piId }, data: { status: "ACCEPTED", acceptedAt: now } });
    await logOrderEvent(pi.orderId, "pi_accepted", {
      note: note ?? `Proforma ${pi.number} accepted by the customer`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, total: snapshot.totalAmount, currency: snapshot.currency },
    });

    return json(plain(await loadProforma(piId)));
  });
}
