"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClientTime } from "@/components/ClientTime";
import { undoLast } from "./undo";

// Same format as before; written after mount by ClientTime, because formatting
// the server's timestamp in the device's zone during render made the server
// (UTC) and the tablet (IST) disagree and React regenerate the page client-side.
const AT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

// `mayUndo` mirrors undoLast's own gates (incharge-and-above AND the Shop Floor branch,
// undo.ts:11-12). When false the bar still reports what was last done and by whom — only
// the button is swapped for who can reverse it, so nothing is silently taken away.
export function UndoLastButton({ batch, label, by, at, mayUndo = true }: { batch?: string; label: string; by?: string | null; at?: string | null; mayUndo?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
      <span className="text-sm text-amber-900">
        <span className="font-medium">Last action:</span> {label}
        {(by || at) && <span className="text-amber-700"> — {by ? `by ${by}` : ""}{at ? <ClientTime iso={at} prefix={by ? " · " : ""} options={AT_FORMAT} /> : ""}</span>}
      </span>
      <div className="flex items-center gap-3">
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
        {!mayUndo ? (
          <span className="text-xs text-amber-800">An incharge on the Shop Floor branch can undo this.</span>
        ) : (
        <button
          onClick={() => start(async () => { const r = await undoLast(batch); setMsg(r.message); router.refresh(); })}
          disabled={pending}
          className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "Undoing…" : "Undo last action"}
        </button>
        )}
      </div>
    </div>
  );
}
