// GET  /api/office/commercial/orders — the order book, filtered and paged
// POST /api/office/commercial/orders — a new internal sales order
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, int } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { issueNumber } from "@/lib/commercial/sequence";
import { logOrderEvent } from "@/lib/commercial/events";
import { prefillChecklist } from "@/lib/commercial/checklist";
import { canonThickness } from "@/lib/thickness";
import {
  ORDER_KINDS, defaultsForKind, clientDefaults, partiesFromClient, itemAmount, checklistSourceFromOrder, ordersWhere, pageArgs,
  type OrderKind,
} from "@/lib/commercial/orders-rules";
import { db, headerPatchFromBody, loadClient, loadOrderDetail, isUniqueViolation } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "orders");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const filter = { status: u.searchParams.get("status"), kind: u.searchParams.get("kind"), clientId: u.searchParams.get("clientId"), q: u.searchParams.get("q") };
    const where = ordersWhere(filter);
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    // Stage counts ignore the status filter so the board shows every column
    // while the table shows the one clicked.
    const countWhere = ordersWhere({ ...filter, status: null });
    const [rows, total, groups] = await Promise.all([
      db.commercialOrder.findMany({
        where, orderBy: { createdAt: "desc" }, skip, take,
        select: {
          id: true, number: true, kind: true, status: true, clientId: true, customerPoNumber: true, customerPoDate: true, currency: true,
          incoterm: true, portOfDischarge: true, finalDestination: true, createdAt: true, updatedAt: true, createdByName: true,
          approvedAt: true, checkedAt: true,
          client: { select: { id: true, name: true, country: true } },
          _count: { select: { items: true, holds: true, proformas: true, packingLists: true, invoices: true } },
        },
      }),
      db.commercialOrder.count({ where }),
      db.commercialOrder.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = {};
    for (const x of groups as Array<{ status: string; _count: { _all: number } }>) counts[x.status] = x._count._all;
    const items = (rows as Array<Record<string, unknown>>).map((r) => {
      const c = r._count as Record<string, number>;
      const { _count, ...rest } = r; void _count;
      return { ...rest, itemsCount: c.items, holdsCount: c.holds, proformasCount: c.proformas, packingListsCount: c.packingLists, invoicesCount: c.invoices };
    });
    return json(plain({ items, total, page, limit, counts }));
  });
}

interface NewItemBody {
  design?: unknown; customerSku?: unknown; description?: unknown; thickness?: unknown; finish?: unknown; sizeLabel?: unknown; gradeLabel?: unknown;
  qtySlabs?: unknown; qty?: unknown; uom?: unknown; rate?: unknown; amount?: unknown; hsn?: unknown; isSample?: unknown; notes?: unknown;
}

export async function POST(req: Request) {
  const g = await commercialGate("write", "orders");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const kind = str(body.kind)?.toUpperCase() as OrderKind | undefined;
    if (!kind || !ORDER_KINDS.includes(kind)) fail(400, "kind must be DOMESTIC or EXPORT");
    const clientId = str(body.clientId);
    if (!clientId) fail(400, "Pick a client");
    const client = await loadClient(clientId);
    const ext = (client.commercialExt as Record<string, unknown> | null) ?? null;
    const settings = await loadSettings();

    // defaults: kind → client master → what the form sent
    const kd = defaultsForKind(kind, settings);
    const cd = clientDefaults(client as never, ext as never);
    const parties = partiesFromClient(client as never, ext as never);
    const typed = headerPatchFromBody(body);
    const { uom: defaultUom, hsn: defaultHsn, ...kindHeader } = kd;
    const header: Record<string, unknown> = { ...kindHeader, ...cd };
    for (const [k, v] of Object.entries(typed)) if (v !== null && v !== undefined) header[k] = v;
    // party blocks: the form's when given, else the client's
    if (!typed.billTo) header.billTo = parties.billTo;
    if (!typed.consignee) header.consignee = parties.consignee;
    if (!typed.notifyParty) header.notifyParty = parties.notifyParty;
    if (typed.buyerIfNotConsignee === undefined) header.buyerIfNotConsignee = null;
    // nullable text the caller explicitly blanked stays blank
    for (const [k, v] of Object.entries(typed)) if (v === null && k in header && k !== "currency" && k !== "countryOfOrigin") header[k] = null;
    delete header.enquiryId;

    // optional line items in the same call (an enquiry conversion, a form that carries lines)
    const rawItems = Array.isArray(body.items) ? (body.items as NewItemBody[]) : [];
    const items = rawItems.map((it, i) => {
      const qty = it.qty === undefined || it.qty === "" || it.qty === null ? null : Number(it.qty);
      const rate = it.rate === undefined || it.rate === "" || it.rate === null ? null : Number(it.rate);
      const thickness = canonThickness(it.thickness);
      return {
        lineNo: i + 1,
        design: str(it.design), customerSku: str(it.customerSku), description: str(it.description),
        thickness: thickness || null, finish: str(it.finish), sizeLabel: str(it.sizeLabel), gradeLabel: str(it.gradeLabel),
        qtySlabs: int(it.qtySlabs), qty: Number.isFinite(qty as number) ? qty : null, uom: str(it.uom) ?? defaultUom,
        rate: Number.isFinite(rate as number) ? rate : null, amount: itemAmount(qty, rate, it.amount),
        hsn: str(it.hsn) ?? defaultHsn, isSample: Boolean(it.isSample), notes: str(it.notes),
      };
    });

    const now = new Date();
    const issued = await issueNumber("order", now, body.numberOverride);
    const stamp = actorStamp(g.user);
    const checklist = prefillChecklist(null, checklistSourceFromOrder({ ...header, customerPoDate: header.customerPoDate ?? null }, items));
    let created: { id: string };
    try {
      created = await db.commercialOrder.create({
        data: {
          number: issued.number, kind, clientId,
          enquiryId: str(body.enquiryId),
          ...header,
          checklist,
          createdById: stamp.id, createdByName: stamp.name,
          items: items.length ? { create: items } : undefined,
        },
        select: { id: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `Order number ${issued.number} already exists`);
      throw e;
    }
    await logOrderEvent(created.id, "created", {
      note: `Order ${issued.number} created${issued.overridden ? " (number typed by hand)" : ""}`,
      by: g.user,
      payload: { number: issued.number, kind, clientId, overridden: issued.overridden, items: items.length },
    });
    return json(plain(await loadOrderDetail(created.id)), 201);
  });
}
