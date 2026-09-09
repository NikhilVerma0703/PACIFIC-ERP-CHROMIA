"use client";

// THE WHOLE PROJECT, AGREED ON A PHONE CALL — scripts/0067.
//
// The owner: "always have a custom free field for total, so when system feels
// heavy they call and enter the amount."
//
// The row-level override handles the ordinary case of one odd row. THIS is for
// the quote that was settled in a conversation before anybody opened a screen —
// the escape hatch of last resort, one figure that replaces everything under it.
//
// ─────────────────────── THE CALCULATION STAYS ON SCREEN ────────────────────
// Struck through, beside the figure that beat it. An override nobody can see
// past is how a wrong rate card survives a year; the whole value of keeping the
// calculation is that somebody eventually asks why the two differ.
//
// ─────────────────────── AND SO DOES THE REASON ─────────────────────────────
// The note is worth more than the number six months later. "Agreed with Fred on
// the phone, 12 Sep, includes the two L-shaped tops" is the difference between
// a figure you can defend and one nobody can explain.

import { useState } from "react";
import { formatRupees } from "@/lib/fab/pricing";

export function ProjectTotalBox({
  projectCode, calculated, manualTotal, manualNote, manualAt, manualBy, onSaved,
}: {
  projectCode: string;
  /** What the system worked out from the rows. */
  calculated: number;
  manualTotal?: number | null;
  manualNote?: string | null;
  manualAt?: string | null;
  manualBy?: string | null;
  onSaved?: (total: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<string>(manualTotal == null ? "" : String(manualTotal));
  const [note, setNote] = useState<string>(manualNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overridden = manualTotal != null;

  async function save(clear: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fab/project-total", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectCode,
          total: clear ? null : total,
          note: clear ? null : note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(String(data?.error ?? "Could not save.")); setBusy(false); return; }
      onSaved?.(clear ? null : Number(total));
      setOpen(false);
      if (clear) { setTotal(""); setNote(""); }
    } catch {
      setError("Could not reach the server — nothing was saved.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-2">
      {overridden ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs">
              <span className="font-semibold text-violet-900 tabular-nums">
                {formatRupees(manualTotal!)}
              </span>
              <span className="ml-2 text-[11px] text-violet-700">agreed for the project</span>
              {/* THE CALCULATION, KEPT. */}
              <span className="ml-2 text-[11px] text-violet-400 line-through tabular-nums">
                {formatRupees(calculated)}
              </span>
            </div>
            <button type="button" onClick={() => setOpen((o) => !o)}
              className="text-[11px] text-violet-700 hover:text-violet-900 font-medium">
              {open ? "close" : "change"}
            </button>
          </div>
          {manualNote && <p className="text-[11px] text-violet-800 mt-1">{manualNote}</p>}
          {(manualBy || manualAt) && (
            <p className="text-[10px] text-violet-500 mt-0.5">
              {manualBy ?? "someone"}{manualAt ? ` · ${new Date(manualAt).toLocaleDateString()}` : ""}
            </p>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="text-[11px] text-slate-400 hover:text-violet-700 font-medium transition">
          {open ? "close" : "enter an agreed total for this project"}
        </button>
      )}

      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 flex flex-col gap-2">
          <p className="text-[11px] text-slate-500">
            Replaces the whole calculated fabrication total for {projectCode}. The calculation is
            kept and shown beside it.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-medium text-slate-500">Agreed total</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-xs">₹</span>
                <input type="number" min={0} step="0.01" inputMode="decimal"
                  value={total} onChange={(e) => setTotal(e.target.value)} disabled={busy}
                  placeholder={String(calculated)}
                  className="w-36 text-sm tabular-nums rounded border border-slate-200 px-2 py-1 focus:border-violet-400 focus:outline-none disabled:opacity-50" />
              </div>
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-[14rem]">
              <label className="text-[10px] font-medium text-slate-500">Why (kept on the record)</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                disabled={busy} maxLength={500}
                placeholder="agreed with Fred on the phone, includes the two L-shaped tops"
                className="text-sm rounded border border-slate-200 px-2 py-1 focus:border-violet-400 focus:outline-none disabled:opacity-50" />
            </div>
          </div>
          {error && <p className="text-[11px] text-red-700">{error}</p>}
          <div className="flex items-center gap-2 justify-end">
            {overridden && (
              <button type="button" disabled={busy} onClick={() => void save(true)}
                title="Back to the calculated total. Clears the note and the signature with it."
                className="text-[11px] px-2 py-1 rounded text-slate-500 hover:text-slate-700 disabled:opacity-40">
                Use the calculation
              </button>
            )}
            <button type="button" disabled={busy || total.trim() === ""} onClick={() => void save(false)}
              className="text-[11px] font-semibold px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition">
              {busy ? "Saving…" : "Save the agreed total"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
