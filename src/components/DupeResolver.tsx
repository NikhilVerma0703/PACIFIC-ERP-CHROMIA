"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveUploadDupes, type DupeRow } from "@/app/store/actions";

/** Shown after an upload that hit duplicates: the store incharge decides
 * whether they're true repeats (skip) or a genuinely new consignment that
 * reuses an invoice number (save under "<invoice>-Batch-N"). */
export function DupeResolver({ dupes }: { dupes: DupeRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  if (!dupes.length) return null;
  if (done) return <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">✓ {done}</div>;

  const act = (mode: "batch" | "skip") =>
    start(async () => {
      const r = await resolveUploadDupes(dupes, mode);
      setDone(r.message);
      router.refresh();
    });

  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="text-sm font-semibold text-amber-900">⚠ {dupes.length} row(s) already exist — what are these?</div>
      <ul className="mt-2 max-h-44 list-inside list-disc overflow-y-auto text-xs text-amber-900/90">
        {dupes.map((d, i) => <li key={i}>{d.label}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => act("batch")} className="min-h-[40px] rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {pending ? "Saving…" : "New consignment — save as Batch-1"}
        </button>
        <button disabled={pending} onClick={() => act("skip")} className="min-h-[40px] rounded-md border border-amber-400 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">
          True duplicates — skip all
        </button>
      </div>
      <p className="mt-2 text-[11px] text-amber-800/70">"Save as Batch" stores them under "&lt;invoice&gt;-Batch-1" (or the next free number) so the original entries are never touched.</p>
    </div>
  );
}
