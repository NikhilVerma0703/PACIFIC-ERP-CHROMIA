"use client";

// Send a failed slab out, and record it coming back.
//
// The send form asks for a facility and an expected return date because those
// two fields are the whole difference between this and the Excel remark column:
// without them a slab is "sent" and nothing more, which is precisely the state
// the module exists to end. Neither is forced — a genuine send with no date
// committed should still be recordable — but both are visibly missing on the
// tracking screen when they are left out.

import { useState, useTransition } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import {
  receiveFromRecalibration, restartAfterRecalibration, sendForRecalibration,
} from "@/lib/chromia/actions";
import { MAX_RECALIBRATION_ATTEMPTS } from "@/lib/chromia/process";

export interface Candidate {
  id: string;
  slabNo: string;
  batchNo: string;
  grade: string | null;
  recalibrationCount: number;
  thicknessMm: string | null;
}

export interface Outstanding {
  id: string;
  slabNo: string;
  attemptNumber: number;
  facilityName: string | null;
  daysOut: number | null;
  overdue: boolean;
  received: boolean;
  restarted: boolean;
}

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btn = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

export function RecalibrationPanel({
  candidates, outstanding, reasons,
}: {
  candidates: Candidate[];
  outstanding: Outstanding[];
  reasons: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [sendFor, setSendFor] = useState<Candidate | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    start(async () => {
      const r = await fn();
      setNote({ text: r.ok ? (r.message ?? "Done.") : (r.error ?? "That did not work."), ok: r.ok });
      if (r.ok) setSendFor(null);
    });
  };

  return (
    <div className="space-y-5">
      {note && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            note.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {note.text}
        </div>
      )}

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          1 · Rejected slabs that can be sent
        </h2>
        {candidates.length === 0 ? (
          <Empty>No graded-C slab is waiting to be sent.</Empty>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => {
              const left = MAX_RECALIBRATION_ATTEMPTS - c.recalibrationCount;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-gray-50 pb-2 last:border-0">
                  <span className="w-28 shrink-0 font-medium text-gray-900">{c.slabNo}</span>
                  <span className="w-24 shrink-0 text-sm text-gray-500">{c.batchNo}</span>
                  <span className="text-sm text-gray-600">
                    {c.recalibrationCount} done
                    {/* The count Excel could not keep: is this slab on its first
                        pass or its fourth? */}
                    <span className={left <= 1 ? "ml-1 text-red-600" : "ml-1 text-gray-400"}>
                      ({left} left)
                    </span>
                  </span>
                  {c.thicknessMm && (
                    <span className="text-sm text-gray-500">{c.thicknessMm} mm</span>
                  )}
                  <button
                    type="button"
                    className={`${btnGhost} ml-auto`}
                    onClick={() => setSendFor(sendFor?.id === c.id ? null : c)}
                  >
                    {sendFor?.id === c.id ? "Cancel" : "Send out"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {sendFor && (
          <SendForm
            slab={sendFor}
            reasons={reasons}
            pending={pending}
            onSubmit={(input) => run(() => sendForRecalibration(sendFor.id, input))}
          />
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          2 · Out now · {outstanding.filter((o) => !o.received).length}
        </h2>
        {outstanding.length === 0 ? (
          <Empty>Nothing is out for recalibration.</Empty>
        ) : (
          <div className="space-y-2">
            {outstanding.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 border-b border-gray-50 pb-2 last:border-0">
                <span className="w-28 shrink-0 font-medium text-gray-900">{o.slabNo}</span>
                <span className="shrink-0 text-sm text-gray-500">attempt #{o.attemptNumber}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-500">
                  {o.facilityName ?? "facility not recorded"}
                </span>
                <span className="text-sm text-gray-600">
                  {o.daysOut == null ? "not sent" : `${o.daysOut}d`}
                </span>
                {o.overdue && <Badge tone="red">overdue</Badge>}

                {!o.received ? (
                  <button
                    type="button" disabled={pending} className={btnGhost}
                    onClick={() => run(() => receiveFromRecalibration(o.id))}
                  >
                    Receive back
                  </button>
                ) : o.restarted ? (
                  <Badge tone="green">restarted</Badge>
                ) : (
                  // Received is not the same as back on the line. Keeping them
                  // apart is what stops a slab sitting in the yard being counted
                  // as production.
                  <button
                    type="button" disabled={pending} className={btnGhost}
                    onClick={() => run(() => restartAfterRecalibration(o.id))}
                  >
                    Put back on the line
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SendForm({
  slab, reasons, pending, onSubmit,
}: {
  slab: Candidate;
  reasons: { id: string; name: string }[];
  pending: boolean;
  onSubmit: (input: {
    reasonId?: string | null; reasonNotes?: string; facilityName?: string;
    expectedReturnDate?: Date | null; gatePassNo?: string; transporter?: string;
    vehicleNo?: string; thicknessBeforeMm?: number | null;
  }) => void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [facilityName, setFacility] = useState("");
  const [expected, setExpected] = useState("");
  const [gatePassNo, setGatePass] = useState("");
  const [transporter, setTransporter] = useState("");
  const [vehicleNo, setVehicle] = useState("");
  const [thickness, setThickness] = useState(slab.thicknessMm ?? "");

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <p className="mb-3 text-sm font-medium text-gray-900">Send {slab.slabNo} out</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block">
          <span className={label}>Reason</span>
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={inp}>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className={label}>What was wrong with it</span>
          <input
            value={reasonNotes} onChange={(e) => setReasonNotes(e.target.value)}
            placeholder="e.g. half print, red colour off" className={inp}
          />
        </label>
        <label className="block">
          <span className={label}>Facility</span>
          <input
            value={facilityName} onChange={(e) => setFacility(e.target.value)}
            placeholder="who is doing the work" className={inp}
          />
        </label>
        <label className="block">
          <span className={label}>Expected back</span>
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inp} />
        </label>
        <label className="block">
          <span className={label}>Thickness now (mm)</span>
          <input
            type="number" step="0.001" value={thickness}
            onChange={(e) => setThickness(e.target.value)} className={inp}
          />
        </label>
        <label className="block">
          <span className={label}>Gate pass</span>
          <input value={gatePassNo} onChange={(e) => setGatePass(e.target.value)} className={inp} />
        </label>
        <label className="block">
          <span className={label}>Transporter</span>
          <input value={transporter} onChange={(e) => setTransporter(e.target.value)} className={inp} />
        </label>
        <label className="block">
          <span className={label}>Vehicle</span>
          <input value={vehicleNo} onChange={(e) => setVehicle(e.target.value)} className={inp} />
        </label>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        A facility and an expected date are what make this trackable — without them the tracking
        screen can only say the slab is gone.
      </p>
      <button
        type="button" disabled={pending} className={`${btn} mt-3`}
        onClick={() =>
          onSubmit({
            reasonId: reasonId || null,
            reasonNotes: reasonNotes || undefined,
            facilityName: facilityName || undefined,
            expectedReturnDate: expected ? new Date(`${expected}T00:00:00`) : null,
            gatePassNo: gatePassNo || undefined,
            transporter: transporter || undefined,
            vehicleNo: vehicleNo || undefined,
            thicknessBeforeMm: thickness ? Number(thickness) : null,
          })
        }
      >
        {pending ? "Sending…" : "Record the send"}
      </button>
    </div>
  );
}
