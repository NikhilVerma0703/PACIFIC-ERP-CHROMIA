"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { confirmRangeAction } from "@/app/batch/rangeActions";

export function RangeControls({ batch, batchKey, min, max, missing, confirmed }: { batch: string; batchKey: string; min: number; max: number; missing: number; confirmed: { by: string | null; at: string } | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Slab range (auto from Press)</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">Slabs {min} – {max}</div>
          <div className="text-xs text-gray-500">{max - min + 1} expected{missing ? ` · ${missing} missing from every station` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          {confirmed ? (
            <span className="rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">✓ Confirmed{confirmed.by ? ` by ${confirmed.by}` : ""}{confirmed.at ? ` · ${confirmed.at}` : ""}</span>
          ) : (
            <button type="button" disabled={pending} onClick={() => start(async () => { await confirmRangeAction(batchKey); router.refresh(); })} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "Saving…" : "Confirm as correct"}</button>
          )}
          <Link href={`/batch/range?b=${encodeURIComponent(batch)}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Rectify →</Link>
        </div>
      </div>
    </Card>
  );
}
