// POST /api/office/commercial/proformas/[piId]/cancel — withdraw a PI by hand.
// Answer 24: "cancellation only by an admin or the Commercial Manager", so the
// gate is the "cancel" action, not "write". A cancelled PI keeps its snapshot
// (it may already be with the customer) and its number (never reused); the
// reason goes in cancelReason, the audit column, not in the notes a person
// types remarks into. The order is not moved, and a superseded or already-
// cancelled PI is refused.
//
// Round two, answer 8: the reason is REQUIRED — a blank one is a 400, not a
// row that reads "no reason given" — because the register keeps the number,
// struck through, and prints this reason beside it for ever.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { refuseCancel } from "@/lib/commercial/proforma-rules";
import { db, loadProforma, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("cancel", "proforma");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);

    const body = await readBody<Record<string, unknown>>(req);
    const reason = str(body.reason) ?? "";
    const refusal = refuseCancel({ status: pi.status }, reason);
    if (refusal) fail(400, refusal);

    await db.commercialProforma.update({
      where: { id: piId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    await logOrderEvent(pi.orderId, "pi_cancelled", {
      note: `Proforma ${pi.number} cancelled — ${reason}`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, reason },
    });

    return json(plain(await loadProforma(piId)));
  });
}
