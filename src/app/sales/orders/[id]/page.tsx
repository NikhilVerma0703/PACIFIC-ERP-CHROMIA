"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, use } from "react";
import Link from "next/link";
import ShippingDocsClient from "./ShippingDocsClient";
import { TransferOwnerClient } from "../../TransferOwnerClient";
import StatusFlowClient from "./StatusFlowClient";
import PortArrivalClient from "./PortArrivalClient";
import PackingListMailClient from "./PackingListMailClient";
import CommercialInvoiceClient from "./CommercialInvoiceClient";

type Order = {
  id: string; orderNumber: string; status: string; createdAt: string;
  currency: string | null; totalAmount: number | null;
  deliveryTerms: string | null; notes: string | null;
  client: { id: string; name: string; email: string | null; country: string | null; contactPerson: string | null };
  sp: { name: string | null; email: string };
  proformaInvoices: {
    id: string; piNumber: string; currency: string; totalAmount: number;
    deliveryTerms: string | null; paymentTermsSummary: string | null;
    portOfLoading: string | null; portOfDischarge: string | null; notes: string | null;
    productType: string | null;
    items: any[];
  }[];
  paymentTerms: {
    advancePct: number; cadPct: number; inspectionPct: number;
    receiveToPayPct: number; blToPayPct: number; creditPct: number;
  } | null;
  paymentDivisions: {
    id: string; type: string; percentage: number; amount: number;
    deadlineDays: number | null; paidAt: string | null; status: string;
    extendedDueDate?: string | null;
    overriddenAt?: string | null;
    overrideNote?: string | null;
    amountReceived?: number | null;
  }[];
  productionJob: { type: string; status: string; notes: string | null } | null;
  stockCheck: { status: string; notes: string | null } | null;
  logs: { id: string; action: string; note: string | null; createdAt: string; user: { name: string | null } | null }[];
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT:  "bg-amber-100 text-amber-700",
  STOCK_CONFIRMED:  "bg-lime-100 text-lime-700",
  IN_PRODUCTION:    "bg-blue-100 text-blue-700",
  PACKING:          "bg-purple-100 text-purple-700",
  DISPATCHED:       "bg-indigo-100 text-indigo-700",
  IN_TRANSIT:       "bg-cyan-100 text-cyan-700",
  PORT_ARRIVED:     "bg-teal-100 text-teal-700",
  DELIVERED:        "bg-green-100 text-green-700",
  CANCELLED:        "bg-red-100 text-red-700",
};

type CreditNote = {
  id: string; creditNumber: string; reason: string; description: string | null;
  amount: number; currency: string; status: string; notes: string | null;
  inspectedAt: string | null; issuedAt: string | null; createdAt: string;
  orderId: string;
  appliedToOrderId: string | null;
  appliedAt: string | null;
  order?: { orderNumber: string; client: { name: string; id: string } };
};

