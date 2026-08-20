"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/fab/postJson";
import { DOWNTIME_REASONS } from "@/lib/fab/downtimeReasons";
import type { FabProcessType } from "@/lib/fab/processSession";

interface OpenDown {
  id: string;
  reasonLabel: string;
  startedAt: string;
}

export function DowntimeBar({
  type,
  onError,
}: {
  type: FabProcessType;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState<OpenDown | null>(null);
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetch(`/api/fab/downtime?type=${type}&open=1`).then(x => x.json()).catch(() => []);
    const row = Array.isArray(r) ? r[0] : null;
    setOpen(row?.open ? {
      id: row.id,
      reasonLabel: row.reasonLabel,
      startedAt: row.startedAt,
    } : null);
  }

  useEffect(() => { void refresh(); }, [type]);

  async function start() {
    setBusy(true);
    const r = await postJson("/api/fab/downtime", { action: "start", processType: type, reason, notes });
    setBusy(false);
    if (!r.ok) { onError(r.error ?? "Could not start downtime."); return; }
    setPicking(false);
    setReason("");
    setNotes("");
    await refresh();
  }

  async function end() {
    setBusy(true);
    const r = await postJson("/api/fab/downtime", { action: "end", processType: type, id: open?.id });
    setBusy(false);
    if (!r.ok) { onError(r.error ?? "Could not end downtime."); return; }
    await refresh();
  }

  if (open) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
        <p className="text-sm text-red-800">
          <span className="font-semibold">Machine down</span>
          <span className="text-red-600"> · {open.reasonLabel}</span>
        </p>
        <button type="button" onClick={end} disabled={busy}
          className="text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
          {busy ? "…" : "End downtime"}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      {!picking ? (
        <div className="mb-4 bg-white border border-red-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-red-700 mb-2">Machine down?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={async () => {
              setReason("ELECTRICITY");
              setBusy(true);
              const r = await postJson("/api/fab/downtime", { action: "start", processType: type, reason: "ELECTRICITY" });
              setBusy(false);
              if (!r.ok) { onError(r.error ?? "Could not start downtime."); return; }
              await refresh();
            }}
              className="text-sm font-semibold bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg">
              Electricity
            </button>
            <button type="button" disabled={busy} onClick={async () => {
              setReason("BREAKDOWN");
              setBusy(true);
              const r = await postJson("/api/fab/downtime", { action: "start", processType: type, reason: "BREAKDOWN" });
              setBusy(false);
              if (!r.ok) { onError(r.error ?? "Could not start downtime."); return; }
              await refresh();
            }}
              className="text-sm font-semibold bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg">
              Breakdown
            </button>
            <button type="button" onClick={() => setPicking(true)}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg border border-slate-200">
              Other…
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Why is the machine down?</p>
          <div className="grid grid-cols-3 gap-2">
            {DOWNTIME_REASONS.map(r => (
              <button key={r.id} type="button" onClick={() => setReason(r.id)}
                className={`text-xs py-2 rounded-lg border ${
                  reason === r.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-gray-700 border-gray-200"
                }`}>
                {r.label}
              </button>
            ))}
          </div>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setPicking(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
            <button type="button" disabled={!reason || busy} onClick={start}
              className="text-xs font-semibold bg-red-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg">
              {busy ? "Saving…" : "Start downtime"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
