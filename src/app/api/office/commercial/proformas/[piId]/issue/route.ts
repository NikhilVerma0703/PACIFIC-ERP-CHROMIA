// POST /api/office/commercial/proformas/[piId]/issue — the draft becomes the
// live proforma: ISSUED, stamped, valid for settings.piValidityDays from today,
// and every OTHER issued or accepted revision of the same number is marked
// SUPERSEDED so the customer holds exactly one live PI. Bumps the order to
// PI_ISSUED and logs "pi_issued".
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, dateOnly } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { refuseIssue, supersededIds, validUntilFor, piLabel } from "@/lib/commercial/proforma-rules";
import { db, loadProforma, snapshotOf, siblingRevisions, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    const snapshot = snapshotOf(pi);
    const refusal = refuseIssue({ status: pi.status, snapshot });
    if (refusal) fail(400, refusal);

    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();
    const now = new Date();
    const validUntil = validUntilFor(now, settings.piValidityDays);
    const next = { ...snapshot, validUntil };

    const siblings = await siblingRevisions(pi.number);
    const toSupersede = supersededIds(siblings, { id: pi.id, number: pi.number });

    await db.commercialProforma.update({
      where: { id: piId },
      data: {
        status: "ISSUED",
        issuedAt: now,
        validUntil: dateOnly(validUntil),
        snapshot: next,
        currency: next.currency,
        totalAmount: next.totalAmount,
      },
    });
    if (toSupersede.length) {
      await db.commercialProforma.updateMany({
        where: { id: { in: toSupersede } },
        data: { status: "SUPERSEDED", supersededAt: now },
      });
      await logOrderEvent(pi.orderId, "pi_superseded", {
        note: `${toSupersede.length} earlier revision(s) of ${pi.number} superseded by ${piLabel(pi.number, pi.revision)}`,
        by: g.user,
        payload: { proformaId: piId, number: pi.number, revision: pi.revision, superseded: toSupersede },
      });
    }

    await logOrderEvent(pi.orderId, "pi_issued", {
      note: (typeof body.note === "string" && body.note.trim())
        ? body.note.trim()
        : `Proforma ${piLabel(pi.number, pi.revision)} issued — ${next.currency} ${next.totalAmount.toFixed(3)}, valid until ${validUntil}`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, revision: pi.revision, total: next.totalAmount, currency: next.currency, validUntil },
    });
    await bumpOrder(pi.orderId, "PI_ISSUED", g.user, `Proforma ${piLabel(pi.number, pi.revision)} issued`);

    return json(plain(await loadProforma(piId)));
  });
}
