"use client";
// The order's Invoice tab: the invoices raised against this order, the
// challans that moved goods under it, and the form that drafts the next one.
//
// The kind is chosen for you — DTA for a domestic order, EXPORT for an export
// one — because that is what decides the layout, the bank, the tax and which
// counter the number comes from. Naming a packing list draws the lines from
// the slabs actually packed (grouped by design and thickness, priced from the
// order line that matches) instead of from the order's own quantities.
import Link from "next/link";
import { useState } from "react";
import { Card, Badge, Empty, H2 } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { statusTone, canIssueInvoice, canCancelInvoice, defaultKindFor, unpricedLineNos, displayGrandTotal } from "@/lib/commercial/invoice-rules";
import { challanStatusTone } from "@/lib/commercial/challan-rules";
import type { OrderTabProps } from "@/lib/commercial/types";
import { inp, lbl, btnPrimary, btnGhost, btnDanger, th, thead, errorBox, money, dmy, today } from "@/components/commercial/invoices/ui";

export default function InvoiceTab({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
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
  });

  const packable = order.packingLists.filter((p) => p.status !== "REJECTED");
  const dpFor = (k: string) => (k === "DTA" ? 2 : 3);

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
          {mayWrite && <button type="button" className={btnPrimary} onClick={() => setOpen((v) => !v)}>{open ? "Close" : "New invoice"}</button>}
        </div>

        {open && (
          <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className={lbl} htmlFor="ni-kind">Kind</label>
                <select id="ni-kind" className={inp} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
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
                <input id="ni-override" className={inp} value={form.numberOverride} onChange={(e) => setForm((f) => ({ ...f, numberOverride: e.target.value }))} placeholder={form.kind === "DTA" ? "PESPL/0137/26-27" : "PESPL/2780"} />
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
                  <th className={th}>Date</th>
                  <th className={th}>Packing list</th>
                  <th className={`${th} text-right`}>Grand total</th>
                  <th className={th}>Status</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {order.invoices.map((inv) => {
                  const unpriced = unpricedLineNos(inv.snapshot?.lines).length;
                  return (
                  <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/office/commercial/invoices/${inv.id}`} className="font-medium text-brand hover:underline">{inv.number}</Link>
                      {unpriced > 0 && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-700">
                          {unpriced} line{unpriced === 1 ? "" : "s"} without a rate
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{inv.kind}</td>
                    <td className="py-2 pr-4 text-gray-600">{dmy(inv.invoiceDate)}</td>
                    <td className="py-2 pr-4 text-gray-500">{order.packingLists.find((p) => p.id === inv.packingListId)?.number ?? "—"}</td>
                    {/* the snapshot's figure: grand_total is NUMERIC(16,2) and an
                        export document carries three decimals */}
                    <td className="py-2 pr-4 text-right text-gray-900">{money(displayGrandTotal(inv), inv.currency, dpFor(inv.kind))}</td>
                    <td className="py-2 pr-4"><Badge tone={statusTone(inv.status)}>{inv.status}</Badge></td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <a href={`/api/office/commercial/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">PDF</a>
                        {inv.kind === "EXPORT" && <Link href={`/office/commercial/orders/${order.id}?tab=documents`} className="text-brand hover:underline">Export docs</Link>}
                        {mayWrite && canIssueInvoice(inv.status) && <button type="button" className="text-brand hover:underline disabled:opacity-50" disabled={busy} onClick={() => void issue(inv.id)}>Issue</button>}
                        {mayWrite && canCancelInvoice(inv.status) && <button type="button" className="text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => { setCancelId(cancelId === inv.id ? null : inv.id); setReason(""); }}>Cancel</button>}
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
                  <th className={th}>Date</th>
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
                    <td className="py-2 pr-4"><Link href={`/office/commercial/challans/${c.id}`} className="font-medium text-brand hover:underline">{c.number}</Link></td>
                    <td className="py-2 pr-4 text-gray-600">{dmy(c.challanDate)}</td>
                    <td className="py-2 pr-4 text-gray-900">{c.consigneeName}</td>
                    <td className="py-2 pr-4 text-gray-500">{c.lorryNo ?? "—"}</td>
                    <td className="py-2 pr-4 text-right text-gray-900">{money(c.totalAmount, "INR")}</td>
                    <td className="py-2 pr-4"><Badge tone={challanStatusTone(c.status)}>{c.status}</Badge></td>
                    <td className="py-2 pr-4"><a href={`/api/office/commercial/challans/${c.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open</a></td>
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
