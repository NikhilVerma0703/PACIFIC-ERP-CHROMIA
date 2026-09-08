// POST /api/office/commercial/proformas/[piId]/issue — the draft becomes the
// live proforma: ISSUED, stamped, valid for settings.piValidityDays from today
// (or for ever when that is 0 — answer 24 — in which case validUntil is null
// on the row and in the snapshot and the PDF prints no validity line).
//
// Gated on the stock check (answer 1): the order must carry stockCheckedAt
// and a hold that is still ACTIVE, asked of stages.canEnter through
// piIssueRefusal; a refusal is a 409 carrying canEnter's own words.
//
// The bank block and the GSTIN are re-frozen from Settings HERE (refreezeAtIssue):
// the clerk's keys stand, the details behind them are read at the moment the
// paper goes out, not at the moment the draft was built.
//
// Every OTHER live PI of the same order is CANCELLED as "Revised as <this
// number>" (answer 24: the old one is discarded), so the customer holds
// exactly one live PI — and it happens in ONE transaction with this PI going
// ISSUED, because a failure between the two writes would leave two live PIs
// (or, the other way round, none). /revise does not cancel anything; this is
// where the old paper retires. A draft that retires a live PI without naming
// it (built directly, not via /revise) is linked to what it retired. Events
// (pi_revised, pi_issued) and the stage bump follow the commit.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, dateOnly } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import {
  refuseIssue, piIssueRefusal, revisedByIssue, revisionReason, validUntilFor, refreezeAtIssue, revisesAtIssue,
} from "@/lib/commercial/proforma-rules";
import { db, loadProforma, snapshotOf, orderProformas, issueFactsOf, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "proforma");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    const snapshot = snapshotOf(pi);
    const refusal = refuseIssue({ status: pi.status, snapshot });
    if (refusal) fail(400, refusal);
    const gate = piIssueRefusal(await issueFactsOf(pi.orderId));
    if (gate) fail(409, gate);

    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();
    const now = new Date();
    const validUntil = validUntilFor(now, settings.piValidityDays);

    const siblings = await orderProformas(pi.orderId);
    const toRetire = revisedByIssue(siblings, { id: pi.id, orderId: pi.orderId });
    const retired = siblings.filter((s) => toRetire.includes(s.id)).map((s) => ({ id: s.id, number: s.number }));

    const next = {
      ...refreezeAtIssue(snapshot, settings),
      validUntil,
      revises: revisesAtIssue(snapshot.revises, retired),
    };

    // One transaction: the new paper ISSUED and the old paper CANCELLED land
    // together or not at all. Only the update and the updateMany are inside;
    // the events and the stage bump are consequences of a commit, not part of it.
    const writes = [
      db.commercialProforma.update({
        where: { id: piId },
        data: {
          status: "ISSUED",
          issuedAt: now,
          validUntil: validUntil ? dateOnly(validUntil) : null,
          snapshot: next,
          currency: next.currency,
          totalAmount: next.totalAmount,
        },
      }),
    ];
    if (toRetire.length) {
      writes.push(db.commercialProforma.updateMany({
        where: { id: { in: toRetire }, status: { in: ["ISSUED", "ACCEPTED"] } },
        data: { status: "CANCELLED", cancelledAt: now, cancelReason: revisionReason(pi.number), replacedById: piId },
      }));
    }
    await db.$transaction(writes);

    if (retired.length) {
      await logOrderEvent(pi.orderId, "pi_revised", {
        note: `${retired.map((r) => r.number).join(", ")} revised as ${pi.number}`,
        by: g.user,
        payload: { proformaId: piId, number: pi.number, revised: retired },
      });
    }
    await logOrderEvent(pi.orderId, "pi_issued", {
      note: (typeof body.note === "string" && body.note.trim())
        ? body.note.trim()
        : `Proforma ${pi.number} issued — ${next.currency} ${next.totalAmount.toFixed(3)}${validUntil ? `, valid until ${validUntil}` : ""}`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, total: next.totalAmount, currency: next.currency, validUntil, bankKey: next.bankKey, gstinKey: next.gstinKey, revises: next.revises },
    });
    await bumpOrder(pi.orderId, "PI_ISSUED", g.user, `Proforma ${pi.number} issued`);

    return json(plain(await loadProforma(piId)));
  });
}
