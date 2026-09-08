"use client";
// The order's Invoice tab: the invoices raised against this order, the
// challans that moved goods under it, and the form that drafts the next one.
//
// The kind is chosen for you — DTA for a domestic order, EXPORT for an export
// one — because that is what decides the layout, the tax and which counter the
// number comes from. The registration it is issued under (answer 21) and the
// bank it prints (answer 23) are dropdowns: the bank is DEFAULTED FROM THE PI
// (round two, answer 20) and only the manager may move it off that, and an
// alternate registration asks one question about the export workbook before it
// is accepted (round two, answer 19). Naming a packing list draws the lines from the
// slabs actually packed (grouped by design and thickness, priced from the
// order line that matches) instead of from the order's own quantities.
//
// One order carries one invoice (answer 18): while one exists that is not
// cancelled the form is not offered, and the reason is written where the
// button was. The final invoice waits for the checklist's approval (answer
// 10): the tab says whether that has happened and who does it when it has not.
import Link from "next/link";
import { useState } from "react";
import { Card, Badge, Empty, H2 } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import {
  statusTone, canIssueInvoice, canCancelInvoice, defaultKindFor, unpricedLineNos, displayGrandTotal,
  refuseCreate, refuseIssueUnapproved, fyBadge, lineLacksCode, snapshotExtras, gstinWithLabel,
  bankKeyForInvoice, livePiOf, bankChangeRefusal, gstinScopeWord,
  hasExportWorkbook, gstinScopeUnasked,
  type InvoiceKind,
} from "@/lib/commercial/invoice-rules";
import { challanStatusTone } from "@/lib/commercial/challan-rules";
import type { OrderTabProps } from "@/lib/commercial/types";
import { inp, lbl, btnPrimary, btnGhost, btnDanger, th, thead, errorBox, noteBox, money, dmy, today } from "@/components/commercial/invoices/ui";
import { DocNumber } from "@/components/commercial/invoices/DocNumber";
import { GstinField } from "@/components/commercial/invoices/GstinField";
import { useInvoiceChoices } from "@/components/commercial/invoices/useInvoiceChoices";

