"use client";
// Admin-only button on Live Status: re-run the FIFO allocator (see allocatorAction).
import { useState, useTransition } from "react";
import { runAllocatorAction } from "@/app/live/allocatorAction";

export function RunAllocator() {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => start(async () => { setMsg(null); const r = await runAllocatorAction(); setMsg(r.message); })}
        disabled={busy}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
        title="Re-links any mixer cycles whose grit/filler was never deducted (FIFO, oldest bags first)">
        {busy ? "Allocating…" : "Re-run FIFO allocator"}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </span>
  );
}
