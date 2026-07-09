"use client";
import { useState } from "react";

// Direct path: stock available → straight to packing
const FLOW_DIRECT = [
  "PENDING_PAYMENT",
  "PENDING_STOCK_CHECK",
  "PACKING",
  "DISPATCHED",
  "IN_TRANSIT",
  "PORT_ARRIVED",
  "DELIVERED",
] as const;

// Production path: stock unavailable → production → packing
const FLOW_PRODUCTION = [
  "PENDING_PAYMENT",
  "PENDING_STOCK_CHECK",
  "PENDING_PRODUCTION",
  "IN_PRODUCTION",
  "PACKING",
  "DISPATCHED",
  "IN_TRANSIT",
  "PORT_ARRIVED",
  "DELIVERED",
] as const;

type FlowStatus = typeof FLOW_DIRECT[number] | typeof FLOW_PRODUCTION[number];

const LABELS: Record<string, string> = {
  PENDING_PAYMENT:    "Pending\nPayment",
  PENDING_STOCK_CHECK:"Stock\nCheck",
  PENDING_PRODUCTION: "Pending\nProduction",
  IN_PRODUCTION:      "In\nProduction",
  PACKING:            "Packing",
  DISPATCHED:         "Dispatched",
  IN_TRANSIT:         "In\nTransit",
  PORT_ARRIVED:       "Port\nArrived",
  DELIVERED:          "Delivered",
  CANCELLED:          "Cancelled",
};

const SHORT: Record<string, string> = {
  PENDING_PAYMENT:    "Payment",
  PENDING_STOCK_CHECK:"Stock Check",
  PENDING_PRODUCTION: "Pending Prod.",
  IN_PRODUCTION:      "In Production",
  PACKING:            "Packing",
  DISPATCHED:         "Dispatch",
  IN_TRANSIT:         "In Transit",
  PORT_ARRIVED:       "Port",
  DELIVERED:          "Delivered",
};

// Status descriptions shown to SP
const DESCRIPTIONS: Record<string, string> = {
  PENDING_PAYMENT:    "Waiting for advance payment from accounts.",
  PENDING_STOCK_CHECK:"Advance received — commercial team is checking stock availability.",
  PENDING_PRODUCTION: "Stock unavailable — order sent to production.",
  IN_PRODUCTION:      "Production is in progress.",
  PACKING:            "Stock confirmed — commercial team is preparing the packing list.",
  DISPATCHED:         "Order dispatched from warehouse.",
  IN_TRANSIT:         "Shipment is in transit.",
  PORT_ARRIVED:       "Shipment has arrived at destination port.",
  DELIVERED:          "Order successfully delivered.",
};