export default function InvoiceTab({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const mayCancel = actions.includes("cancel");     // ADMIN / COMMERCIAL_MANAGER — the same rule as a PI (answer 24)
  const { choices, error: choicesError } = useInvoiceChoices();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [bankTouched, setBankTouched] = useState(false);

  // Round two, answer 20: the invoice's bank follows the order's live PI, so
  // the customer pays into the account his proforma named. With no live PI the
  // kind decides, as before (answer 23). Only the manager or an admin may move
  // it off that, and the select below says so instead of disappearing.
  const livePi = livePiOf(order.proformas);
  const inheritedBank = (kind: string) => bankKeyForInvoice(livePi, (kind === "DTA" ? "DTA" : "EXPORT") as InvoiceKind);
  const bankRefusal = bankChangeRefusal(actions);

  const [form, setForm] = useState({
    kind: defaultKindFor(order.kind) as string,
    packingListId: "",
    invoiceDate: today(),
    numberOverride: "",
    vehicleNo: "",
    transporter: "",
    lrNo: "",
    ewayBillNo: "",
    exchangeRate: order.exchangeRate === null || order.exchangeRate === undefined ? "" : String(order.exchangeRate),
    gstin: "",                                         // blank = the company's own
    gstinApplyAll: true,                               // round two, answer 19; only an alternate is ever asked
    bankKey: bankKeyForInvoice(livePiOf(order.proformas), defaultKindFor(order.kind)) as string,
  });

  const packable = order.packingLists.filter((p) => p.status !== "REJECTED");
  const dpFor = (k: string) => (k === "DTA" ? 2 : 3);
  const blocked = refuseCreate(order.invoices);
  const unapproved = refuseIssueUnapproved(order);

  const setKind = (kind: string) => {
    // The PI's bank where there is one, else ICICI on DTA and Kotak on export —
    // unless the manager has already chosen a bank by hand.
    //
    // Round two, answer 19: a DTA has no export workbook, so it cannot carry an
    // "every sheet" answer — switching to it drops the scope back to the
    // unasked default, the same one the server gives an alternate nobody
    // confirmed. Switching back to EXPORT leaves it there rather than restoring
    // a "yes" the clerk gave for a different kind of document; re-picking the
    // registration puts the question again.
    setForm((f) => ({
      ...f,
      kind,
      bankKey: bankTouched ? f.bankKey : inheritedBank(kind),
      gstinApplyAll: hasExportWorkbook(kind) ? f.gstinApplyAll : gstinScopeUnasked(choices?.gstins[0]?.gstin ?? "", f.gstin),
    }));
  };

  const create = async () => {
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/orders/${order.id}/invoices`, {
      kind: form.kind,
      packingListId: form.packingListId || null,
      invoiceDate: form.invoiceDate,
      numberOverride: form.numberOverride || null,
      vehicleNo: form.vehicleNo || null,
      transporter: form.transporter || null,
      lrNo: form.lrNo || null,
      ewayBillNo: form.ewayBillNo || null,
      exchangeRate: form.exchangeRate === "" ? null : Number(form.exchangeRate),
      gstin: form.gstin || null,
      gstinApplyAll: form.gstinApplyAll,
      // The bank goes back only where this login may set it; otherwise the
      // server inherits the PI's, which is what the disabled select shows.
      ...(bankRefusal ? {} : { bankKey: form.bankKey || null }),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice(`Invoice ${res.data?.number ?? ""} drafted.`);
    setOpen(false);
    refresh();
  };

  const issue = async (id: string) => {
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/invoices/${id}/issue`, {});
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice("Invoice issued.");
    refresh();
  };

  const cancel = async (id: string) => {
    if (!reason.trim()) { setError("Say why the invoice is being cancelled."); return; }
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/invoices/${id}/cancel`, { reason: reason.trim() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setCancelId(null); setReason("");
    setNotice("Invoice cancelled.");
    refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      {error && <div className={errorBox}>{error}</div>}
      {notice && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <H2>Invoices</H2>
          {mayWrite && !blocked && <button type="button" className={btnPrimary} onClick={() => setOpen((v) => !v)}>{open ? "Close" : "New invoice"}</button>}
        </div>

        {/* answer 10: the fact the issue button turns on, stated rather than discovered at the 409 */}
        {order.approvedAt ? (
          <p className="mb-3 text-sm text-gray-600">
            Checklist approved by <span className="font-medium text-gray-900">{order.approvedByName ?? "—"}</span> on {dmy(order.approvedAt)} — the final invoice may be issued.
          </p>
        ) : (
          <div className={`${noteBox} mb-3`}>{unapproved} A draft can be prepared meanwhile.</div>
        )}
        {mayWrite && blocked && <p className="mb-3 text-sm text-gray-500">{blocked}.</p>}

        {open && !blocked && (
          <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className={lbl} htmlFor="ni-kind">Kind</label>
                <select id="ni-kind" className={inp} value={form.kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="DTA">DTA — domestic, with GST</option>
                  <option value="EXPORT">Export — under LUT, no GST</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">This order is {order.kind === "DOMESTIC" ? "domestic" : "an export"}, so {defaultKindFor(order.kind)} is the usual choice.</p>
              </div>
              <div>
                <label className={lbl} htmlFor="ni-pl">Draw lines from a packing list</label>
                <select id="ni-pl" className={inp} value={form.packingListId} onChange={(e) => setForm((f) => ({ ...f, packingListId: e.target.value }))}>
                  <option value="">No — use the order&apos;s own lines</option>
                  {packable.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.status} · {p.slabs.length} slabs</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor="ni-date">Invoice date</label>
                <input id="ni-date" type="date" className={inp} value={form.invoiceDate} onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))} />
              </div>
              <div>
                <label className={lbl} htmlFor="ni-override">Number (blank takes the next one)</label>
                <input id="ni-override" className={inp} value={form.numberOverride} onChange={(e) => setForm((f) => ({ ...f, numberOverride: e.target.value }))} placeholder={form.kind === "DTA" ? "PESPL/N7/26-27" : "PESPL/N12"} />
              </div>
              <div>
                <GstinField
                  id="ni-gstin"
                  kind={form.kind}
                  choices={choices ? choices.gstins : null}
                  value={form.gstin}
                  applyAll={form.gstinApplyAll}
                  onChange={(gstin, gstinApplyAll) => setForm((f) => ({ ...f, gstin, gstinApplyAll }))}
                />
                {choicesError && <p className="mt-1 text-xs text-red-600">{choicesError}</p>}
              </div>
              <div>
                <label className={lbl} htmlFor="ni-bank">Bank printed</label>
                <select id="ni-bank" className={inp} value={form.bankKey} onChange={(e) => { setBankTouched(true); setForm((f) => ({ ...f, bankKey: e.target.value })); }} disabled={!choices || Boolean(bankRefusal)} title={bankRefusal ?? undefined}>
                  {(choices?.banks ?? []).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
                {/* round two, answer 20: refused is shown disabled with its reason, never hidden */}
                {bankRefusal
                  ? <p className="mt-1 text-xs text-amber-700">{bankRefusal}.</p>
                  : livePi && <p className="mt-1 text-xs text-gray-400">PI {livePi.number} names the {inheritedBank(form.kind)} account.</p>}
              </div>
              <div>
                <label className={lbl} htmlFor="ni-vehicle">Vehicle no</label>
                <input id="ni-vehicle" className={inp} value={form.vehicleNo} onChange={(e) => setForm((f) => ({ ...f, vehicleNo: e.target.value }))} />
              </div>
              <div>
                <label className={lbl} htmlFor="ni-transporter">Transporter</label>
                <input id="ni-transporter" className={inp} value={form.transporter} onChange={(e) => setForm((f) => ({ ...f, transporter: e.target.value }))} />
              </div>
              <div>
                <label className={lbl} htmlFor="ni-lr">LR no</label>
                <input id="ni-lr" className={inp} value={form.lrNo} onChange={(e) => setForm((f) => ({ ...f, lrNo: e.target.value }))} />
              </div>
              <div>
                <label className={lbl} htmlFor="ni-eway">E-way bill no</label>
                <input id="ni-eway" className={inp} value={form.ewayBillNo} onChange={(e) => setForm((f) => ({ ...f, ewayBillNo: e.target.value }))} />
              </div>
              {form.kind === "EXPORT" && (
                <div>
                  <label className={lbl} htmlFor="ni-fx">Exchange rate</label>
                  <input id="ni-fx" className={inp} inputMode="decimal" value={form.exchangeRate} onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value }))} />
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create()}>Create draft invoice</button>
              <button type="button" className={btnGhost} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}

        {order.invoices.length === 0 ? (
          <Empty>No invoice on this order yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={thead}>
                  <th className={th}>Invoice</th>
                  <th className={th}>Kind</th>
                  <th className={th}>GSTIN · bank</th>
                  <th className={th}>Packing list</th>
                  <th className={`${th} text-right`}>Grand total</th>
                  <th className={th}>Status</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {order.invoices.map((inv) => {
                  const unpriced = unpricedLineNos(inv.snapshot?.lines).length;
                  // answer 20: the paper prints the design's name; the screen says a code is missing
                  const uncoded = inv.kind === "EXPORT" ? (inv.snapshot?.lines ?? []).filter(lineLacksCode).length : 0;
                  const x = inv.snapshot ? snapshotExtras(inv.snapshot) : null;
                  const issueBlocked = canIssueInvoice(inv.status) ? unapproved : null;
                  return (
                  <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 align-top">
                      <DocNumber number={inv.number} date={inv.invoiceDate} href={`/office/commercial/invoices/${inv.id}`} tag={fyBadge(inv.kind, inv.invoiceDate)} />
                      {unpriced > 0 && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-700">
                          {unpriced} line{unpriced === 1 ? "" : "s"} without a rate
                        </span>
                      )}
                      {uncoded > 0 && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-700" title="The design master has no code for this design; the document prints the design name">
                          {uncoded} line{uncoded === 1 ? "" : "s"} with no design code
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top text-gray-600">{inv.kind}</td>
                    <td className="py-2 pr-4 align-top text-xs text-gray-500">
                      {x ? (
                        <>
                          <div>{gstinWithLabel(x.gstin, x.gstinLabel) || "—"}</div>
                          {/* round two, answer 19: an alternate says how far it
                              reaches — on an EXPORT invoice, the only kind with
                              a workbook to reach across */}
                          {x.gstinLabel && hasExportWorkbook(inv.kind) && <div className="text-amber-700">workbook: {gstinScopeWord(x.gstinApplyAll)}</div>}
                          <div>{inv.snapshot?.bank?.name ?? "—"}</div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-4 align-top text-gray-500">{order.packingLists.find((p) => p.id === inv.packingListId)?.number ?? "—"}</td>
                    {/* the snapshot's figure: grand_total is NUMERIC(16,2) and an
                        export document carries three decimals */}
                    <td className="py-2 pr-4 align-top text-right text-gray-900">{money(displayGrandTotal(inv), inv.currency, dpFor(inv.kind))}</td>
                    <td className="py-2 pr-4 align-top"><Badge tone={statusTone(inv.status)}>{inv.status}</Badge></td>
                    <td className="py-2 pr-4 align-top">
                      <div className="flex flex-wrap items-center gap-3">
                        <a href={`/api/office/commercial/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">PDF</a>
                        {inv.kind === "EXPORT" && <Link href={`/office/commercial/orders/${order.id}?tab=documents`} className="text-brand hover:underline">Export docs</Link>}
                        {mayWrite && canIssueInvoice(inv.status) && (
                          <button type="button" className="text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || Boolean(issueBlocked)} title={issueBlocked ?? undefined} onClick={() => void issue(inv.id)}>Issue</button>
                        )}
                        {mayCancel && canCancelInvoice(inv.status) && <button type="button" className="text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => { setCancelId(cancelId === inv.id ? null : inv.id); setReason(""); }}>Cancel</button>}
                      </div>
                      {cancelId === inv.id && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <input className={`${inp} max-w-xs`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being cancelled?" aria-label="Cancellation reason" />
                          <button type="button" className={btnDanger} disabled={busy} onClick={() => void cancel(inv.id)}>Confirm cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <H2>Delivery challans</H2>
          {mayWrite && <Link href={`/office/commercial/challans/new?orderId=${order.id}`} className={btnGhost}>New challan for this order</Link>}
        </div>
        {order.challans.length === 0 ? (
          <Empty>No challan against this order. A challan moves goods that are not a sale — samples, display stands, goods to the sister company.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={thead}>
                  <th className={th}>Challan</th>
                  <th className={th}>Consignee</th>
                  <th className={th}>Lorry</th>
                  <th className={`${th} text-right`}>Declared value</th>
                  <th className={th}>Status</th>
                  <th className={th}>PDF</th>
                </tr>
              </thead>
              <tbody>
                {order.challans.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 align-top"><DocNumber number={c.number} date={c.challanDate} href={`/office/commercial/challans/${c.id}`} /></td>
                    <td className="py-2 pr-4 align-top text-gray-900">{c.consigneeName}</td>
                    <td className="py-2 pr-4 align-top text-gray-500">{c.lorryNo ?? "—"}</td>
                    <td className="py-2 pr-4 align-top text-right text-gray-900">{money(c.totalAmount, "INR")}</td>
                    <td className="py-2 pr-4 align-top"><Badge tone={challanStatusTone(c.status)}>{c.status}</Badge></td>
                    <td className="py-2 pr-4 align-top"><a href={`/api/office/commercial/challans/${c.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
