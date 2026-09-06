// GET  /api/office/commercial/orders/[id]/proformas — this order's revisions, paged
// POST /api/office/commercial/orders/[id]/proformas — a DRAFT revision, built
//      from the order as it stands now plus the module settings (DESIGN.md §6).
//
// The number is the ORDER's number: a PI is not separately numbered (the
// reference PI is SAL-ORD/25-26/01404, which is the internal sales order). The
// revision is max(existing) + 1, 0 for the first, and the snapshot is frozen
// here — nothing downstream recomputes an amount.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, paramId } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  buildProformaSnapshot, nextRevision, isoDate, piLabel, pageArgs,
  type SnapshotOrderInput,
} from "@/lib/commercial/proforma-rules";
import { db, loadOrderForPi, siblingRevisions, PI_LIST_SELECT } from "../../../proformas/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const u = new URL(req.url);
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const where = { orderId: id };
    const [items, total] = await Promise.all([
      db.commercialProforma.findMany({ where, select: PI_LIST_SELECT, orderBy: [{ number: "asc" }, { revision: "desc" }], skip, take: limit }),
      db.commercialProforma.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const body = await readBody<Record<string, unknown>>(req);
    const order = await loadOrderForPi(id);
    const settings = await loadSettings();

    const number = String(order.number ?? "");
    if (!number) fail(400, "This order has no number yet");
    const existing = await siblingRevisions(number);
    const revision = nextRevision(existing);

    const date = str(body.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, "date must be YYYY-MM-DD");
    const validUntil = str(body.validUntil);
    if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) fail(400, "validUntil must be YYYY-MM-DD");
    const deliveryDate = str(body.deliveryDate);
    if (deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) fail(400, "deliveryDate must be YYYY-MM-DD");

    const snapshot = buildProformaSnapshot(order as unknown as SnapshotOrderInput, settings, {
      revision,
      date: date ?? isoDate(new Date()),
      validUntil,
      deliveryDate,
      notes: str(body.notes),
    });

    const by = actorStamp(g.user);
    let row;
    try {
      row = await db.commercialProforma.create({
        data: {
          orderId: id,
          number,
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
      if ((e as { code?: string }).code === "P2002") fail(409, `Revision ${revision} of ${number} already exists — reload the tab`);
      throw e;
    }

    await logOrderEvent(id, "note", {
      note: `Proforma ${piLabel(number, revision)} drafted (${snapshot.currency} ${snapshot.totalAmount.toFixed(3)})`,
      by: g.user,
      payload: { proformaId: row.id, number, revision, total: snapshot.totalAmount, currency: snapshot.currency },
    });

    return json(plain(row), 201);
  });
}
