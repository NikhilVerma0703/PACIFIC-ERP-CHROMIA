"use client";
// Unbacked-deficit banner. Normally the deficit just waits for a backfill
// (fill the silo / enter the prep and it auto-absorbs). Only after a
// backfill DROUGHT (no activity for WRITE_OFF_AFTER_HOURS) does it offer
// "write off & start fresh" — for material that is gone and untraceable
// (e.g. an old batch whose composition nobody can reconstruct).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeOffSilo } from "@/app/silo/actions";
import { writeOffResinTank } from "@/app/resin/actions";

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

export function WriteOffDeficit({ kind, no, deficitKg, droughtHours, afterHours, mayEdit }:
  { kind: "silo" | "resin"; no: string; deficitKg: number; droughtHours: number; afterHours: number; mayEdit: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ripe = droughtHours >= afterHours;
  const fillVerb = kind === "silo" ? "fill the silo" : "enter the prep";

  const run = () => start(async () => {
    const r = kind === "silo" ? await writeOffSilo(no) : await writeOffResinTank(no);
    setMsg(r.error ?? r.message ?? null);
    if (r.ok) { setConfirming(false); router.refresh(); }
  });

  return (
    <div className={`mb-5 rounded-xl border p-4 ${ripe ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`text-sm font-semibold ${ripe ? "text-red-800" : "text-amber-800"}`}>
            ⚠ {fmt(deficitKg)} kg drawn unbacked — {ripe ? `no backfill for ${Math.floor(droughtHours)} h` : "backfill expected"}
          </div>
          <p className={`mt-1 max-w-2xl text-xs ${ripe ? "text-red-700" : "text-amber-700"}`}>
            {ripe
              ? <>If this material can&apos;t be traced any more (already consumed, composition unknown), write it off and start fresh: the old cycles stay marked &ldquo;composition unknown&rdquo; and the <b>next {kind === "silo" ? "fill" : "prep"} keeps its full weight</b> instead of covering this deficit. If the material IS known, {fillVerb} instead — it still auto-links.</>
              : <>Material was used before it was entered. Just {fillVerb} and it auto-links to these draws. Write-off becomes available after {afterHours} h without backfill activity ({Math.ceil(afterHours - droughtHours)} h to go).</>}
          </p>
        </div>
        {mayEdit && ripe && (!confirming ? (
          <button onClick={() => { setMsg(null); setConfirming(true); }} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">
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
      {msg && <div className={`mt-2 text-xs font-medium ${ripe ? "text-red-800" : "text-amber-800"}`}>{msg}</div>}
    </div>
  );
}
