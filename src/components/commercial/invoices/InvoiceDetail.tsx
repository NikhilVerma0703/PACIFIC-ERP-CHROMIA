"use client";
// One invoice: what the PDF will print (the frozen snapshot), the fields a
// draft may still change — transport, rates, and the two dropdowns, the GSTIN
// it is issued under (answer 21) and the bank it prints (answer 23) — and the
// two irreversible buttons, issue and cancel. Nothing here recomputes the
// money; the snapshot carries it, and a PATCH re-derives it on the server so
// the row and the page cannot disagree.
//
// Issue waits for the checklist's approval (answer 10): the button is off and
// says who approves until the order carries approvedAt. Cancel is the
// manager's or an admin's (commercialGate("cancel")), as for a PI (answer 24).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty, H2 } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson, postJson } from "@/lib/fab/postJson";
import {
  statusTone, canEditInvoice, canIssueInvoice, canCancelInvoice,
  unpricedWarning, lineNeedsPrice, isDerivedAmount, rateDp, displayGrandTotal, displaySubtotal,
  refuseIssueUnapproved, fyBadge, snapshotExtras, gstinWithLabel, printedItemCode, lineLacksCode,
  type InvoiceSnapshotExtras,
} from "@/lib/commercial/invoice-rules";
import type { DocLine, InvoiceSnapshot, Party } from "@/lib/commercial/types";
import { inp, lbl, btnPrimary, btnGhost, btnDanger, th, thead, errorBox, noteBox, money, qty, dmy, dateValue } from "./ui";
import { DocNumber } from "./DocNumber";
import { useInvoiceChoices } from "./useInvoiceChoices";

interface Invoice {
  id: string;
  orderId: string;
  packingListId: string | null;
  kind: "DTA" | "EXPORT";
  number: string;
  invoiceDate: string;
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  currency: string;
  exchangeRate: number | null;
  snapshot: InvoiceSnapshot & Partial<InvoiceSnapshotExtras>;
  subtotal: number | null;
  taxType: string | null;
  taxRate: number | null;
  igst: number | null;
  cgst: number | null;
  sgst: number | null;
  roundOff: number | null;
  grandTotal: number | null;
  amountInWords: string | null;
  vehicleNo: string | null;
  transporter: string | null;
  lrNo: string | null;
  containerNo: string | null;
  sealNo: string | null;
  ewayBillNo: string | null;
  notes: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  order: {
    id: string; number: string; kind: string; status: string;
    approvedAt: string | null; approvedByName: string | null;
    client: { id: string; name: string } | null;
  } | null;
  packingList: { id: string; number: string; status: string } | null;
  exportDocSet: { id: string; generatedAt: string | null } | null;
}

function PartyBlock({ title, p }: { title: string; p: Party | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      {!p || !p.name ? <div className="text-sm text-gray-400">—</div> : (
        <div className="text-sm text-gray-700">
          <div className="font-medium text-gray-900">{p.name}</div>
          {(p.lines ?? []).map((l, i) => <div key={i}>{l}</div>)}
          {p.country && <div>{p.country}</div>}
          {p.stateCode && <div className="text-gray-500">State code {p.stateCode}</div>}
          {p.gstin && <div className="font-medium">GSTIN {p.gstin}</div>}
          {p.code && <div className="text-gray-500">Customer code {p.code}</div>}
        </div>
      )}
    </div>
  );
}

/** One line's two editable money boxes. The amount is left blank while it is
 *  simply quantity × rate, so typing a rate re-derives it; a typed amount that
 *  the arithmetic does not give is shown and kept. */
interface PriceRow { rate: string; amount: string }
const priceRows = (lines: DocLine[]): PriceRow[] => lines.map((l) => ({
  rate: l.rate ? String(l.rate) : "",
  amount: isDerivedAmount(l) ? "" : String(l.amount),
}));

const TRANSPORT: Array<{ key: "vehicleNo" | "transporter" | "lrNo" | "containerNo" | "sealNo" | "ewayBillNo"; label: string }> = [
  { key: "vehicleNo", label: "Vehicle no" },
  { key: "transporter", label: "Transporter" },
  { key: "lrNo", label: "LR no" },
  { key: "containerNo", label: "Container no" },
  { key: "sealNo", label: "Seal no" },
  { key: "ewayBillNo", label: "E-way bill no" },
];