const CN_COLORS: Record<string, string> = {
  PENDING_INSPECTION: "bg-amber-100 text-amber-700",
  INSPECTED:          "bg-blue-100 text-blue-700",
  ISSUED:             "bg-green-100 text-green-700",
  REJECTED:           "bg-red-100 text-red-700",
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder]     = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const [creditNotes, setCreditNotes]     = useState<CreditNote[]>([]);
  const [availableCNs, setAvailableCNs]   = useState<CreditNote[]>([]);
  const [appliedCNs, setAppliedCNs]       = useState<CreditNote[]>([]);

  const [showCNForm, setShowCNForm] = useState(false);
  const [cnForm, setCNForm]   = useState({ reason: "", description: "", amount: "", notes: "" });
  const [cnBusy, setCNBusy]   = useState(false);
  const [cnMsg, setCNMsg]     = useState("");
  const [applyBusy, setApplyBusy] = useState<string | null>(null);

  const [userSalesRole, setUserSalesRole] = useState<string | null>(null);
  const [extendDivId, setExtendDivId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [divBusy, setDivBusy] = useState<string | null>(null);
  const [divMsg, setDivMsg] = useState("");

  async function loadOrder() {
    const r = await fetch(`/api/sales/orders/${id}`);
    if (r.ok) setOrder(await r.json());
    setLoading(false);
  }

  async function loadCNs() {
    const r = await fetch(`/api/sales/credit-notes?orderId=${id}`);
    if (r.ok) setCreditNotes(await r.json());
  }

  async function loadAvailableCNs(clientId: string) {
    const r = await fetch(`/api/sales/credit-notes?clientId=${clientId}`);
    if (r.ok) {
      const all: CreditNote[] = await r.json();
      setAvailableCNs(all.filter(cn => cn.orderId !== id));
    }
  }

  async function loadAppliedCNs() {
    const r = await fetch(`/api/sales/credit-notes?appliedToOrderId=${id}`);
    if (r.ok) setAppliedCNs(await r.json());
  }

  useEffect(() => {
    loadOrder(); loadCNs(); loadAppliedCNs();
    fetch("/api/sales/me").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.salesRole) setUserSalesRole(d.salesRole);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (order?.client?.id) loadAvailableCNs(order.client.id);
  }, [order?.client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function extendDivision(divisionId: string) {
    if (!extendDate) { setDivMsg("Please select a new due date"); return; }
    setDivBusy(divisionId); setDivMsg("");
    const r = await fetch(`/api/sales/orders/${id}/payment-division`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ divisionId, action: "extend", newDueDate: extendDate }),
    });
    setDivBusy(null);
    if (!r.ok) { const d = await r.json(); setDivMsg(d.error ?? "Failed"); return; }
    setExtendDivId(null); setExtendDate("");
    await loadOrder();
  }

  async function overrideDivision(divisionId: string) {
    const note = prompt("Enter a note for this override/waive:");
    if (note === null) return;
    setDivBusy(divisionId); setDivMsg("");
    const r = await fetch(`/api/sales/orders/${id}/payment-division`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ divisionId, action: "override", note }),
    });
    setDivBusy(null);
    if (!r.ok) { const d = await r.json(); setDivMsg(d.error ?? "Failed"); return; }
    await loadOrder();
  }

  async function sendReminder(divisionId: string, force: boolean, milestone?: string) {
    setDivBusy(divisionId); setDivMsg("");
    const r = await fetch(`/api/sales/orders/${id}/payment-division/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ divisionId, force, milestone }),
    });
    const data = await r.json();
    setDivBusy(null);
    if (!r.ok) { setDivMsg(data.error ?? "Failed to send reminder"); return; }
    if (!data.ok) { setDivMsg(data.message ?? "Nothing to send"); return; }
    setDivMsg(`✓ Sent: ${data.milestones?.join(", ")}`);
  }

  async function sendEtaReminder() {
    setDivMsg(""); setDivBusy("eta");
    const r = await fetch(`/api/sales/orders/${id}/send-eta-reminder`, { method: "POST" });
    const data = await r.json();
    setDivBusy(null);
    if (!r.ok) { setDivMsg(data.error ?? "Failed to send ETA reminder"); return; }
    setDivMsg(`✓ ETA reminder sent to ${data.sentTo}`);
  }

  async function createCN() {
    if (!cnForm.reason || !cnForm.amount) { setCNMsg("Reason and amount are required"); return; }
    setCNBusy(true); setCNMsg("");
    const r = await fetch("/api/sales/credit-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: id, ...cnForm, amount: Number(cnForm.amount) }),
    });
    const d = await r.json();
    setCNBusy(false);
    if (!r.ok) { setCNMsg(d.error ?? "Failed"); return; }
    setCNMsg("Credit note created.");
    setShowCNForm(false);
    setCNForm({ reason: "", description: "", amount: "", notes: "" });
    await loadCNs();
  }

  async function updateCN(cnId: string, status: string) {
    await fetch(`/api/sales/credit-notes/${cnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadCNs();
    if (order?.client?.id) loadAvailableCNs(order.client.id);
  }

  // A refused apply/unapply used to vanish: the PATCH 403'd, nobody read r.ok,
  // and the page just refreshed with the note still sitting where it was — the
  // user could not tell a failure from a success that changed nothing.
  async function patchCNApplication(cnId: string, appliedToOrderId: string | null): Promise<boolean> {
    const r = await fetch(`/api/sales/credit-notes/${cnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedToOrderId }),
    });
    if (r.ok) { setCNMsg(""); return true; }
    const err = await r.json().then((j) => j?.error).catch(() => null);
    setCNMsg(`Could not ${appliedToOrderId ? "apply" : "remove"} the credit${err ? ` — ${err}` : ""} (HTTP ${r.status}).`);
    return false;
  }

  async function applyCN(cnId: string) {
    setApplyBusy(cnId);
    await patchCNApplication(cnId, id);
    setApplyBusy(null);
    await Promise.all([
      loadCNs(),
      loadAppliedCNs(),
      order?.client?.id ? loadAvailableCNs(order.client.id) : Promise.resolve(),
    ]);
  }

  async function unapplyCN(cnId: string) {
    if (!confirm("Remove this credit from the order?")) return;
    setApplyBusy(cnId);
    await patchCNApplication(cnId, null);
    setApplyBusy(null);
    await Promise.all([
      loadAppliedCNs(),
      order?.client?.id ? loadAvailableCNs(order.client.id) : Promise.resolve(),
    ]);
  }

  if (loading) return <div className="text-sm text-slate-400 py-12 text-center">Loading...</div>;
  if (!order)  return <div className="text-sm text-red-500 py-12 text-center">Order not found.</div>;

  const pis      = order.proformaInvoices;
  const mainPI   = pis[0];
  const currency = order.currency ?? "USD";
  const total    = order.totalAmount ?? mainPI?.totalAmount ?? 0;

  // Fully-paid divisions count in full; unpaid ones contribute any part payment
  // recorded against them (amount_received, scripts/0024).
  const paidAmount         = order.paymentDivisions.reduce(
    (s, d) => s + (d.paidAt ? d.amount : (d.amountReceived ?? 0)), 0);
  const paidPct            = total > 0 ? Math.round((paidAmount / total) * 100) : 0;
  const totalAppliedCredit = appliedCNs.reduce((s, cn) => s + cn.amount, 0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/sales/orders" className="text-slate-400 hover:text-slate-600 text-sm">Back to Orders</Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">{order.orderNumber}</span>
        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status] ?? "bg-slate-100 text-slate-600"}`}>
          {order.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{order.orderNumber}</h2>
            <p className="text-sm text-slate-500">{order.client.name}{order.client.country ? ` - ${order.client.country}` : ""}</p>
            {order.client.contactPerson && (
              <p className="text-xs text-slate-400">{order.client.contactPerson} - {order.client.email ?? ""}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-900">
              {currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            {totalAppliedCredit > 0 && (
              <p className="text-xs text-green-700 font-semibold mt-0.5">
                - {currency} {totalAppliedCredit.toFixed(2)} credit applied
              </p>
            )}
            <p className="text-xs text-slate-400">PI: {pis.map(p => p.piNumber).join(", ")}</p>
          </div>
        </div>
        {mainPI && (
          <div className="grid grid-cols-3 gap-4 text-sm border-t border-slate-100 pt-4">
            {([
              ["Delivery Terms",    mainPI.deliveryTerms],
              ["Port of Loading",   mainPI.portOfLoading],
              ["Port of Discharge", mainPI.portOfDischarge],
              ["Payment Terms",     mainPI.paymentTermsSummary],
              ["Salesperson",       order.sp.name],
              ["Created",           new Date(order.createdAt).toLocaleDateString()],
            ] as [string, string | null][]).map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="font-medium text-slate-700">{val ?? "-"}</p>
              </div>
            ))}
          </div>
        )}
        <TransferOwnerClient type="ORDER" recordId={order.id} ownerLabel={order.sp?.name || order.sp?.email || "\u2014"} onTransferred={loadOrder} />
        {order.notes && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-400 mb-1">Notes</p>
            <p className="text-sm text-slate-600">{order.notes}</p>
          </div>
        )}
        <div className="mt-4 border-t border-slate-100 pt-3 flex flex-wrap gap-2">
          {pis.map(pi => (
            <a key={pi.id} href={`/api/sales/pi/${pi.id}/pdf`} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 transition">
              Download PI PDF ({pi.piNumber})
            </a>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-4">Order Status</p>
        <StatusFlowClient
          orderId={order.id}
          status={order.status}
          hasProductionJob={!!order.productionJob}
          onStatusChange={newStatus => setOrder(o => o ? { ...o, status: newStatus } : o)}
        />
      </div>

      {mainPI && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Line Items</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {["Description","Spec","Qty","Unit Price","Total"].map(h => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {((mainPI.items as any[]) ?? []).map((item: any, i: number) => {
                const desc   = item.colour || item.description || item.desc || "-";
                const spec   = [item.finish, item.thickness].filter(Boolean).join(" - ");
                const sqft   = Number(item.sqft ?? item.sqFt ?? item.qty ?? 0);
                const slabs  = item.noOfSlabs != null ? `${item.noOfSlabs} slabs - ` : "";
                const price  = Number(item.unitPrice ?? 0);
                const amount = Number(item.amount ?? (sqft * price));
                return (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-4 py-2.5 text-slate-800 font-medium">{desc}</td>
                    <td className="px-4 py-2.5 text-slate-500">{spec}</td>
                    <td className="px-4 py-2.5 text-slate-500">{slabs}{sqft.toFixed(3)} SQFT</td>
                    <td className="px-4 py-2.5 text-slate-600">{currency} {price.toFixed(3)}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{currency} {amount.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {order.paymentDivisions.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Payment Schedule</p>
            <span className="text-xs text-slate-500">{paidPct}% paid - {currency} {paidAmount.toFixed(2)}</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
            <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
          </div>
          {divMsg && <p className="text-xs text-red-600 mb-2">{divMsg}</p>}
          <div className="space-y-3">
            {order.paymentDivisions.map(d => {
              const canManage =
                (userSalesRole === "REPORTING_MANAGER" || userSalesRole === "SALES_ADMIN") &&
                !d.overriddenAt &&
                (d.status === "PENDING" || d.status === "OVERDUE");
              const canRemind = !d.paidAt && !d.overriddenAt &&
                (d.status === "PENDING" || d.status === "OVERDUE");
              return (
                <div key={d.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 font-medium">{d.type.replace(/_/g, " ")} — {d.percentage}%</span>
                    <span className="font-semibold text-slate-800">{currency} {d.amount.toFixed(2)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      d.paidAt || d.overriddenAt ? "bg-green-100 text-green-700" :
                      d.status === "OVERDUE" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"
                    }`}>
                      {d.overriddenAt
                        ? "Overridden/Waived"
                        : d.paidAt
                        ? `Paid ${new Date(d.paidAt).toLocaleDateString()}`
                        : d.deadlineDays ? `Due in ${d.deadlineDays}d` : d.status}
                    </span>
                  </div>
                  {!d.paidAt && (d.amountReceived ?? 0) > 0 && (
                    <p className="text-xs text-sky-700 font-medium mt-1">
                      Part paid: {currency} {(d.amountReceived ?? 0).toFixed(2)} received · balance {currency} {Math.max(0, d.amount - (d.amountReceived ?? 0)).toFixed(2)}
                    </p>
                  )}
                  {d.extendedDueDate && (
                    <p className="text-xs text-blue-600 mt-1">
                      Extended to: {new Date(d.extendedDueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  )}
                  {d.overriddenAt && (
                    <p className="text-xs text-slate-400 mt-1 italic">
                      Waived: {d.overrideNote || "No note"}
                    </p>
                  )}
                  {canManage && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {extendDivId === d.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={extendDate}
                            onChange={e => setExtendDate(e.target.value)}
                            className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <button
                            onClick={() => extendDivision(d.id)}
                            disabled={divBusy === d.id}
                            className="text-xs px-2 py-1 bg-brand text-white rounded font-semibold hover:bg-brand-dark disabled:opacity-50 transition"
                          >
                            {divBusy === d.id ? "Saving..." : "Confirm"}
                          </button>
                          <button
                            onClick={() => { setExtendDivId(null); setExtendDate(""); setDivMsg(""); }}
                            className="text-xs px-2 py-1 border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { setExtendDivId(d.id); setExtendDate(""); setDivMsg(""); }}
                            className="text-xs px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-semibold hover:bg-blue-100 transition"
                          >
                            Extend Due Date
                          </button>
                          <button
                            onClick={() => overrideDivision(d.id)}
                            disabled={divBusy === d.id}
                            className="text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded font-semibold hover:bg-amber-100 disabled:opacity-50 transition"
                          >
                            {divBusy === d.id ? "Processing..." : "Waive / Override"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {canRemind && (
                    <div className="mt-2">
                      <p className="text-[10px] text-slate-400 mb-1 font-medium uppercase tracking-wide">Send test mail</p>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: "50%",        ms: "50" },
                          { label: "80%",        ms: "80" },
                          { label: "95%",        ms: "95" },
                          { label: "Day Before", ms: "day_before" },
                          { label: "Due Day",    ms: "due_day" },
                        ].map(({ label, ms }) => (
                          <button
                            key={ms}
                            onClick={() => sendReminder(d.id, true, ms)}
                            disabled={divBusy === d.id}
                            className="text-[11px] px-2 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 transition"
                          >
                            {divBusy === d.id ? "..." : label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {order.productionJob && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Production</p>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
              {order.productionJob.type}
            </span>
            <span className="text-sm text-slate-600">{order.productionJob.status.replace(/_/g, " ")}</span>
            {order.productionJob.notes && (
              <span className="text-xs text-slate-400">{order.productionJob.notes}</span>
            )}
          </div>
        </div>
      )}

      {order.stockCheck && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Stock Check</p>
          <div className="flex items-center gap-3 text-sm">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              order.stockCheck.status === "AVAILABLE"   ? "bg-green-100 text-green-700" :
              order.stockCheck.status === "UNAVAILABLE" ? "bg-red-100 text-red-700" :
              "bg-slate-100 text-slate-500"
            }`}>{order.stockCheck.status}</span>
            {order.stockCheck.notes && <span className="text-slate-500">{order.stockCheck.notes}</span>}
          </div>
        </div>
      )}

      {/* Packing List Approval */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Packing List Approval
          </p>
          {pis[0]?.productType === "GRANITE" && (
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full">PGI</span>
          )}
        </div>
        <PackingListMailClient orderId={order.id} />
      </div>

      {/* Commercial Invoice — filled by Commercial, generates PDF */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Commercial Invoice</p>
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
            pis[0]?.productType === "GRANITE"
              ? "bg-stone-100 text-stone-700"
              : "bg-sky-100 text-sky-700"
          }`}>
            {pis[0]?.productType ?? "QUARTZ"}
          </span>
        </div>
        <CommercialInvoiceClient
          orderId={order.id}
          orderNumber={order.orderNumber}
          invoiceNumber={(order as any).invoiceNumber ?? null}
          piNumber={pis[0]?.piNumber}
          productType={(pis[0]?.productType === "GRANITE" ? "GRANITE" : "QUARTZ")}
          currency={order.currency ?? "USD"}
          piItems={(pis[0]?.items as any[]) ?? []}
          spName={order.sp?.name ?? null}
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-4">
          Shipping Docs and Documents
        </p>
        <ShippingDocsClient orderId={order.id} piItems={(order.proformaInvoices[0]?.items as any[]) ?? []} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Port Arrival and Delivery
          </p>
          <button
            onClick={sendEtaReminder}
            disabled={divBusy === "eta"}
            className="text-xs px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-semibold hover:bg-blue-100 disabled:opacity-50 transition"
          >
            {divBusy === "eta" ? "Sending..." : "Send ETA Reminder"}
          </button>
        </div>
        <PortArrivalClient orderId={order.id} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Credit Notes</p>
          <button onClick={() => { setShowCNForm(s => !s); setCNMsg(""); }}
            className="text-xs text-amber-600 font-semibold border border-amber-200 px-2 py-1 rounded-lg hover:bg-amber-50 transition">
            + Issue Credit Note
          </button>
        </div>

        {showCNForm && (
          <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-5 space-y-3">
            <p className="text-xs font-bold text-amber-700">New Credit Note - {order.orderNumber}</p>
            <p className="text-xs text-amber-600">Raise this when goods are damaged or short-delivered. Once issued, the credit can be applied to the customer next order.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Reason *</label>
                <input value={cnForm.reason} onChange={e => setCNForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. 2 slabs broken on arrival"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                <input value={cnForm.description} onChange={e => setCNForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Item details, slab codes, etc."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Amount ({order.currency ?? "USD"}) *</label>
                <input type="number" min={0} step={0.01} value={cnForm.amount}
                  onChange={e => setCNForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                <input value={cnForm.notes} onChange={e => setCNForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Additional notes"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              </div>
            </div>
            {cnMsg && <p className="text-xs text-red-600">{cnMsg}</p>}
            <div className="flex gap-2">
              <button onClick={createCN} disabled={cnBusy}
                className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition">
                {cnBusy ? "Creating..." : "Create Credit Note"}
              </button>
              <button onClick={() => setShowCNForm(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        {availableCNs.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">
              Available Credits for {order.client.name}
            </p>
            <div className="space-y-2">
              {availableCNs.map(cn => (
                <div key={cn.id} className="flex items-center justify-between gap-3 border border-green-100 bg-green-50 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{cn.creditNumber}</span>
                      <span className="text-xs text-slate-400">from {cn.order?.orderNumber ?? "-"}</span>
                    </div>
                    <p className="text-xs text-slate-600 truncate">{cn.reason}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-bold text-green-800">{cn.currency} {cn.amount.toFixed(2)}</span>
                    <button
                      onClick={() => applyCN(cn.id)}
                      disabled={applyBusy === cn.id}
                      className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                      {applyBusy === cn.id ? "Applying..." : "Apply to this order"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {appliedCNs.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">
                Credits Applied to this Order
              </p>
              <span className="text-xs font-bold text-teal-700">
                - {currency} {totalAppliedCredit.toFixed(2)} total
              </span>
            </div>
            <div className="space-y-2">
              {appliedCNs.map(cn => (
                <div key={cn.id} className="flex items-center justify-between gap-3 border border-teal-100 bg-teal-50 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{cn.creditNumber}</span>
                      <span className="text-xs text-slate-400">from {cn.order?.orderNumber ?? "-"}</span>
                    </div>
                    <p className="text-xs text-slate-600 truncate">{cn.reason}</p>
                    {cn.appliedAt && (
                      <p className="text-xs text-slate-400">Applied {new Date(cn.appliedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-bold text-teal-800">- {cn.currency} {cn.amount.toFixed(2)}</span>
                    <button
                      onClick={() => unapplyCN(cn.id)}
                      disabled={applyBusy === cn.id}
                      className="text-xs px-2 py-0.5 text-slate-500 border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50 transition">
                      {applyBusy === cn.id ? "..." : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          {(creditNotes.length > 0 || availableCNs.length > 0 || appliedCNs.length > 0) && (
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Credit Notes on this Order
            </p>
          )}
          {creditNotes.length === 0 ? (
            <p className="text-xs text-slate-400">No credit notes issued for this order.</p>
          ) : (
            <div className="space-y-2">
              {creditNotes.map(cn => (
                <div key={cn.id} className="flex items-start justify-between gap-4 border border-slate-100 rounded-xl p-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-slate-900">{cn.creditNumber}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CN_COLORS[cn.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {cn.status.replace(/_/g, " ")}
                      </span>
                      {cn.appliedToOrderId && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
                          Applied to next order
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{cn.reason}</p>
                    {cn.description && <p className="text-xs text-slate-400 mt-0.5">{cn.description}</p>}
                    {cn.notes && <p className="text-xs text-slate-400 italic mt-0.5">{cn.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-slate-900">{cn.currency} {cn.amount.toFixed(2)}</p>
                    <p className="text-xs text-slate-400">{new Date(cn.createdAt).toLocaleDateString()}</p>
                    <div className="flex gap-1 mt-1 justify-end">
                      {cn.status === "PENDING_INSPECTION" && (
                        <button onClick={() => updateCN(cn.id, "INSPECTED")}
                          className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold hover:bg-blue-200 transition">
                          Mark Inspected
                        </button>
                      )}
                      {cn.status === "INSPECTED" && (
                        <button onClick={() => updateCN(cn.id, "ISSUED")}
                          className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded font-semibold hover:bg-green-200 transition">
                          Issue
                        </button>
                      )}
                      {(cn.status === "PENDING_INSPECTION" || cn.status === "INSPECTED") && (
                        <button onClick={() => updateCN(cn.id, "REJECTED")}
                          className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded font-semibold hover:bg-red-200 transition">
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {order.logs.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Activity</p>
          <div className="space-y-2">
            {order.logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 text-sm">
                <span className="text-xs text-slate-400 mt-0.5 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </span>
                <div>
                  <span className="font-medium text-slate-700">{log.action.replace(/_/g, " ")}</span>
                  {log.note && <span className="text-slate-400 ml-2">{log.note}</span>}
                  {log.user?.name && <span className="text-slate-400 ml-2">- {log.user.name}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
