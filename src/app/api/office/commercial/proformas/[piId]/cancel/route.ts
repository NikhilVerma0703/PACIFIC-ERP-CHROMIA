// POST /api/office/commercial/proformas/[piId]/cancel — withdraw a PI by hand.
// Answer 24: "cancellation only by an admin or the Commercial Manager", so the
// gate is the "cancel" action, not "write". A cancelled PI keeps its snapshot
// (it may already be with the customer) and its number (never reused); the
// reason goes in cancelReason, the audit column, not in the notes a person
// types remarks into. The order is not moved, and a superseded or already-
// cancelled PI is refused.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { canCancel } from "@/lib/commercial/proforma-rules";
import { db, loadProforma, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("cancel");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    if (!canCancel(pi.status)) fail(400, `A ${pi.status.toLowerCase()} PI cannot be cancelled`);

    const body = await readBody<Record<string, unknown>>(req);
    const reason = str(body.reason);

    await db.commercialProforma.update({
      where: { id: piId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? "no reason given" },
    });
    await logOrderEvent(pi.orderId, "pi_cancelled", {
      note: `Proforma ${pi.number} cancelled${reason ? ` — ${reason}` : ""}`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, reason },
    });

    return json(plain(await loadProforma(piId)));
  });
}