export default function StatusFlowClient({
  orderId,
  status: initialStatus,
  hasProductionJob,
  onStatusChange,
}: {
  orderId: string;
  status: string;
  hasProductionJob?: boolean;
  onStatusChange?: (newStatus: string) => void;
}) {
  const [status, setStatus]     = useState(initialStatus);
  const [note, setNote]         = useState("");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState("");
  const [errCode, setErrCode]   = useState("");
  const [showNote, setShowNote] = useState(false);

  // Choose flow based on whether a production job exists
  const isProductionPath =
    hasProductionJob ||
    status === "PENDING_PRODUCTION" ||
    status === "IN_PRODUCTION";

  const FLOW = isProductionPath ? FLOW_PRODUCTION : FLOW_DIRECT;

  const idx        = FLOW.indexOf(status as any);
  const nextIdx    = idx >= 0 && idx < FLOW.length - 1 ? idx + 1 : -1;
  const nextStatus = nextIdx >= 0 ? FLOW[nextIdx] : null;
  const isFinal    = status === "DELIVERED" || status === "CANCELLED";

  // SP can only manually advance from PACKING onward (earlier transitions are automatic)
  const canManuallyAdvance = ["PACKING", "DISPATCHED", "IN_TRANSIT", "PORT_ARRIVED"].includes(status);

  async function advance(target: string) {
    setBusy(true); setErr(""); setErrCode("");
    const r = await fetch(`/api/sales/orders/${orderId}/status`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: target, note: note || undefined }),
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) {
      setErr(d.error ?? "Failed");
      setErrCode(d.code ?? "");
      return;
    }
    setStatus(target);
    setNote("");
    setShowNote(false);
    onStatusChange?.(target);
  }

  const row1 = isProductionPath ? FLOW_PRODUCTION.slice(0, 5) : FLOW_DIRECT.slice(0, 3);
  const row2 = isProductionPath ? FLOW_PRODUCTION.slice(5)    : FLOW_DIRECT.slice(3);

  function StepCircle({ step }: { step: string }) {
    const globalIdx = FLOW.indexOf(step as any);
    const state =
      globalIdx < idx  ? "done" :
      globalIdx === idx ? "current" : "future";
    const stepNum = globalIdx + 1;

    return (
      <div className="flex flex-col items-center gap-1.5 min-w-0">
        <div className={[
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition",
          state === "done"    ? "bg-teal-500 border-teal-500 text-white" : "",
          state === "current" ? "bg-white border-teal-500 text-teal-700 ring-4 ring-teal-100" : "",
          state === "future"  ? "bg-slate-100 border-slate-300 text-slate-400" : "",
        ].join(" ")}>
          {state === "done" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ) : stepNum}
        </div>
        <span className={[
          "text-[9px] font-medium text-center leading-tight max-w-[52px]",
          state === "done"    ? "text-teal-600" : "",
          state === "current" ? "text-teal-700 font-semibold" : "",
          state === "future"  ? "text-slate-400" : "",
        ].join(" ")}>
          {SHORT[step]}
        </span>
      </div>
    );
  }

  function Connector({ fromIdx }: { fromIdx: number }) {
    const filled = idx > fromIdx;
    return (
      <div className={[
        "flex-1 h-0.5 mt-4 mx-1 rounded-full transition",
        filled ? "bg-teal-400" : "bg-slate-200",
      ].join(" ")} />
    );
  }

  return (
    <div className="space-y-4">
      {/* Current status description */}
      {!isFinal && DESCRIPTIONS[status] && (
        <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 text-xs text-teal-800">
          <span className="font-semibold">{SHORT[status] ?? status}:</span>{" "}
          {DESCRIPTIONS[status]}
        </div>
      )}

      {/* Visual stepper */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        {status === "CANCELLED" ? (
          <div className="flex items-center gap-2 py-1">
            <div className="w-9 h-9 rounded-full bg-red-100 border-2 border-red-300 flex items-center justify-center">
              <span className="text-red-500 text-sm font-bold">✕</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-red-700">Order Cancelled</p>
              <p className="text-xs text-red-400">This order has been cancelled.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mb-2 ml-1">
                Pre-Dispatch
              </p>
              <div className="flex items-start">
                {row1.map((step, i) => (
                  <div key={step} className="flex items-start flex-1">
                    <StepCircle step={step} />
                    {i < row1.length - 1 && <Connector fromIdx={FLOW.indexOf(step as any)} />}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mb-2 ml-1">
                Shipment
              </p>
              <div className="flex items-start">
                {row2.map((step, i) => (
                  <div key={step} className="flex items-start flex-1">
                    <StepCircle step={step} />
                    {i < row2.length - 1 && <Connector fromIdx={FLOW.indexOf(step as any)} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons — only for states SP manually advances */}
      {!isFinal && canManuallyAdvance && nextStatus && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => advance(nextStatus)}
            disabled={busy}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
          >
            {busy ? "Updating…" : `→ Mark as ${SHORT[nextStatus]}`}
          </button>
          <button
            onClick={() => setShowNote(s => !s)}
            className="px-3 py-2 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            {showNote ? "Hide note" : "+ Add note"}
          </button>
          {status !== "CANCELLED" && (
            <button
              onClick={() => { if (confirm("Cancel this order?")) advance("CANCELLED"); }}
              disabled={busy}
              className="px-3 py-2 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50 transition"
            >
              Cancel Order
            </button>
          )}
        </div>
      )}

      {showNote && (
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional note for activity log…"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      )}

      {err && (
        errCode === "ADVANCE_UNPAID" ? (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
            <span className="text-base">⚠️</span>
            <div>
              <p className="font-semibold">Advance payment not yet received</p>
              <p className="mt-0.5 text-amber-700">
                Mark the advance as paid in the Payments section before moving to Packing.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-red-500">{err}</p>
        )
      )}

      {isFinal && status === "DELIVERED" && (
        <p className="text-xs text-teal-600 font-medium">✓ Order delivered successfully.</p>
      )}
    </div>
  );
}
