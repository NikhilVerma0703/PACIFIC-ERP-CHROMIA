"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";

type PortArrival = {
  id: string;
  orderId: string;
  arrivalDate: string | null;
  freeDays: number | null;
  freeDaysExpiry: string | null;
  cadCleared: boolean;
  deliveryStatus: "PENDING" | "CLEARED" | "OVERRIDE" | "DELIVERED";
  overrideNote: string | null;
  overrideAt: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  PENDING:   "Pending Clearance",
  CLEARED:   "Customs Cleared",
  OVERRIDE:  "Override",
  DELIVERED: "Delivered to Buyer",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:   "bg-amber-100 text-amber-700",
  CLEARED:   "bg-lime-100 text-lime-700",
  OVERRIDE:  "bg-purple-100 text-purple-700",
  DELIVERED: "bg-green-100 text-green-700",
};

const inp = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500";

export default function PortArrivalClient({ orderId }: { orderId: string }) {
  const [pa, setPa] = useState<PortArrival | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    arrivalDate: "",
    freeDays: "",
    freeDaysExpiry: "",
    cadCleared: false,
    deliveryStatus: "PENDING",
    overrideNote: "",
  });

  useEffect(() => {
    fetch(`/api/sales/orders/${orderId}/port-arrival`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setPa(data);
          setForm({
            arrivalDate:    data.arrivalDate    ? data.arrivalDate.slice(0, 10)    : "",
            freeDays:       data.freeDays       != null ? String(data.freeDays)    : "",
            freeDaysExpiry: data.freeDaysExpiry ? data.freeDaysExpiry.slice(0, 10) : "",
            cadCleared:     data.cadCleared     ?? false,
            deliveryStatus: data.deliveryStatus ?? "PENDING",
            overrideNote:   data.overrideNote   ?? "",
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orderId]);

  async function save() {
    setSaving(true); setMsg("");
    const method = pa ? "PATCH" : "POST";
    const body = {
      arrivalDate:    form.arrivalDate    || null,
      freeDays:       form.freeDays       ? Number(form.freeDays) : null,
      freeDaysExpiry: form.freeDaysExpiry || null,
      cadCleared:     form.cadCleared,
      deliveryStatus: form.deliveryStatus,
      overrideNote:   form.overrideNote   || null,
    };
    const r = await fetch(`/api/sales/orders/${orderId}/port-arrival`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (r.ok) {
      setPa(data);
      setMsg("Saved.");
      setShowForm(false);
    } else {
      setMsg(data.error || "Save failed");
    }
    setSaving(false);
  }

  if (loading) return <p className="text-xs text-slate-400">Loading port arrival…</p>;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      {pa ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_COLORS[pa.deliveryStatus]}`}>
            {STATUS_LABELS[pa.deliveryStatus]}
          </span>
          {pa.cadCleared && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-700">
              CAD Cleared
            </span>
          )}
          {pa.arrivalDate && (
            <span className="text-xs text-slate-500">
              Arrived: {new Date(pa.arrivalDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          )}
          {pa.freeDays != null && (
            <span className="text-xs text-slate-500">
              Free Days: {pa.freeDays}
              {pa.freeDaysExpiry ? ` (exp. ${new Date(pa.freeDaysExpiry).toLocaleDateString("en-GB")})` : ""}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No port arrival record yet.</p>
      )}

      {pa?.overrideNote && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 text-xs text-purple-700">
          <span className="font-semibold">Override note:</span> {pa.overrideNote}
          {pa.overrideAt && <span className="ml-2 text-purple-400">({new Date(pa.overrideAt).toLocaleDateString("en-GB")})</span>}
        </div>
      )}

      {/* Toggle form */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="text-xs text-teal-600 font-semibold hover:underline"
        >
          {pa ? "✏️ Edit Port Arrival" : "+ Record Port Arrival"}
        </button>
      )}

      {showForm && (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-4">
          <p className="text-xs font-bold text-slate-700">{pa ? "Update" : "Record"} Port Arrival</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Arrival Date</label>
              <input type="date" className={inp} value={form.arrivalDate}
                onChange={e => setForm(f => ({ ...f, arrivalDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Free Days</label>
              <input type="number" min={0} className={inp} placeholder="e.g. 14"
                value={form.freeDays}
                onChange={e => setForm(f => ({ ...f, freeDays: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Free Days Expiry</label>
              <input type="date" className={inp} value={form.freeDaysExpiry}
                onChange={e => setForm(f => ({ ...f, freeDaysExpiry: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Delivery Status</label>
              <select className={inp} value={form.deliveryStatus}
                onChange={e => setForm(f => ({ ...f, deliveryStatus: e.target.value }))}>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="cad" checked={form.cadCleared}
              onChange={e => setForm(f => ({ ...f, cadCleared: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
            <label htmlFor="cad" className="text-sm text-slate-700">CAD Documents Cleared</label>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Override Note (optional)</label>
            <input type="text" className={inp} placeholder="Reason for override / manual clearance"
              value={form.overrideNote}
              onChange={e => setForm(f => ({ ...f, overrideNote: e.target.value }))} />
          </div>

          {msg && <p className="text-xs text-teal-700">{msg}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50">
              {saving ? "Saving…" : "Save Port Arrival"}
            </button>
            <button onClick={() => { setShowForm(false); setMsg(""); }}
              className="text-sm text-slate-500 px-4 py-2 hover:text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
