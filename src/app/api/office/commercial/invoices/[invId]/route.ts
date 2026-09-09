// GET   /api/office/commercial/invoices/[invId] — one invoice with its snapshot
// PATCH /api/office/commercial/invoices/[invId] — edit a DRAFT
//
// A draft may have its transport fields, its lines, its invoice date and the
// two dropdowns — the GSTIN it is issued under (answer 21) and the bank it
// prints (answer 23) — changed; the totals, the tax and the amount in words
// are re-derived from the lines on every edit, so the row and the PDF can
// never drift apart. The number is NOT editable — it was taken from the counter.
//
// Round two: the bank is the manager's to change (answer 20) because it
// follows the PI, and an alternate registration carries `gstinApplyAll` — how
// far it reaches across the export workbook (answer 19). Both land in the
// invoice_edited event by value.
//
// Round three, answer 10: the manual exchange rate. It is the one field that
// outlives the draft — a body naming ONLY exchangeRate is accepted on an issued
// invoice from the manager or an admin — because the advance is measured
// through it (receipts-rules) long after the paper is out. Every real change
// stamps exchangeRateAt and goes into invoice_edited with both figures.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, dateOnly } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  canEditInvoice, applyDraftPatch, isoDate, TRANSPORT_COLUMNS,
  patchedInvoiceFields, registrationChanges, registrationChangeNote,
  snapshotExtras, isBankKey, mayChangeInvoiceBank, BANK_FOLLOWS_PI,
  parseExchangeRate, sameExchangeRate, mayEditExchangeRate, exchangeRateNote,
} from "@/lib/commercial/invoice-rules";
import { db, INVOICE_INCLUDE, invoiceIdOf, loadInvoice, snapshotOf, rowPatchFor } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("view", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    return json(plain(await loadInvoice(id)));
  });
}

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("write", "invoices");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    const row = await loadInvoice(id);
    const body = await readBody<Record<string, unknown>>(req);
    // Round three, answer 10: the exchange rate is the ONE field that outlives
    // the draft. Everything else on an issued invoice is what the customer
    // holds; the rate is a working figure the advance is measured through, and
    // the owner asked for it to be editable — by the manager once the paper is
    // out. So a body that names ONLY the rate is let past the draft check and
    // answered by mayEditExchangeRate instead; a body that also touches a
    // printed field is refused as before, whole, rather than half-applied.
    const rateOnly = Object.keys(body).length > 0 && Object.keys(body).every((k) => k === "exchangeRate");
    if (!canEditInvoice(String(row.status)) && !rateOnly) {
      fail(409, `Only a draft can be edited (this invoice is ${String(row.status).toLowerCase()})`);
    }
    const settings = await loadSettings();

    const data: Record<string, unknown> = {};
    // The rate before this PATCH, kept for the stamp and for the log's before/after.
    const rateBefore = row.exchangeRate ?? null;
    let rateMoved = false;

    // the invoice date lives on the row AND in the snapshot
    let snapshotPatch: Record<string, unknown> = { ...body };
    if (has(body, "invoiceDate")) {
      const raw = str(body.invoiceDate);
      const d = dateOnly(raw);
      if (raw && !d) fail(400, "Invoice date must be YYYY-MM-DD");
      if (d) { data.invoiceDate = d; snapshotPatch = { ...snapshotPatch, date: isoDate(d) }; }
    }
    // the transport columns are kept on the row so the register can filter them
    for (const k of TRANSPORT_COLUMNS) if (has(body, k)) data[k] = str(body[k]);
    if (has(body, "notes")) data.notes = str(body.notes);
    if (has(body, "packingListId")) data.packingListId = str(body.packingListId);
    if (has(body, "exchangeRate")) {
      const may = mayEditExchangeRate(String(row.status), g.actions);
      if (!may.ok) fail(403, may.reason);
      const parsed = parseExchangeRate(body.exchangeRate);
      if (!parsed.ok) fail(400, parsed.error);
      // Only a real move is written. Re-saving the form with 88.4200 over an
      // 88.42 must not restamp the date: the stamp answers "when was this rate
      // agreed", and a stamp that moved on every save would answer nothing.
      if (!sameExchangeRate(rateBefore, parsed.value)) {
        data.exchangeRate = parsed.value;
        // Answer 10's stamp. Cleared with the rate, because a date with no rate
        // beside it is the same lie the other way round.
        data.exchangeRateAt = parsed.value === null ? null : new Date();
        rateMoved = true;
      }
    }

    const before = snapshotOf(row);
    // Round two, answer 20: the invoice follows the PI's bank, and moving it
    // off that is the Commercial Manager's or an admin's (`cancel`, the same
    // action that cancels the invoice). Everyone else may still edit every
    // other field of the draft, so this refuses the one key rather than the
    // whole PATCH — and only when the body actually asks for a DIFFERENT bank.
    if (has(body, "bankKey")) {
      const wanted = body.bankKey;
      const now = snapshotExtras(before).bankKey;
      if (isBankKey(wanted) && wanted !== now && !mayChangeInvoiceBank(g.actions)) fail(403, BANK_FOLLOWS_PI);
    }
    // On an ISSUED invoice the snapshot is the paper the customer holds and it
    // is NOT touched: only the rate-only body reaches here in that state, and
    // moving the rate on the frozen document would change a PDF that has
    // already gone out. The row's figure moves — that is what the advance is
    // measured through (answer 10) — and the invoice screen says the printed
    // rate is the one the snapshot froze.
    const draft = canEditInvoice(String(row.status));
    const { snapshot, changed, rejected } = draft
      ? applyDraftPatch(before, snapshotPatch, settings)
      : { snapshot: before, changed: false, rejected: [] as string[] };
    // A field the body NAMED and applyDraftPatch threw away is an edit the user
    // typed and would otherwise lose behind a 200 — a malformed date, a blank
    // consignee, a `lines` that is not an array. Refuse the whole PATCH and say
    // which field, rather than answering "saved" and changing nothing.
    if (rejected.length > 0) fail(400, `Could not apply ${rejected.join(", ")} — check the value and try again`);
    if (changed) Object.assign(data, rowPatchFor(snapshot));
    if (Object.keys(data).length === 0) return json(plain(row));

    await db.commercialInvoice.update({ where: { id }, data });

    // What the log says this edit was. `Object.keys(data)` named the columns
    // the UPDATE wrote — subtotal, igst, grandTotal, re-derived on every edit —
    // so switching the invoice to the sister company's GSTIN (answer 21) or to
    // the other bank (answer 23) left no trace an auditor could read. Report
    // the body keys that actually landed, and those two by value.
    const fields = patchedInvoiceFields(body, before, snapshot);
    const registration = registrationChanges(before, snapshot);
    // Round three, answer 10: the rate goes into the log BY VALUE, both ends,
    // beside the stamp. A truck that left on a converted advance is defended by
    // this line and by nothing else — patchedInvoiceFields would have named the
    // frozen snapshot's field, which on an issued invoice does not move at all.
    const rateChange = rateMoved
      ? { exchangeRate: { from: plain(rateBefore), to: (data.exchangeRate ?? null) as number | null }, exchangeRateAt: (data.exchangeRateAt as Date | null)?.toISOString() ?? null }
      : null;
    const tail = [registrationChangeNote(registration), rateMoved ? exchangeRateNote(rateBefore, data.exchangeRate ?? null) : ""].filter(Boolean).join("; ");
    await logOrderEvent(String(row.orderId), "invoice_edited", {
      note: `Invoice ${row.number} edited${tail ? ` — ${tail}` : ""}`,
      by: g.user,
      payload: { invoiceId: id, fields: rateMoved && !fields.includes("exchangeRate") ? [...fields, "exchangeRate"] : fields, ...(registration ?? {}), ...(rateChange ?? {}) },
    });
    const after = await db.commercialInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    return json(plain(after));
  });
}
