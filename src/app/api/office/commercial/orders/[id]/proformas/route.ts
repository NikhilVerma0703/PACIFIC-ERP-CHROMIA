// GET  /api/office/commercial/orders/[id]/proformas — this order's PIs, paged
// POST /api/office/commercial/orders/[id]/proformas — a DRAFT PI, built from
//      the order as it stands now plus the module settings (DESIGN.md §6, §8).
//
// The number is the PI's OWN, from the proforma counter (answers 5, 8, 24:
// SAL-ORD/{fy}/N{seq}, per financial year) — not the order's number, because
// a revision is a new number and an order keeps one number for life. The
// `revision` column is the order's PI ordinal (0 first) for the row's unique
// key and the tab's ordering; it is not part of the number. The snapshot is
// frozen here — nothing downstream recomputes an amount.
//
// The salesperson the PI is raised for (owner, 2026-09-15; scripts/0084) is
// read off the ORDER by buildProformaSnapshot and frozen with the rest, which
// is why it is not an option below: it is not the clerk's to choose per PI, and
// a printed PI must keep the name it carried when the order is reassigned. The
// draft's own copy is editable from the PI tab afterwards (EDITABLE_TEXT_FIELDS).
//
// `notes` is the Terms & Conditions box and is what the caller TYPED, never
// anything this route works out: no container size, no tonnage, no weight. A
// body without it leaves the box empty, which is a correct printed PI.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, paramId } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { issueNumber } from "@/lib/commercial/sequence";
import { proformaNumberingKind } from "@/lib/commercial/settings-defaults";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  buildProformaSnapshot, nextRevision, isoDate, pageArgs, parseBankKey,
  type SnapshotOrderInput,
} from "@/lib/commercial/proforma-rules";
import { db, loadOrderForPi, orderProformas, PI_LIST_SELECT } from "../../../proformas/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "proforma");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const u = new URL(req.url);
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const where = { orderId: id };
    const [items, total] = await Promise.all([
      db.commercialProforma.findMany({ where, select: PI_LIST_SELECT, orderBy: [{ revision: "desc" }], skip, take: limit }),
      db.commercialProforma.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "proforma");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const body = await readBody<Record<string, unknown>>(req);
    const order = await loadOrderForPi(id);
    const settings = await loadSettings();

    const date = str(body.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, "date must be YYYY-MM-DD");
    const deliveryDate = str(body.deliveryDate);
    if (deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) fail(400, "deliveryDate must be YYYY-MM-DD");

    const now = new Date();
    const revision = nextRevision(await orderProformas(id));
    // The counter is taken before the row exists: a draft that then fails to
    // save leaves a gap in the series, which is the honest outcome — a number
    // once handed out is never handed out again (answer 24).
    // WHOSE COUNTER, which follows from whose paper it is: a Monolith proforma
    // is a US company's own document and cannot take a number out of Pacific's
    // series, or each company's books carry gaps it cannot account for. The
    // seller lives on the ORDER, so the kind is read from there and an order
    // with no seller takes Pacific's, exactly as every other seller-aware rule
    // defaults.
    const issued = await issueNumber(
      proformaNumberingKind((order as { sellerKey?: unknown }).sellerKey),
      now, body.numberOverride,
    );

    const snapshot = buildProformaSnapshot(order as unknown as SnapshotOrderInput, settings, {
      number: issued.number,
      revision,
      date: date ?? isoDate(now),
      validUntil: null,
      deliveryDate,
      notes: str(body.notes),
      bankKey: parseBankKey(body.bankKey),
      gstinKey: str(body.gstinKey),
    });

    const by = actorStamp(g.user);
    let row;
    try {
      row = await db.commercialProforma.create({
        data: {
          orderId: id,
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

    await logOrderEvent(id, "pi_drafted", {
      note: `Proforma ${issued.number} drafted (${snapshot.currency} ${snapshot.totalAmount.toFixed(3)})`,
      by: g.user,
      payload: { proformaId: row.id, number: issued.number, seq: issued.seq, overridden: issued.overridden, total: snapshot.totalAmount, currency: snapshot.currency },
    });

    return json(plain(row), 201);
  });
}
