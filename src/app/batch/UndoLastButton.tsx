"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoLast } from "./undo";

function ago(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function UndoLastButton({ batch, label, by, at }: { batch?: string; label: string; by?: string | null; at?: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
      <span className="text-sm text-amber-900">
        <span className="font-medium">Last action:</span> {label}
        {(by || at) && <span className="text-amber-700"> — {by ? `by ${by}` : ""}{by && at ? " · " : ""}{at ? ago(at) : ""}</span>}
      </span>
      <div className="flex items-center gap-3">
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
        <button
          onClick={() => start(async () => { const r = await undoLast(batch); setMsg(r.message); router.refresh(); })}
          disabled={pending}
          className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "Undoing…" : "Undo last action"}
        </button>
      </div>
    </div>
  );
}
