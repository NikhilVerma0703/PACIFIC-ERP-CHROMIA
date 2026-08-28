"use client";

// ADD STOCK — series -> colour -> finish -> size -> quantity.
//
// The form itself is components/sampling/SampleIntakeForm, shared with the two
// controls on the fabrication supervisor's slab board: the four questions are
// the same wherever stock is added, and the only thing that differs is who is
// asking and why. HERE the "why" is a question — this screen has no slab in
// front of it — while the fab controls have it decided by where they sit. See
// lib/sampling/fabIntake.ts.
//
// WHAT THIS SCREEN ADDS TO THE SHARED FORM is the running list of what has just
// been added. Adding stock is done in a batch — four sizes off one slab, six
// colours out of one bag — and the only way to know the fifth one landed is to
// see the first four still on screen. It is a session list, not a report: the
// audit is sampling_intake, which is append-only, and the inventory is one link
// away.

import { useState } from "react";
import Link from "next/link";
import { SampleIntakeForm, useSamplingPickLists } from "@/components/sampling/SampleIntakeForm";

export default function SamplingAddStockPage() {
  const { series, sizes, loading, error, reloadSizes } = useSamplingPickLists();
  const [added, setAdded] = useState<string[]>([]);

  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add Sample Stock</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Pieces cut for samples, or usable offcuts from a fabrication job
          </p>
        </div>
        <Link href="/sampling"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-300">
          Inventory
        </Link>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        {loading ? (
          <p className="py-8 text-center text-sm italic text-gray-400">Loading the colour chart…</p>
        ) : (
          <SampleIntakeForm
            series={series}
            sizes={sizes}
            pickListError={error}
            reloadSizes={reloadSizes}
            sourceRefLabel="Slab or bag number these came off"
            onSaved={(m) => setAdded((a) => [m, ...a])}
          />
        )}
      </div>

      {added.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-sm font-bold text-slate-800">
            Added just now <span className="font-normal text-slate-400">({added.length})</span>
          </h2>
          <ul className="divide-y divide-gray-50 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {added.map((m, i) => (
              <li key={`${i}-${m}`} className="px-4 py-2 text-xs text-gray-600">{m}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-400">
            This list is only what this browser has added since the page was opened — the permanent
            record is the intake log behind every count on the{" "}
            <Link href="/sampling" className="underline underline-offset-2">inventory</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
