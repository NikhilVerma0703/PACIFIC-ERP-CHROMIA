// GET  /api/office/commercial/orders/[id]/invoices — this order's invoices
// POST /api/office/commercial/orders/[id]/invoices — draft a DTA or export one
//
// Lines come from the packing list when one is named (its slabs grouped by
// design + thickness, priced from the matching order line) and from the order
// itself otherwise. Domestic tax is IGST whatever the buyer's state (answer
// 22, settings.tax.alwaysIgst) and the whole thing is frozen into a snapshot
// the PDF renders from — including which GSTIN and which bank it is issued
// under (answers 21, 23), both chosen here and editable while a draft.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num, dateOnly, paramId } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { issueNumber } from "@/lib/commercial/sequence";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  INVOICE_KINDS, defaultKindFor, sequenceKindFor, buildInvoiceLines, buildInvoiceSnapshot, sanitiseLine,
  isoDate, istIsoDate, unpricedWarning, pageArgs, refuseCreate, isBankKey, gstinChoiceFor,
  type InvoiceKind,
} from "@/lib/commercial/invoice-rules";
import type { DocLine } from "@/lib/commercial/types";
import { db, INVOICE_INCLUDE, rowPatchFor, livePiFor, marksForCrates, weightText, isUniqueViolation, designCodesLookup } from "../../../invoices/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const orderId = await paramId(params);
    const u = new URL(req.url);
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const where = { orderId };
    const [items, total] = await Promise.all([
      db.commercialInvoice.findMany({ where, include: INVOICE_INCLUDE, orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }], skip, take }),
      db.commercialInvoice.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const orderId = await paramId(params);
    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();

    const order = await db.commercialOrder.findUnique({
      where: { id: orderId },
      include: {
        client: { include: { commercialExt: true } },
        items: { orderBy: { lineNo: "asc" } },
        invoices: { select: { id: true, number: true, status: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) fail(404, "Order not found");

    // Answer 18: one PI has one invoice. A wrong one is cancelled with a
    // reason and raised again; it is never doubled up. This is the cheap early
    // refusal; the one that holds under concurrency is inside the transaction
    // below.
    const blocked = refuseCreate(order.invoices as Array<{ status: string; number: string | null }>);
    if (blocked) fail(409, blocked);

    const rawKind = str(body.kind)?.toUpperCase();
    const kind: InvoiceKind = rawKind ? (rawKind as InvoiceKind) : defaultKindFor(order.kind);
    if (!INVOICE_KINDS.includes(kind)) fail(400, "kind must be DTA or EXPORT");

    // The two dropdowns (answers 21, 23). A GSTIN that is not on the settings
    // list is refused here rather than printed on a tax document unvouched.
    const bankKeyRaw = str(body.bankKey);
    if (bankKeyRaw && !isBankKey(bankKeyRaw)) fail(400, "bankKey must be export or domestic");
    const gstinRaw = str(body.gstin);
    if (gstinRaw && !gstinChoiceFor(settings, gstinRaw)) fail(400, `GSTIN ${gstinRaw} is not one the company issues under — add it in Settings first`);

    // No date given → TODAY IN INDIA. The UTC day would date a document raised
    // before 05:30 IST to yesterday, and one raised in that window on 1 April
    // to 31 March — drawing its number from the previous FY's counter.
    const invoiceDate = dateOnly(body.invoiceDate) ?? dateOnly(istIsoDate())!;

    // the packing list, when this invoice covers one
    const packingListId = str(body.packingListId);
    let pl: Record<string, unknown> | null = null;
    if (packingListId) {
      pl = await db.commercialPackingList.findUnique({
        where: { id: packingListId },
        include: { slabs: { orderBy: { sortOrder: "asc" } }, crates: { orderBy: { crateNo: "asc" } } },
      });
      if (!pl) fail(400, "Packing list not found");
      if (pl.orderId !== orderId) fail(400, "That packing list belongs to another order");
    }
    const slabs = pl ? (pl.slabs as Array<Record<string, unknown>>) : null;
    const crates = pl ? (pl.crates as Array<Record<string, unknown>>) : [];

    // lines: what the caller sent, else the packing list's slabs, else the order.
    // The item code on every line is the design master's (answer 20).
    const codeFor = await designCodesLookup();
    const typedLines = Array.isArray(body.lines)
      ? (body.lines as unknown[]).map((l, i) => sanitiseLine(l, i)).filter((l): l is DocLine => l !== null)
      : null;
    const lines = typedLines && typedLines.length
      ? typedLines
      : buildInvoiceLines(order.items as never, slabs as never, kind, settings, codeFor);
    if (lines.length === 0) fail(400, "Nothing to invoice — the order has no line items");

    const pi = await livePiFor(orderId);
    const snapshot = buildInvoiceSnapshot(order as never, settings, kind, lines, {
      date: isoDate(invoiceDate),
      piNumber: pi?.number ?? order.number,
      piDate: pi?.date ?? null,
      exchangeRate: num(body.exchangeRate),
      vehicleNo: str(body.vehicleNo) ?? (pl ? (pl.vehicleNo as string | null) : null),
      transporter: str(body.transporter),
      containerNo: str(body.containerNo) ?? (pl ? (pl.containerNo as string | null) : null),
      sealNo: str(body.sealNo) ?? (pl ? (pl.sealNo as string | null) : null),
      linerOtlNo: str(body.linerOtlNo) ?? (pl ? (pl.linerOtlNo as string | null) : null),
      marksAndNos: str(body.marksAndNos) ?? marksForCrates(crates.length),
      packages: str(body.packages) ?? (pl ? (pl.packagesSummary as string | null) : null),
      grossWeight: str(body.grossWeight) ?? (pl ? weightText(pl.grossWeightKg) : null),
      netWeight: str(body.netWeight) ?? (pl ? weightText(pl.netWeightKg) : null),
      vessel: str(body.vessel),
      notes: str(body.notes),
      gstin: gstinRaw,
      bankKey: isBankKey(bankKeyRaw) ? bankKeyRaw : null,
    });

    // Answer 18, enforced where it counts. The probe above ran on a plain read
    // many awaits ago and nothing in the schema stops a second open invoice,
    // so two clerks drafting at once would both pass it. Inside one
    // transaction the order row is locked first (FOR UPDATE — without it, two
    // READ COMMITTED transactions would both see no open invoice and both
    // insert), the probe is re-run against committed state, and only then is
    // a number taken and the row written.
    const { created, issued } = await db.$transaction(async (tx: typeof db) => {
      await tx.$queryRaw`SELECT id FROM commercial_order WHERE id = ${orderId} FOR UPDATE`;
      const open = await tx.commercialInvoice.findFirst({
        where: { orderId, status: { not: "CANCELLED" } },
        orderBy: { createdAt: "asc" },
        select: { number: true, status: true },
      });
      const blockedNow = refuseCreate(open ? [open as { status: string; number: string | null }] : []);
      if (blockedNow) fail(409, blockedNow);

      const issued = await issueNumber(sequenceKindFor(kind), invoiceDate, body.numberOverride);
      snapshot.number = issued.number;
      const created: { id: string } = await tx.commercialInvoice.create({
        data: {
          orderId,
          packingListId: packingListId ?? null,
          kind,
          number: issued.number,
          invoiceDate,
          status: "DRAFT",
          currency: snapshot.currency,
          exchangeRate: snapshot.exchangeRate,
          vehicleNo: str(body.vehicleNo) ?? snapshot.vehicleNo,
          transporter: str(body.transporter),
          lrNo: str(body.lrNo),
          containerNo: snapshot.containerNo,
          sealNo: snapshot.sealNo,
          ewayBillNo: str(body.ewayBillNo),
          notes: str(body.notes),
          createdById: g.user?.id ?? null,
          ...rowPatchFor(snapshot),
        },
        select: { id: true },
      }).catch((e: unknown) => {
        if (isUniqueViolation(e)) fail(409, `Invoice number ${snapshot.number} already exists`);
        throw e;
      });
      return { created, issued };
    });

    // A packing-list line whose design the order does not carry finds no rate
    // and would be billed at zero. Say so in the log as well as on the screen.
    const unpriced = unpricedWarning(snapshot.lines);

    await logOrderEvent(orderId, "invoice_created", {
      note: `${kind} invoice ${issued.number} drafted${issued.overridden ? " (number typed by hand)" : ""}${pl ? ` from packing list ${pl.number}` : ""}${unpriced ? ` — ${unpriced}` : ""}`,
      by: g.user,
      payload: {
        invoiceId: created.id, kind, number: issued.number, packingListId, lines: lines.length,
        grandTotal: snapshot.grandTotal, overridden: issued.overridden, unpriced,
        gstin: snapshot.gstin, bankKey: snapshot.bankKey,
      },
    });

    const row = await db.commercialInvoice.findUnique({ where: { id: created.id }, include: INVOICE_INCLUDE });
    return json(plain(row), 201);
  });
}
