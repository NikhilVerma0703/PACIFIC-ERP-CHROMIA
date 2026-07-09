"use client";
/**
 * PackingListMailClient
 * Handles: send packing list to customer, mark accepted/rejected, resend.
 */
import { useEffect, useState } from "react";

type PLStatus = "PENDING_SEND" | "SENT" | "ACCEPTED" | "REJECTED";

type PLRecord = {
  status:          PLStatus;
  sentAt?:         string | null;
  notes?:          string | null;   // rejection reason (stored in notes via API)
};

const STATUS_CONFIG: Record<PLStatus, { label: string; color: string }> = {
  PENDING_SEND: { label: "Not Sent",  color: "bg-slate-100 text-slate-600" },
  SENT:         { label: "Sent — Awaiting Approval", color: "bg-blue-100 text-blue-700" },
  ACCEPTED:     { label: "Approved by Customer",     color: "bg-green-100 text-green-700" },
  REJECTED:     { label: "Rejected by Customer",     color: "bg-red-100 text-red-700" },
};

export default function PackingListMailClient({ orderId }: { orderId: string }) {
  const [pl,      setPL]      = useState<PLRecord | null>(null);
  const [loaded,  setLoaded]  = useState(false);
  const [sending, setSending] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [msg,     setMsg]     = useState<{ text: string; ok: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [revertTo, setRevertTo] = useState<"PACKING" | "PENDING_PRODUCTION">("PACKING");

  async function reload() {
    const r = await fetch(`/api/sales/orders/${orderId}/packing-list-email`);
    if (r.ok) setPL(await r.json());
    setLoaded(true);
  }

  useEffect(() => { reload(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendPL() {
    setSending(true); setMsg(null);
    const r = await fetch(`/api/sales/orders/${orderId}/packing-list-email`, { method: "POST" });
    const d = await r.json();
    setSending(false);
    if (!r.ok) { setMsg({ text: d.error ?? "Failed to send", ok: false }); return; }
    setMsg({ text: `Packing list sent to ${d.sentTo}`, ok: true });
    await reload();
  }

  async function markAction(action: "accept" | "reject") {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/sales/orders/${orderId}/packing-list-email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        reason:   action === "reject" ? rejectReason : undefined,
        revertTo: action === "reject" ? revertTo     : undefined,
      }),
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg({ text: d.error ?? "Failed", ok: false }); return; }
    setMsg({ text: action === "accept" ? "Marked as approved." : "Marked as rejected.", ok: true });
    setShowRejectForm(false);
    setRejectReason("");
    await reload();
  }

  if (!loaded) return <p className="text-xs text-slate-400 py-2">Loading...</p>;

  const status = (pl?.status ?? "PENDING_SEND") as PLStatus;
  const cfg    = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING_SEND;
  const canSend = status === "PENDING_SEND" || status === "REJECTED";

  return (
    <div className="space-y-4">
      {/* Status badge + send at */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
          {cfg.label}
        </span>
        {pl?.sentAt && (
          <span className="text-xs text-slate-400">
            Sent {new Date(pl.sentAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        )}
      </div>

      {/* Rejection reason */}
      {status === "REJECTED" && pl?.notes && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 text-xs text-red-700">
          <span className="font-semibold">Rejection reason: </span>{pl.notes}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Send / Resend */}
        <button
          onClick={sendPL}
          disabled={sending || (!canSend && status !== "SENT")}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition disabled:opacity-50 ${
            status === "REJECTED"
              ? "bg-amber-600 text-white hover:bg-amber-700"
              : "bg-teal-600 text-white hover:bg-teal-700"
          }`}
        >
          {sending ? "Sending…" : status === "SENT" ? "Resend PL" : status === "REJECTED" ? "Resend Updated PL" : "Send Packing List"}
        </button>

        {/* Accept button — only show when SENT */}
        {status === "SENT" && (
          <button
            onClick={() => markAction("accept")}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
          >
            {busy ? "…" : "Mark Approved"}
          </button>
        )}

        {/* Reject button — only show when SENT */}
        {status === "SENT" && !showRejectForm && (
          <button
            onClick={() => setShowRejectForm(true)}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition"
          >
            Mark Rejected
          </button>
        )}

        {/* Re-mark as pending if accepted */}
        {status === "ACCEPTED" && (
          <button
            onClick={sendPL}
            disabled={sending}
            className="px-4 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
          >
            {sending ? "Sending…" : "Resend"}
          </button>
        )}
      </div>

      {/* Reject form */}
      {showRejectForm && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-red-700">Customer Rejection — Action Required</p>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="What changes did the customer request?"
            rows={2}
            className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white resize-none"
          />
          {/* Revert destination picker */}
          <div>
            <p className="text-[11px] font-semibold text-red-700 mb-1.5">Where should this order go after rejection?</p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setRevertTo("PACKING")}
                className={`px-3 py-1.5 text-xs rounded-lg border transition font-medium ${
                  revertTo === "PACKING"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-amber-50"
                }`}
              >
                🔁 Back to Packing <span className="font-normal">(re-arrange)</span>
              </button>
              <button
                type="button"
                onClick={() => setRevertTo("PENDING_PRODUCTION")}
                className={`px-3 py-1.5 text-xs rounded-lg border transition font-medium ${
                  revertTo === "PENDING_PRODUCTION"
                    ? "bg-purple-600 text-white border-purple-600"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-purple-50"
                }`}
              >
                🏭 Back to Production <span className="font-normal">(restart)</span>
              </button>
            </div>
            <p className="text-[10px] text-red-500 mt-1">
              {revertTo === "PACKING"
                ? "Order stays in Packing — re-arrange and resend the packing list."
                : "Order reverts to Pending Production — a new production job will be required."}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => markAction("reject")}
              disabled={busy}
              className="px-4 py-2 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
            >
              {busy ? "Saving…" : "Confirm Rejection"}
            </button>
            <button
              onClick={() => { setShowRejectForm(false); setRejectReason(""); setRevertTo("PACKING"); }}
              className="px-4 py-2 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className={`text-xs font-medium ${msg.ok ? "text-green-600" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}

      <p className="text-[10px] text-slate-400">
        The packing list PDF (uploaded or auto-generated) is attached to this email.
        After customer approves, proceed with dispatch.
      </p>
    </div>
  );
}
