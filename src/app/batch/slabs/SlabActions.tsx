"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { rectifyDuplicates, addAllMissing, deleteSlabRow, markSkipped, unmarkSkipped } from "./actions";

type FixStation = "press" | "distributor" | "kreos" | "oven" | "jot" | "polishEntry" | "polishQc";

const btn = "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";

// `may` mirrors, at the call site, the gates the action behind each button applies.
//
//  The four buttons here (rectify / add-all / skip / un-skip) back actions that check
//  canRectify() AND the Shop Floor branch. Note that is NOT true of every export in
//  ./actions.ts: deleteSlabRow and removeBlankSlabRows take the branch too but gate rank
//  on isManager() not canRectify(), and getAddSlabForm carries the rank check with no
//  branch check at all — so do not reuse
//  `mayRectifyHere` for those without checking what they actually require.
//
//  Why it matters: FINANCE and ACCOUNTS are rank 2 in the OFFICE branch and middleware
//  never caps them on /batch, so they passed the rank test, saw these buttons and were
//  refused on click.
//
//  Where a hidden control would otherwise leave no trace, the caller says once who can
//  act — the header buttons swap themselves for that line (Refused, below), while the
//  per-row ones return null and the page carries a single note instead of repeating a
//  refusal on every row. Defaults true: today page.tsx is the only caller, so the
//  default is what a future caller inherits if it forgets, and the safer inherit here
//  is the visible control plus the action's own refusal, not a silently missing button.
function Refused({ children }: { children: ReactNode }) {
  return <span className="text-xs text-gray-500">{children}</span>;
}

export function RectifyButton({ batch, station, may = true }: { batch: string; station: FixStation; may?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (!may) return <Refused>An incharge on the Shop Floor branch can rectify duplicates.</Refused>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove duplicates? For each slab entered twice, the latest record is kept and the earlier one is deleted. This cannot be undone.")) return;
          start(async () => {
            const r = await rectifyDuplicates(batch, station);
            setMsg(r.message);
            if (r.ok) router.refresh();
          });
        }}
        className={`${btn} bg-red-600 text-white hover:bg-red-700`}
      >
        {pending ? "Working…" : "Rectify duplicates (keep latest)"}
      </button>
      {msg && <span className="text-sm text-gray-700">{msg}</span>}
    </div>
  );
}

export function AddAllMissingButton({ batch, station, may = true }: { batch: string; station: FixStation; may?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (!may) return <Refused>An incharge on the Shop Floor branch can add these.</Refused>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Add all missing slabs at this station? Each new slab's weight is set to the batch average.")) return;
          start(async () => {
            const r = await addAllMissing(batch, station);
            setMsg(r.message);
            if (r.ok) router.refresh();
          });
        }}
        className={`${btn} bg-brand text-white hover:bg-brand-dark`}
      >
        {pending ? "Adding…" : "Add all missing"}
      </button>
      {msg && <span className="text-sm text-gray-700">{msg}</span>}
    </div>
  );
}

export function DeleteRowButton({ model, id, batch, slabLabel }: { model: string; id: string; batch: string; slabLabel: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Delete this ${model} row (${slabLabel})? It is logged against your name and can be undone.`)) return;
          start(async () => {
            const r = await deleteSlabRow(model, id, batch);
            setMsg(r.ok ? null : r.message);
            if (r.ok) router.refresh();
          });
        }}
        className="text-red-600 hover:underline disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {msg && <span className="text-xs text-red-700">{msg}</span>}
    </span>
  );
}

export function MarkSkippedButton({ batch, slab, may = true }: { batch: string; slab: number; may?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (!may) return null; // the page carries one note for the whole table, not one per row
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Mark slab ${slab} as SKIPPED (never produced)? It stops showing as missing and is never auto-filled. You can undo this.`)) return;
          start(async () => { const r = await markSkipped(batch, slab); setMsg(r.ok ? null : r.message); if (r.ok) router.refresh(); });
        }}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Marking\u2026" : "Mark as skipped"}
      </button>
      {msg && <span className="text-xs text-red-700">{msg}</span>}
    </span>
  );
}

export function UnskipButton({ batch, slab, may = true }: { batch: string; slab: number; may?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!may) return null; // the page note covers this; a chip on each slab would be noise
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => { const r = await unmarkSkipped(batch, slab); if (r.ok) router.refresh(); })}
      className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
    >
      {pending ? "\u2026" : "un-skip"}
    </button>
  );
}
