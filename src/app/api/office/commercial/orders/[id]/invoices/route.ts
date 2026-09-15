// GET  /api/office/commercial/orders/[id]/invoices — this order's invoices
// POST /api/office/commercial/orders/[id]/invoices — draft a DTA or export one
//
// Lines come from the packing list when one is named (its slabs grouped by
// design + thickness, priced from the matching order line) and from the order
// itself otherwise. Domestic tax is IGST whatever the buyer's state (answer
// 22, settings.tax.alwaysIgst) and the whole thing is frozen into a snapshot
// the PDF renders from — including which GSTIN and which bank it is issued
// under (answers 21, 23), both chosen here and editable while a draft.
//
// Round two: the bank INHERITS the live PI's (answer 20) and only the manager
// may move it off that; an alternate registration carries the answer to the
// one question the screen asked about the export workbook (answer 19).
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num, dateOnly, paramId } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { issueNumber } from "@/lib/commercial/sequence";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  INVOICE_KINDS, defaultKindFor, sequenceKindFor, refuseInvoiceForSeller, buildInvoiceLines, buildInvoiceSnapshot, sanitiseLine,
  isoDate, istIsoDate, unpricedWarning, pageArgs, refuseCreate, isBankKey, gstinChoiceFor,
  bankKeyForInvoice, mayChangeInvoiceBank, BANK_FOLLOWS_PI, gstinScopeWord,
  exchangeRateRefusal, exchangeRateNote,
  type InvoiceKind,
} from "@/lib/commercial/invoice-rules";
import { piOwnsBankKey, type PiSnapshot } from "@/lib/commercial/proforma-rules";
import type { DocLine } from "@/lib/commercial/types";
import { db, INVOICE_INCLUDE, rowPatchFor, livePiFor, marksForCrates, weightText, isUniqueViolation, designCodesLookup } from "../../../invoices/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view", "invoices");
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
  const g = await commercialGate("write", "invoices");
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

    // MAY THIS SELLER RAISE THIS KIND AT ALL (owner, 2026-09-15)? A DTA
    // invoice is an Indian domestic tax document, so a group company that is
    // not an Indian exporter has none to raise. Refused here, at draft time,
    // rather than branched inside the renderer: there is no hollowed-out
    // version of that sheet worth printing, and defaultKindFor reads only
    // order.kind, so without this a DOMESTIC order carrying a US seller became
    // an Indian tax invoice with nothing standing in the way. The message
    // names both exits and leaves the choice to a person — guessing which of
    // the two is wrong would put a real document out under the other.
    const sellerRefusal = refuseInvoiceForSeller(settings, (order as { sellerKey?: unknown }).sellerKey as string | null | undefined, kind);
    if (sellerRefusal) fail(409, sellerRefusal);

    // The two dropdowns (answers 21, 23). A GSTIN that is not on the settings
    // list is refused here rather than printed on a tax document unvouched.
    const bankKeyRaw = str(body.bankKey);
    if (bankKeyRaw && !isBankKey(bankKeyRaw)) fail(400, "bankKey must be export or domestic");
    const gstinRaw = str(body.gstin);
    if (gstinRaw && !gstinChoiceFor(settings, gstinRaw)) fail(400, `GSTIN ${gstinRaw} is not one the company issues under — add it in Settings first`);
    // Round two, answer 19: the one question an alternate registration asks.
    if (body.gstinApplyAll !== undefined && body.gstinApplyAll !== null && typeof body.gstinApplyAll !== "boolean") {
      fail(400, "gstinApplyAll must be true or false");
    }
    const gstinApplyAll = typeof body.gstinApplyAll === "boolean" ? body.gstinApplyAll : null;

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
    // Round two, answer 20: the invoice's bank follows the PI's, and moving it
    // off that is the Commercial Manager's or an admin's — the same `cancel`
    // action that cancels the PI itself. Below that level the field is sent
    // read-only by the screen; a body that names another bank anyway is
    // refused with the sentence the disabled select carries.
    const inheritedBankKey = bankKeyForInvoice(pi, kind);
    const bankKey = isBankKey(bankKeyRaw) ? bankKeyRaw : inheritedBankKey;
    if (bankKey !== inheritedBankKey && !mayChangeInvoiceBank(g.actions)) fail(403, BANK_FOLLOWS_PI);

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
      gstinApplyAll,
      bankKey,
    });

    // ROUND THREE, ANSWER 10 — the rate, and the DATE it was put on this row.
    //
    // Two things are settled here, both because the rate is load-bearing:
    // receipts-rules converts a foreign advance through it and a truck leaves
    // on the answer.
    //
    //   A rupee invoice carries no rate. The figure is rupees per one unit of
    //   the invoice's currency, so on an INR document it is rupees per rupee —
    //   it converts nothing (usableRate discards it) and would only sit on the
    //   screen contradicting the receipts card. A typed one is refused with the
    //   sentence the disabled box carries; the ORDER's rate, which
    //   buildInvoiceSnapshot inherits when the body names none, is dropped
    //   rather than copied in, and the log says so.
    //
    //   Every rate that IS written is stamped. Without this the inherited rate
    //   was the DEFAULT way to end up with an undated figure — exactly the
    //   state exchangeRateAt exists to prevent — and an undated rate converts
    //   all the same. The stamp is honest: it says when this rate was put on
    //   THIS invoice, which is now.
    const typedRate = num(body.exchangeRate);
    const rateRefusal = exchangeRateRefusal(snapshot.currency);
    if (typedRate !== null && rateRefusal) fail(400, rateRefusal);
    const inheritedRate = typedRate === null && snapshot.exchangeRate !== null ? snapshot.exchangeRate : null;
    const rateDropped = rateRefusal !== null && inheritedRate !== null;
    if (rateRefusal) snapshot.exchangeRate = null;      // the row and the frozen document agree
    const exchangeRate = snapshot.exchangeRate;
    const exchangeRateAt = exchangeRate === null ? null : new Date();

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

      // WHOSE SERIES, NOT JUST WHICH KIND. Until today a Monolith export order
      // drew from Pacific's exportInvoice counter and printed PESPL/N####: a
      // US company consuming a number out of the Indian company's run, which
      // nothing refused because commercial_invoice.number is unique globally
      // rather than per-entity.
      const issued = await issueNumber(sequenceKindFor(kind, (order as { sellerKey?: unknown }).sellerKey), invoiceDate, body.numberOverride);
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
          exchangeRate,
          exchangeRateAt,
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

    // The bank and the registration are named in the note, not only in the
    // payload: a bank that did NOT follow the PI (round two, answer 20) and an
    // alternate registration spread across the whole workbook (answer 19) are
    // the two things a reader of the log would otherwise have to open the
    // snapshot to discover.
    // …and the slot is named as the PI's only when the PI names it. A proforma
    // whose seller is not an Indian exporter was paid into its own company's
    // account and carries an export/domestic key only so that a revision
    // following the order back to Pacific can pick an account with one
    // (piOwnsBankKey). The key still decides THIS invoice's bank — the invoice
    // module has one seller and draws on settings.banks[bankKey] whoever sold
    // — so the note goes on naming the slot; it stops telling the reader the
    // proforma asked to be paid into it, which that proforma never did.
    const piNamesBank = piOwnsBankKey((pi?.snapshot ?? null) as PiSnapshot | null);
    const bankNote = bankKey === inheritedBankKey
      ? (piNamesBank ? `, on the PI's ${bankKey} bank` : `, on the ${bankKey} bank`)
      : (piNamesBank ? `, bank changed to ${bankKey} from the PI's ${inheritedBankKey}` : `, bank changed to ${bankKey} from ${inheritedBankKey}`);
    const gstinNote = snapshot.gstinLabel ? `, under ${snapshot.gstin} (${snapshot.gstinLabel}) on ${gstinScopeWord(snapshot.gstinApplyAll)}` : "";
    // Answer 10: the rate this invoice starts life with, BY VALUE, and whether
    // it was typed or came off the order — a rate the clerk never saw typed is
    // the one an auditor asks about, and it is what the advance converts money
    // through from the moment the row exists.
    const rateNote = exchangeRate !== null
      ? `, ${exchangeRateNote(null, exchangeRate)}${inheritedRate !== null ? " inherited from the order and dated today" : ""}`
      : rateDropped
        ? `, the order's rate ${inheritedRate} was not carried over — this invoice is priced in ${snapshot.currency}`
        : "";
    await logOrderEvent(orderId, "invoice_created", {
      note: `${kind} invoice ${issued.number} drafted${issued.overridden ? " (number typed by hand)" : ""}${pl ? ` from packing list ${pl.number}` : ""}${bankNote}${gstinNote}${rateNote}${unpriced ? ` — ${unpriced}` : ""}`,
      by: g.user,
      payload: {
        invoiceId: created.id, kind, number: issued.number, packingListId, lines: lines.length,
        grandTotal: snapshot.grandTotal, overridden: issued.overridden, unpriced,
        gstin: snapshot.gstin, gstinApplyAll: snapshot.gstinApplyAll,
        bankKey: snapshot.bankKey, piBankKey: inheritedBankKey, piNumber: pi?.number ?? null,
        currency: snapshot.currency,
        exchangeRate, exchangeRateAt: exchangeRateAt?.toISOString() ?? null,
        exchangeRateInherited: inheritedRate !== null && !rateDropped,
        exchangeRateDropped: rateDropped ? inheritedRate : null,
      },
    });

    const row = await db.commercialInvoice.findUnique({ where: { id: created.id }, include: INVOICE_INCLUDE });
    return json(plain(row), 201);
  });
}