export function InvoiceDetail({ invoiceId, actions }: { invoiceId: string; actions: string[] }) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [regForm, setRegForm] = useState<{ gstin: string; bankKey: string }>({ gstin: "", bankKey: "" });
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const mayWrite = actions.includes("write");
  const mayCancel = actions.includes("cancel");
  const { choices, error: choicesError } = useInvoiceChoices();

  const load = useCallback(async () => {
    const r = await fetch(`/api/office/commercial/invoices/${invoiceId}`, { cache: "no-store" });
    const res = await readJson<Invoice>(r);
    if (!res.ok) { setError(res.error ?? "Could not load the invoice"); return; }
    setError(null);
    setInv(res.data);
    const d = res.data as Invoice;
    setForm({
      invoiceDate: dateValue(d.invoiceDate),
      vehicleNo: d.vehicleNo ?? "", transporter: d.transporter ?? "", lrNo: d.lrNo ?? "",
      containerNo: d.containerNo ?? "", sealNo: d.sealNo ?? "", ewayBillNo: d.ewayBillNo ?? "",
      notes: d.notes ?? "",
    });
    setPrices(priceRows(d.snapshot?.lines ?? []));
    // a row frozen before the dropdowns existed reads with the defaults it would have had
    const x = d.snapshot ? snapshotExtras(d.snapshot) : null;
    setRegForm({ gstin: x?.gstin ?? "", bankKey: x?.bankKey ?? "" });
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  if (error && !inv) return <div className={errorBox}>{error}</div>;
  if (!inv) return <Empty>Loading…</Empty>;

  const s = inv.snapshot;
  const x = snapshotExtras(s);
  const dp = inv.kind === "DTA" ? 2 : 3;
  const editable = mayWrite && canEditInvoice(inv.status);
  const unpriced = unpricedWarning(s.lines);
  const unapproved = refuseIssueUnapproved(inv.order);
  const uncoded = inv.kind === "EXPORT" ? s.lines.filter(lineLacksCode) : [];
  // answer 22: with alwaysIgst on there is no state code to fill in, so nothing to warn about
  const stateWarning = Boolean(choices && !choices.alwaysIgst && s.taxType === "IGST" && inv.kind === "DTA" && !s.buyer?.stateCode);
  const regDirty = regForm.gstin.toUpperCase() !== x.gstin.toUpperCase() || regForm.bankKey !== x.bankKey;

  const saveLines = async () => {
    setBusy(true); setError(null); setNotice(null);
    // Every line goes back, so the server replaces the array whole; the amount
    // is sent blank where the screen shows it blank, which tells sanitiseLine
    // to work it out from the quantity and the new rate.
    const lines = s.lines.map((l, i) => ({
      ...l,
      rate: prices[i]?.rate ?? String(l.rate),
      amount: prices[i]?.amount ?? "",
    }));
    const res = await patchJson(`/api/office/commercial/invoices/${inv.id}`, { lines });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice("Lines saved — the tax and the total were re-derived.");
    await load();
  };

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    const res = await patchJson(`/api/office/commercial/invoices/${inv.id}`, form);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice("Saved.");
    await load();
  };
  const saveRegistration = async () => {
    setBusy(true); setError(null); setNotice(null);
    const res = await patchJson(`/api/office/commercial/invoices/${inv.id}`, { gstin: regForm.gstin, bankKey: regForm.bankKey });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice("Registration and bank saved — the PDF prints them.");
    await load();
  };
  const issue = async () => {
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/invoices/${inv.id}/issue`, {});
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice(`Invoice ${inv.number} issued.`);
    await load();
  };
  const cancel = async () => {
    if (!cancelReason.trim()) { setError("Say why the invoice is being cancelled."); return; }
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/invoices/${inv.id}/cancel`, { reason: cancelReason.trim() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setCancelling(false); setCancelReason("");
    setNotice(`Invoice ${inv.number} cancelled.`);
    await load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* the date DIRECTLY UNDER the number (answer 6), the FY beside a continuous export number */}
          <DocNumber number={inv.number} date={inv.invoiceDate} tag={fyBadge(inv.kind, inv.invoiceDate)} size="lg" />
          <div className="flex items-center gap-2 pt-1">
            <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
            <Badge>{inv.kind === "DTA" ? "DTA · domestic" : "Export"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/office/commercial/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className={btnGhost}>Open PDF</a>
          {inv.order && <Link href={`/office/commercial/orders/${inv.order.id}?tab=invoice`} className={btnGhost}>Order {inv.order.number}</Link>}
          {inv.kind === "EXPORT" && inv.order && (
            <Link href={`/office/commercial/orders/${inv.order.id}?tab=documents`} className={btnGhost}>Export documents</Link>
          )}
          {mayWrite && canIssueInvoice(inv.status) && (
            <button type="button" className={`${btnPrimary} disabled:cursor-not-allowed`} disabled={busy || Boolean(unapproved)} title={unapproved ?? undefined} onClick={() => void issue()}>Issue invoice</button>
          )}
          {mayCancel && canCancelInvoice(inv.status) && <button type="button" className={btnDanger} disabled={busy} onClick={() => setCancelling((v) => !v)}>Cancel…</button>}
        </div>
      </div>

      {error && <div className={errorBox}>{error}</div>}
      {notice && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {/* answer 10: the approval the final invoice waits for */}
      {inv.status === "DRAFT" && (unapproved
        ? <div className={noteBox}>{unapproved}.</div>
        : <p className="text-sm text-gray-600">Checklist approved by <span className="font-medium text-gray-900">{inv.order?.approvedByName ?? "—"}</span> on {dmy(inv.order?.approvedAt)} — this invoice may be issued.</p>)}
      {unpriced && <div className={noteBox}>{unpriced}</div>}
      {uncoded.length > 0 && (
        <div className={noteBox}>
          {uncoded.length === 1 ? "One line has" : `${uncoded.length} lines have`} no design code in the master ({uncoded.map((l) => printedItemCode(l)).join(", ")}) — the document prints the design name. Codes are added under Settings.
        </div>
      )}
      {stateWarning && (
        <div className={noteBox}>The buyer has no GST state code on file, so IGST was assumed. Fill the state code on the client to have CGST + SGST worked out for a Tamil Nadu buyer.</div>
      )}
      {inv.status === "CANCELLED" && inv.cancelReason && <div className={noteBox}>Cancelled: {inv.cancelReason}</div>}

      {cancelling && (
        <Card>
          <H2>Cancel this invoice</H2>
          <p className="mb-2 text-sm text-gray-500">The number is kept and the register shows it as cancelled — a number taken from the counter is never reused. The order may then take a new invoice.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[18rem] flex-1">
              <label className={lbl} htmlFor="cancel-reason">Reason</label>
              <input id="cancel-reason" className={inp} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Wrong consignee, raised again as PESPL/…" />
            </div>
            <button type="button" className={btnDanger} disabled={busy} onClick={() => void cancel()}>Cancel invoice</button>
            <button type="button" className={btnGhost} onClick={() => setCancelling(false)}>Keep it</button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <H2>Particulars</H2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-gray-500">PI no &amp; date</dt><dd className="text-right text-gray-900">{s.piNumber ?? "—"}{s.piDate ? ` · ${dmy(s.piDate)}` : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Buyer&apos;s PO ref</dt><dd className="text-right text-gray-900">{s.buyerPoRef ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Sales person</dt><dd className="text-gray-900">{s.salesPerson ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Commodity</dt><dd className="text-gray-900">{s.commodity}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Currency</dt><dd className="text-gray-900">{inv.currency}{inv.exchangeRate ? ` @ ${inv.exchangeRate}` : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Packing list</dt><dd className="text-gray-900">{inv.packingList ? <Link href={`/office/commercial/packing-lists/${inv.packingList.id}`} className="text-brand hover:underline">{inv.packingList.number}</Link> : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Issued</dt><dd className="text-gray-900">{inv.issuedAt ? new Date(inv.issuedAt).toLocaleString("en-IN") : "—"}</dd></div>
          </dl>
        </Card>
        <Card><PartyBlock title="Buyer (bill to)" p={s.buyer} /></Card>
        <Card>
          <PartyBlock title="Consignee" p={s.consignee} />
          {s.notifyParty && <div className="mt-4"><PartyBlock title="Notify party" p={s.notifyParty} /></div>}
        </Card>
      </div>

      <Card>
        <H2>Registration and bank</H2>
        <p className="mb-3 text-sm text-gray-500">
          The GSTIN the invoice is issued under and the bank it prints. ICICI on a domestic invoice, Kotak on an export one, PESPL&apos;s own registration — unless changed here while it is a draft.
        </p>
        {choicesError && <div className={`${errorBox} mb-3`}>{choicesError}</div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl} htmlFor="f-gstin">Issued under GSTIN</label>
            <select id="f-gstin" className={inp} disabled={!editable || !choices} value={regForm.gstin} onChange={(e) => setRegForm((f) => ({ ...f, gstin: e.target.value }))}>
              {(choices?.gstins ?? [{ gstin: x.gstin, label: x.gstinLabel ?? s.company.legalName }]).map((c) => <option key={c.gstin} value={c.gstin}>{c.gstin} — {c.label}</option>)}
              {choices && !choices.gstins.some((c) => c.gstin === x.gstin) && <option value={x.gstin}>{gstinWithLabel(x.gstin, x.gstinLabel)} (no longer in Settings)</option>}
            </select>
            <p className="mt-1 text-xs text-gray-400">Prints as GSTIN {gstinWithLabel(x.gstin, x.gstinLabel) || "—"}</p>
          </div>
          <div>
            <label className={lbl} htmlFor="f-bank">Bank printed</label>
            <select id="f-bank" className={inp} disabled={!editable || !choices} value={regForm.bankKey} onChange={(e) => setRegForm((f) => ({ ...f, bankKey: e.target.value }))}>
              {(choices?.banks ?? [{ key: x.bankKey, name: s.bank.name, label: s.bank.name }]).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">{s.bank.name} · A/C {s.bank.accountNo} · IFSC {s.bank.ifsc}{s.bank.swift ? ` · Swift ${s.bank.swift}` : ""}{s.bank.adCode ? ` · AD code ${s.bank.adCode}` : ""}</p>
          </div>
        </div>
        {editable && (
          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy || !regDirty} onClick={() => void saveRegistration()}>Save registration and bank</button>
            <button type="button" className={btnGhost} disabled={busy || !regDirty} onClick={() => setRegForm({ gstin: x.gstin, bankKey: x.bankKey })}>Reset</button>
          </div>
        )}
      </Card>

      <Card>
        <H2>Lines</H2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={thead}>
                <th className={th}>#</th>
                {inv.kind === "EXPORT" && <th className={th}>Item code</th>}
                <th className={th}>Description</th>
                <th className={th}>HSN</th>
                <th className={th}>Slabs</th>
                <th className={th}>Thickness</th>
                <th className={`${th} text-right`}>Quantity</th>
                <th className={th}>Unit</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={l.lineNo} className={`border-b border-gray-50 last:border-0 ${lineNeedsPrice(l) ? "bg-amber-50/70" : ""}`}>
                  <td className="py-2 pr-4 text-gray-400">{l.lineNo}</td>
                  {inv.kind === "EXPORT" && (
                    // answer 20: the design master's code; the paper prints the design's name where there is none
                    <td className="py-2 pr-4 text-gray-900">
                      {printedItemCode(l) || "—"}
                      {lineLacksCode(l) && <Badge tone="amber">no code</Badge>}
                    </td>
                  )}
                  <td className="py-2 pr-4 text-gray-900">{l.description}{l.design && l.design.toUpperCase() !== l.description.toUpperCase() ? <span className="block text-xs text-gray-400">{l.design}</span> : null}</td>
                  <td className="py-2 pr-4 text-gray-500">{l.hsn}</td>
                  <td className="py-2 pr-4 text-gray-600">{l.slabs ?? "—"}</td>
                  <td className="py-2 pr-4 text-gray-600">{l.thickness ?? "—"}</td>
                  <td className="py-2 pr-4 text-right text-gray-900">{qty(l.qty, 3)}</td>
                  <td className="py-2 pr-4 text-gray-500">{l.unit}</td>
                  {editable ? (
                    <>
                      <td className="py-1.5 pr-4 w-28">
                        <input className={`${inp} text-right`} inputMode="decimal" aria-label={`Line ${l.lineNo} rate`}
                          value={prices[i]?.rate ?? ""} placeholder="rate"
                          onChange={(e) => setPrices((p) => p.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)))} />
                      </td>
                      <td className="py-1.5 pr-4 w-32">
                        <input className={`${inp} text-right`} inputMode="decimal" aria-label={`Line ${l.lineNo} amount`}
                          value={prices[i]?.amount ?? ""} placeholder="auto"
                          onChange={(e) => setPrices((p) => p.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-4 text-right text-gray-600">{qty(l.rate, rateDp(l.rate))}</td>
                      <td className="py-2 pr-4 text-right font-medium text-gray-900">{qty(l.amount, dp)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void saveLines()}>Save rates</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setPrices(priceRows(s.lines))}>Reset rates</button>
            <span className="text-xs text-gray-400">Leave Amount blank and it is worked out as quantity × rate. Only a draft can be repriced.</span>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-sm space-y-1 text-sm">
            {/* the snapshot's figures, not the columns: grand_total is
                NUMERIC(16,2) and an export document carries three decimals */}
            <div className="flex justify-between"><dt className="text-gray-500">Total</dt><dd className="text-gray-900">{money(displaySubtotal(inv), inv.currency, dp)}</dd></div>
            {s.taxType === "IGST" && <div className="flex justify-between"><dt className="text-gray-500">IGST @ {s.taxRate}%</dt><dd className="text-gray-900">{money(inv.igst, "INR")}</dd></div>}
            {s.taxType === "CGST_SGST" && <>
              <div className="flex justify-between"><dt className="text-gray-500">CGST @ {s.taxRate / 2}%</dt><dd className="text-gray-900">{money(inv.cgst, "INR")}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">SGST @ {s.taxRate / 2}%</dt><dd className="text-gray-900">{money(inv.sgst, "INR")}</dd></div>
            </>}
            {inv.kind === "DTA" && <div className="flex justify-between"><dt className="text-gray-500">Round off</dt><dd className="text-gray-900">{money(inv.roundOff, "INR")}</dd></div>}
            <div className="flex justify-between border-t border-gray-100 pt-1 text-base font-semibold"><dt>Grand total</dt><dd>{money(displayGrandTotal(inv), inv.currency, dp)}</dd></div>
            <div className="pt-1 text-xs text-gray-500">{s.amountInWords ?? inv.amountInWords}</div>
          </dl>
        </div>
      </Card>

      <Card>
        <H2>Transport and references</H2>
        {!editable && <p className="mb-3 text-sm text-gray-500">An issued invoice is read-only. Cancel it and raise another if these were wrong.</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className={lbl} htmlFor="f-invoiceDate">Invoice date</label>
            <input id="f-invoiceDate" type="date" className={inp} disabled={!editable} value={form.invoiceDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))} />
          </div>
          {TRANSPORT.map((t) => (
            <div key={t.key}>
              <label className={lbl} htmlFor={`f-${t.key}`}>{t.label}</label>
              <input id={`f-${t.key}`} className={inp} disabled={!editable} value={form[t.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [t.key]: e.target.value }))} />
            </div>
          ))}
          <div className="md:col-span-4">
            <label className={lbl} htmlFor="f-notes">Notes (printed under the declaration)</label>
            <textarea id="f-notes" className={inp} rows={2} disabled={!editable} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        {editable && (
          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>Save</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void load()}>Reset</button>
          </div>
        )}
      </Card>

      <Card>
        <H2>Bank and declaration</H2>
        <div className="grid grid-cols-1 gap-6 text-sm text-gray-700 md:grid-cols-2">
          <div>
            <div className="font-medium text-gray-900">{s.bank.name}</div>
            <div>A/C {s.bank.accountNo} · IFSC {s.bank.ifsc}</div>
            <div>{s.bank.address}</div>
            {s.bank.swift && <div>Swift {s.bank.swift}</div>}
            {s.bank.adCode && <div>AD code {s.bank.adCode}</div>}
            {s.bank.routingBank && <div className="text-gray-500">Routing: {s.bank.routingBank}</div>}
          </div>
          <div>
            <div className="text-gray-600">{s.declaration}</div>
            {s.lutText && <div className="mt-2 text-xs text-gray-500">{s.lutText}</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}
