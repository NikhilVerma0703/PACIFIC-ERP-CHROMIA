"use client";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type PIItem = { colour?: string; description?: string; material?: string; finish?: string; thickness?: string; qty?: number; noOfSlabs?: number; unit?: string; unitPrice: number; sqft?: number; amount?: number };
type PIRevision = { id: string; revisionNo: number; reason: string | null; customerRemarks: string | null; sentAt: string | null; createdAt: string; createdBy?: { name: string | null } };
type PI = {
  id: string; piNumber: string; status: string; currency: string; productType?: string;
  totalAmount: number; validityDays: number | null;
  deliveryTerms: string | null; paymentTermsSummary: string | null;
  portOfLoading: string | null; portOfDischarge: string | null;
  notes: string | null; createdAt: string; sentAt: string | null; acceptedAt: string | null;
  rejectionCount: number; revisionCount?: number;
  items: PIItem[];
  client: { name: string; email: string | null; country: string | null; contactPerson: string | null };
  sp: { name: string | null; email: string };
  order: { id: string; orderNumber: string } | null;
  rejectionLogs: { id: string; reason: string | null; rejectedAt: string }[];
  revisions?: PIRevision[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT:          "bg-slate-100 text-slate-600",
  SENT:           "bg-blue-100 text-blue-700",
  UNDER_REVISION: "bg-amber-100 text-amber-700",
  ACCEPTED:       "bg-green-100 text-green-700",
  REJECTED:       "bg-red-100 text-red-700",
};

export default function PIDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [pi, setPi]           = useState<PI | null>(null);
  const [loading, setLoading]  = useState(true);
  const [busy, setBusy]        = useState("");
  const [msg, setMsg]          = useState("");

  // Revision request panel
  const [showRevision, setShowRevision]   = useState(false);
  const [revReason, setRevReason]         = useState("");
  const [revCustomer, setRevCustomer]     = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/sales/pi/${id}`);
    if (r.ok) setPi(await r.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, [id]);

  async function action(endpoint: string, body?: object) {
    setBusy(endpoint); setMsg("");
    const r = await fetch(`/api/sales/pi/${id}/${endpoint}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    setBusy("");
    if (!r.ok) { setMsg(`Error: ${d.error ?? "Failed"}`); return; }
    await load();
    const msgs: Record<string, string> = {
      send:     "PI sent to client!",
      resend:   "Revised PI re-sent to client!",
      accept:   "Marked as accepted.",
      reject:   "Returned to draft.",
      revision: "Marked as Under Revision.",
    };
    if (msgs[endpoint]) setMsg(msgs[endpoint]);
  }

  async function createOrder() {
    setBusy("order"); setMsg("");
    const r = await fetch("/api/sales/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ piId: id }),
    });
    const d = await r.json();
    setBusy("");
    if (!r.ok) { setMsg(`Error: ${d.error ?? "Failed"}`); return; }
    router.push(`/sales/orders/${d.id}`);
  }

  async function requestRevision() {
    await action("revision", { reason: revReason, customerRemarks: revCustomer });
    setShowRevision(false);
    setRevReason(""); setRevCustomer("");
  }

  if (loading) return <div className="text-sm text-slate-400 py-12 text-center">Loading…</div>;
  if (!pi)     return <div className="text-sm text-red-500 py-12 text-center">PI not found.</div>;

  const items      = (pi.items as PIItem[]) ?? [];
  const canSend    = pi.status === "DRAFT";
  const canResend  = pi.status === "UNDER_REVISION";
  const canAccept  = pi.status === "SENT";
  const canRevision= pi.status === "SENT" || pi.status === "UNDER_REVISION";
  const canOrder   = pi.status === "ACCEPTED" && !pi.order;
  const canEdit    = pi.status === "DRAFT" || pi.status === "UNDER_REVISION";
  const revCount   = pi.revisionCount ?? pi.rejectionCount ?? 0;

  const allRevisions: PIRevision[] = pi.revisions?.length
    ? pi.revisions
    : pi.rejectionLogs.map(l => ({
        id: l.id, revisionNo: 0, reason: l.reason,
        customerRemarks: null, sentAt: null, createdAt: l.rejectedAt,
      }));

  return (
    <div className="max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/sales/pi" className="text-slate-400 hover:text-slate-600 text-sm">← PIs</Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm text-slate-700 font-medium">{pi.piNumber}</span>
        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[pi.status] ?? ""}`}>
          {pi.status.replace("_", " ")}
        </span>
        {pi.productType && pi.productType !== "QUARTZ" && (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
            {pi.productType}
          </span>
        )}
        {revCount > 0 && (
          <span className="text-xs text-amber-600 font-medium">Rev #{revCount}</span>
        )}
      </div>

      {/* UNDER_REVISION banner */}
      {pi.status === "UNDER_REVISION" && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <span className="text-xl">✏️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Under Revision — Revision #{revCount}</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Edit the PI items and terms below, then click <strong>Resend to Client</strong>.
            </p>
            {allRevisions[0]?.reason && (
              <p className="text-xs text-amber-700 mt-1">Customer note: {allRevisions[0].reason}</p>
            )}
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{pi.piNumber}</h2>
            <p className="text-sm text-slate-500">{pi.client.name}{pi.client.country ? ` · ${pi.client.country}` : ""}</p>
            {pi.client.contactPerson && (
              <p className="text-xs text-slate-400">{pi.client.contactPerson} · {pi.client.email ?? ""}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-900">
              {pi.currency} {pi.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-slate-400">
              Valid {pi.validityDays ?? 30} days from {new Date(pi.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm border-t border-slate-100 pt-4">
          {([
            ["Delivery Terms",    pi.deliveryTerms],
            ["Port of Loading",   pi.portOfLoading],
            ["Port of Discharge", pi.portOfDischarge],
            ["Payment Terms",     pi.paymentTermsSummary],
            ["Salesperson",       pi.sp.name],
            ["Sent",              pi.sentAt ? new Date(pi.sentAt).toLocaleDateString() : "—"],
          ] as [string, string | null][]).map(([label, val]) => (
            <div key={label}>
              <p className="text-xs text-slate-400">{label}</p>
              <p className="font-medium text-slate-700">{val ?? "—"}</p>
            </div>
          ))}
        </div>
        {pi.notes && (
          <p className="mt-4 text-sm text-slate-500 border-t border-slate-100 pt-3">{pi.notes}</p>
        )}
      </div>

      {/* Items */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Line Items</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {["Colour / Description","Thickness","Slabs","Qty (SQFT)","Unit Price","Total"].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const qty  = item.sqft ?? item.qty ?? 0;
              const slabs = item.noOfSlabs ?? 0;
              const price = Number(item.unitPrice ?? 0);
              const total = Number(item.amount ?? qty * price);
              return (
                <tr key={i} className="border-b border-slate-50">
                  <td className="px-4 py-2.5 text-slate-800">{item.colour || item.description || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{item.thickness ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{slabs > 0 ? slabs : "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{Number(qty).toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{pi.currency} {price.toFixed(3)}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{pi.currency} {total.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 border-t border-slate-200">
            <tr>
              <td colSpan={5} className="px-4 py-2 text-right font-semibold text-slate-700 text-sm">Grand Total</td>
              <td className="px-4 py-2 font-bold text-slate-900">{pi.currency} {pi.totalAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Actions</p>
        <div className="flex flex-wrap gap-3">
          <a href={`/api/sales/pi/${id}/pdf`} target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200 transition">
            ⬇ Download PI PDF
          </a>

          {canSend && (
            <button onClick={() => action("send")} disabled={busy === "send"}
              className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand-dark disabled:opacity-50 transition">
              {busy === "send" ? "Sending…" : "📧 Send to Client"}
            </button>
          )}

          {canResend && (
            <button onClick={() => action("resend")} disabled={busy === "resend"}
              className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand-dark disabled:opacity-50 transition">
              {busy === "resend" ? "Sending…" : "📧 Resend Revised PI"}
            </button>
          )}

          {canAccept && (
            <button onClick={() => action("accept")} disabled={busy === "accept"}
              className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
              {busy === "accept" ? "…" : "✓ Mark Accepted"}
            </button>
          )}

          {canRevision && !showRevision && (
            <button onClick={() => setShowRevision(true)}
              className="px-4 py-2 bg-amber-100 text-amber-700 text-sm font-semibold rounded-lg hover:bg-amber-200 transition">
              ✏️ Request Revision
            </button>
          )}

          {canEdit && (
            <Link href={`/sales/pi/new?copy=${id}`}
              className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-200 transition">
              ✏️ Edit / Copy
            </Link>
          )}

          {canOrder && (
            <button onClick={createOrder} disabled={busy === "order"}
              className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand-dark disabled:opacity-50 transition">
              {busy === "order" ? "Creating…" : "📋 Create Order"}
            </button>
          )}

          {pi.order && (
            <Link href={`/sales/orders/${pi.order.id}`}
              className="px-4 py-2 bg-brand/10 text-brand text-sm font-semibold rounded-lg hover:bg-brand/20 transition">
              View Order {pi.order.orderNumber} →
            </Link>
          )}
        </div>

        {/* Revision request form */}
        {showRevision && (
          <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-200">
            <p className="text-xs font-semibold text-amber-800 mb-3">Request Revision</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-amber-700 font-medium">Customer remarks / reason</label>
                <textarea
                  value={revCustomer}
                  onChange={e => setRevCustomer(e.target.value)}
                  rows={2}
                  placeholder="What did the customer say / request?"
                  className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none mt-1 bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-amber-700 font-medium">Internal note (what to change)</label>
                <textarea
                  value={revReason}
                  onChange={e => setRevReason(e.target.value)}
                  rows={2}
                  placeholder="e.g. Customer wants 3CM pricing, update sqft..."
                  className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none mt-1 bg-white"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={requestRevision}
                disabled={busy === "revision"}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition">
                {busy === "revision" ? "…" : "Mark Under Revision"}
              </button>
              <button onClick={() => setShowRevision(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:underline">
                Cancel
              </button>
            </div>
          </div>
        )}

        {msg && (
          <p className={`mt-3 text-sm font-medium ${msg.startsWith("Error") ? "text-red-500" : "text-green-600"}`}>
            {msg}
          </p>
        )}
      </div>

      {/* Revision / rejection history */}
      {allRevisions.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Revision History</p>
          <div className="space-y-2">
            {allRevisions.map((log, i) => (
              <div key={log.id ?? i} className="flex gap-3 text-sm py-2 border-b border-slate-50 last:border-0">
                <span className="text-slate-400 text-xs pt-0.5 w-24 flex-shrink-0">
                  {new Date(log.createdAt).toLocaleDateString()}
                </span>
                <div className="flex-1">
                  {log.revisionNo > 0 && (
                    <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded mr-2">
                      Rev #{log.revisionNo}
                    </span>
                  )}
                  {log.customerRemarks && (
                    <p className="text-slate-600">Customer: {log.customerRemarks}</p>
                  )}
                  {log.reason && (
                    <p className="text-slate-500 text-xs">Internal: {log.reason}</p>
                  )}
                  {log.sentAt && (
                    <p className="text-xs text-green-600 mt-0.5">
                      Re-sent: {new Date(log.sentAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
