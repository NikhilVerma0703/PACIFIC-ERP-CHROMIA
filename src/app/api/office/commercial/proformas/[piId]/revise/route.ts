// POST /api/office/commercial/proformas/[piId]/revise — start replacing an
// issued (or accepted) PI: a fresh DRAFT built from the order AS IT STANDS
// NOW, under a NEW number from the proforma counter, carrying
// `revises: { id, number }` of the PI it will replace (answer 24: "a revision
// gets a brand-new number and the old one is discarded"). Nothing is ever
// re-numbered and the old number is never reused.
//
// The old PI is NOT cancelled here. It stays ISSUED (or ACCEPTED) — the paper
// the customer holds — until the new draft is ISSUED, and the issue route
// cancels it ("Revised as <new number>", pi_revised) in the same transaction
// as the new one goes live. Cancelling on the spot left the order with no live
// PI between revise and issue, and with none at all when the draft was never
// issued. The draft goes through the ordinary issue route, stock gate and all.
//
// Two clerks revising the same PI: the second is refused (409) while a DRAFT
// that revises it already exists — otherwise two numbers leave the counter
// and two drafts race to retire one paper.
//
// The new draft inherits the shipping facts and the bank / GSTIN choices the
// clerk typed onto the old one (carriedIntoRevision); parties, lines and
// rates come from the order, which is the reason a revision is being made.
//
// Gate: write. Logged as pi_drafted naming what it revises; pi_revised is
// written when the old paper actually retires, at issue.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { issueNumber } from "@/lib/commercial/sequence";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  buildProformaSnapshot, applyDraftPatch, carriedIntoRevision, refuseRevise, nextRevision, isoDate,
  type SnapshotOrderInput,
} from "@/lib/commercial/proforma-rules";
import { db, loadProforma, loadOrderForPi, orderProformas, orderDrafts, snapshotOf, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const old = await loadProforma(piId);
    const refusal = refuseRevise({ id: old.id, status: old.status }, await orderDrafts(old.orderId));
    if (refusal) fail(409, refusal);
    const oldSnapshot = snapshotOf(old);

    const body = await readBody<Record<string, unknown>>(req);
    const reason = str(body.reason);
    const order = await loadOrderForPi(old.orderId);
    const settings = await loadSettings();
    const now = new Date();
    const revision = nextRevision(await orderProformas(old.orderId));
    // The counter is taken before the row exists: a draft that then fails to
    // save leaves a gap in the series, which is the honest outcome — a number
    // once handed out is never handed out again (answer 24).
    const issued = await issueNumber("proforma", now, body.numberOverride);

    const fresh = buildProformaSnapshot(order as unknown as SnapshotOrderInput, settings, {
      number: issued.number,
      revision,
      date: isoDate(now),
      validUntil: null,
      revises: { id: old.id, number: old.number },
    });
    const { snapshot } = applyDraftPatch(fresh, carriedIntoRevision(oldSnapshot), settings);

    const by = actorStamp(g.user);
    let row;
    try {
      row = await db.commercialProforma.create({
        data: {
          orderId: old.orderId,
          number: issued.number,
          revision,
          status: "DRAFT",
          snapshot,
          currency: snapshot.currency,
          totalAmount: snapshot.totalAmount,
          notes: snapshot.notes,
          createdById: by.id,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") fail(409, `A proforma numbered ${issued.number} already exists — check the counter in Settings`);
      throw e;
    }

    await logOrderEvent(old.orderId, "pi_drafted", {
      note: `Proforma ${issued.number} drafted to revise ${old.number}${reason ? ` — ${reason}` : ""}; ${old.number} stays live until ${issued.number} is issued`,
      by: g.user,
      payload: {
        proformaId: row.id, number: issued.number, revisesId: old.id, revisesNumber: old.number, reason,
        seq: issued.seq, overridden: issued.overridden, total: snapshot.totalAmount, currency: snapshot.currency,
      },
    });

    return json(plain(row), 201);
  });
}
