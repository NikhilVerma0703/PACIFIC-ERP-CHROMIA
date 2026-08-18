"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeBlankSlabRows } from "./slabs/actions";

const pill = "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700";

// "Slab count mismatch" badge. When the mismatch is (at least partly) caused by
// blank-slab rows, a manager can click it to remove those empty rows in one go.
export function SlabMismatchPill({ batch, blankTotal, canManage }: { batch: string; blankTotal: number; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  // Not actionable for this user — but the blank-row count is the diagnosis, so it is
  // still reported along with who can clear it. Hiding the number hides the finding.
  if (!(blankTotal > 0 && canManage)) {
    return (
      <span className={pill}>
        ⚠ Slab count mismatch
        {blankTotal > 0 && ` · ${blankTotal} blank row${blankTotal === 1 ? "" : "s"} — a production manager on the Shop Floor branch can remove ${blankTotal === 1 ? "it" : "them"}`}
      </span>
    );
  }

  const run = () => {
    if (!window.confirm(`Remove ${blankTotal} blank-slab row(s) from this batch? They carry no slab number and inflate the produced count. Logged against your name and undoable.`)) return;
    start(async () => {
      const r = await removeBlankSlabRows(batch);
      setMsg(r.ok ? null : r.message);
      if (r.ok) router.refresh();
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Mismatch is caused by blank rows — click to remove them"
        className={`${pill} hover:bg-red-200 disabled:opacity-50`}
      >
        {pending ? "Removing…" : `⚠ Slab count mismatch · remove ${blankTotal} blank row${blankTotal === 1 ? "" : "s"}`}
      </button>
      {msg && <span className="text-xs text-red-700">{msg}</span>}
    </span>
  );
}
