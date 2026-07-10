"use client";
// Unbacked-deficit banner. The deficit can always be resolved two ways, at any
// time: (1) fill the silo / enter the prep and it auto-absorbs these draws, or
// (2) write it off & start fresh — for material that's gone and untraceable
// (composition unknown). There is no time gate on the write-off.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeOffSilo } from "@/app/silo/actions";
import { writeOffResinTank } from "@/app/resin/actions";

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

// droughtHours / afterHours are still passed by the pages but no longer gate the
// write-off — it's available the whole time for any backfill-needed deficit.
export function WriteOffDeficit({ kind, no, deficitKg, mayEdit }:
  { kind: "silo" | "resin"; no: string; deficitKg: number; droughtHours: number; afterHours: number; mayEdit: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fillVerb = kind === "silo" ? "fill the silo" : "enter the prep";
  const fillNoun = kind === "silo" ? "fill" : "prep";

  const run = () => start(async () => {
    const r = kind === "silo" ? await writeOffSilo(no) : await writeOffResinTank(no);
    setMsg(r.error ?? r.message ?? null);
    if (r.ok) { setConfirming(false); router.refresh(); }
  });

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-amber-800">⚠ {fmt(deficitKg)} kg drawn unbacked — backfill needed</div>
          <p className="mt-1 max-w-2xl text-xs text-amber-700">
            Material was used before it was entered. {fillVerb.charAt(0).toUpperCase() + fillVerb.slice(1)} and it auto-links to these draws. If it can&apos;t be traced any more (already consumed, composition unknown), you can <b>write it off &amp; start fresh</b> — the old cycles stay &ldquo;composition unknown&rdquo; and the next {fillNoun} keeps its full weight instead of covering this deficit.
          </p>
        </div>
        {mayEdit && (!confirming ? (
          <button onClick={() => { setMsg(null); setConfirming(true); }} className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">
            Write off &amp; start fresh…
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={pending} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {pending ? "Writing off…" : `Yes — write off ${fmt(deficitKg)} kg`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={pending} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        ))}
      </div>
      {msg && <div className="mt-2 text-xs font-medium text-amber-800">{msg}</div>}
    </div>
  );
}
