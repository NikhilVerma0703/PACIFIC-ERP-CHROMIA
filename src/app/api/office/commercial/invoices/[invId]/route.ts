// GET   /api/office/commercial/invoices/[invId] — one invoice with its snapshot
// PATCH /api/office/commercial/invoices/[invId] — edit a DRAFT
//
// A draft may have its transport fields, its lines, its invoice date and the
// two dropdowns — the GSTIN it is issued under (answer 21) and the bank it
// prints (answer 23) — changed; the totals, the tax and the amount in words
// are re-derived from the lines on every edit, so the row and the PDF can
// never drift apart. The number is NOT editable — it was taken from the counter.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str, num, dateOnly } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import {
  canEditInvoice, applyDraftPatch, isoDate, TRANSPORT_COLUMNS,
  patchedInvoiceFields, registrationChanges, registrationChangeNote,
} from "@/lib/commercial/invoice-rules";
import { db, INVOICE_INCLUDE, invoiceIdOf, loadInvoice, snapshotOf, rowPatchFor } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    return json(plain(await loadInvoice(id)));
  });
}

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

export async function PATCH(req: Request, { params }: { params: Promise<{ invId: string }> }) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await invoiceIdOf(params);
    const row = await loadInvoice(id);
    if (!canEditInvoice(String(row.status))) fail(409, `Only a draft can be edited (this invoice is ${String(row.status).toLowerCase()})`);
    const body = await readBody<Record<string, unknown>>(req);
    const settings = await loadSettings();

    const data: Record<string, unknown> = {};

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
      const raw = body.exchangeRate;
      const n = num(raw);
      if (raw !== null && raw !== undefined && raw !== "" && n === null) fail(400, "Exchange rate must be a number");
      data.exchangeRate = n;
    }

    const before = snapshotOf(row);
    const { snapshot, changed, rejected } = applyDraftPatch(before, snapshotPatch, settings);
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
    const tail = registrationChangeNote(registration);
    await logOrderEvent(String(row.orderId), "invoice_edited", {
      note: `Invoice ${row.number} edited${tail ? ` — ${tail}` : ""}`,
      by: g.user,
      payload: { invoiceId: id, fields, ...(registration ?? {}) },
    });
    const after = await db.commercialInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    return json(plain(after));
  });
}
