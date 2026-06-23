"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToDowntime, type RespondRes } from "@/app/mis/actions";

const STATUSES = ["Pending", "Attended", "Resolved", "Not required"];
const TONE: Record<string, string> = {
  Resolved: "bg-green-100 text-green-700",
  Attended: "bg-blue-100 text-blue-700",
  Pending: "bg-amber-100 text-amber-700",
  "Not required": "bg-gray-100 text-gray-500",
};

export function DowntimeRespond({ misId, canRespond, status, note, by, at }: {
  misId: string; canRespond: boolean; status: string | null; note: string | null; by: string | null; at: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState(status || "Pending");
  const [nt, setNt] = useState(note || "");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!canRespond && !status) return <span className="text-gray-300">—</span>;

  const save = () => start(async () => {
    const r: RespondRes = await respondToDowntime(misId, st, nt);
    setMsg(r.message);
    if (r.ok) { setOpen(false); router.refresh(); }
  });

  return (
    <div className="space-y-1">
      {status && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[status] ?? "bg-gray-100 text-gray-600"}`}>{status}</span>
          {note && <span className="text-gray-600">{note}</span>}
        </div>
      )}
      {status && (by || at) && <div className="text-[11px] text-gray-400">{by ?? "—"}{at ? ` · ${at}` : ""}</div>}
      {canRespond && !open && (
        <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-medium text-brand hover:underline">{status ? "Edit" : "Respond"}</button>
      )}
      {canRespond && open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <select value={st} onChange={(e) => setSt(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1 text-xs">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea value={nt} onChange={(e) => setNt(e.target.value)} rows={2} placeholder="What did maintenance do?" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={save} className="rounded bg-brand px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => { setOpen(false); setMsg(""); }} className="text-[11px] text-gray-500 hover:underline">Cancel</button>
            {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
