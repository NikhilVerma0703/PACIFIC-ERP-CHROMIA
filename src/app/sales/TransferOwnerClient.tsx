"use client";
// Ownership transfer control — renders ONLY for the Sales Admin (super-owner).
// Mounted on the PI / order detail pages; hands the record to another
// salesperson via POST /api/sales/transfer.
import { useEffect, useState } from "react";

type Sp = { id: string; name: string | null; email: string };

export function TransferOwnerClient({ type, recordId, ownerLabel, onTransferred }: {
  type: "CLIENT" | "PI" | "ORDER"; recordId: string; ownerLabel: string; onTransferred?: () => void;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [sps, setSps] = useState<Sp[]>([]);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sales/me").then((r) => (r.ok ? r.json() : null)).then((d) => setIsAdmin(d?.salesRole === "SALES_ADMIN")).catch(() => {});
  }, []);

  if (!isAdmin) return null;

  const openPicker = async () => {
    setOpen(true); setNote(null);
    if (!sps.length) {
      const r = await fetch("/api/sales/transfer").catch(() => null);
      if (r?.ok) setSps(await r.json());
    }
  };
  const doTransfer = async () => {
    if (!to) return;
    setBusy(true); setNote(null);
    const r = await fetch("/api/sales/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, id: recordId, toSpId: to }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { setNote("Ownership transferred \u2713"); setOpen(false); setTo(""); onTransferred?.(); }
    else setNote((await r?.json().catch(() => null))?.error ?? "Transfer failed");
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
      <span className="text-xs text-slate-400">Owner</span>
      <span className="font-medium text-slate-700">{ownerLabel}</span>
      {!open && <button onClick={openPicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Transfer ownership</button>}
      {open && (
        <>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
            <option value="">— new owner…</option>
            {sps.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
          </select>
          <button disabled={busy || !to} onClick={doTransfer} className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">{busy ? "Transferring\u2026" : "Confirm"}</button>
          <button disabled={busy} onClick={() => { setOpen(false); setTo(""); }} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600">Cancel</button>
        </>
      )}
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  );
}
