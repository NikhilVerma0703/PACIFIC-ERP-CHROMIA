"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rectifyDuplicates, addAllMissing, deleteSlabRow } from "./actions";

type FixStation = "press" | "distributor" | "kreos" | "oven" | "jot" | "polishEntry" | "polishQc";

const btn = "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";

export function RectifyButton({ batch, station }: { batch: string; station: FixStation }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
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

export function AddAllMissingButton({ batch, station }: { batch: string; station: FixStation }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
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
