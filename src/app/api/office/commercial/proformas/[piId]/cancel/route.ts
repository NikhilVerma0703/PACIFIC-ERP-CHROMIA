// POST /api/office/commercial/proformas/[piId]/cancel — withdraw a revision.
// A cancelled PI keeps its snapshot (it may already be with the customer) and
// its reason is written into the row's notes, which is the only place a PI has
// for one; the order is not moved, and a superseded or already-cancelled
// revision is refused.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { canCancel, piLabel } from "@/lib/commercial/proforma-rules";
import { db, loadProforma, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    if (!canCancel(pi.status)) fail(400, `A ${pi.status.toLowerCase()} revision cannot be cancelled`);

    const body = await readBody<Record<string, unknown>>(req);
    const reason = str(body.reason);
    const existing = str(pi.notes);
    const notes = [existing, `Cancelled: ${reason ?? "no reason given"}`].filter(Boolean).join("\n");

    await db.commercialProforma.update({ where: { id: piId }, data: { status: "CANCELLED", notes } });
    await logOrderEvent(pi.orderId, "note", {
      note: `Proforma ${piLabel(pi.number, pi.revision)} cancelled${reason ? ` — ${reason}` : ""}`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, revision: pi.revision, reason },
    });

    return json(plain(await loadProforma(piId)));
  });
}
