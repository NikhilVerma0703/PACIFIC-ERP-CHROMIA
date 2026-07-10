"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FieldInput } from "@/components/RecordEditor";
import { createVerifiedSlab } from "./actions";
import { undoLast } from "../undo";
import type { FieldMeta } from "@/lib/tables";

const grid = "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3";

export function AddSlabForm({
  model, batch, slab, fields, values, options, templateSlab, avgWeight, weightField, operatorName,
}: {
  model: string;
  batch: string;
  slab: number;
  fields: FieldMeta[];
  values: Record<string, unknown>;
  options: Record<string, string[]>;
  templateSlab: number | null;
  avgWeight: number | null;
  weightField: string | null;
  operatorName?: string | null;
}) {
  const [pending, start] = useTransition();
  const [created, setCreated] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const router = useRouter();

  const editable = fields.filter((f) => f.editable);
  const station = stationFromModel(model);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await createVerifiedSlab(model, batch, fd);
      setMsg(r.message);
      if (r.ok && r.id) { setCreated(true); router.refresh(); }
    });
  }

  function onUndo() {
    start(async () => {
      const r = await undoLast(batch);
      setMsg(r.message);
      if (r.ok) setUndone(true);
      router.refresh();
    });
  }

  if (created) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
        <div className="text-sm font-medium text-green-800">{msg ?? `Slab ${slab} added.`}</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!undone && (
            <button onClick={onUndo} disabled={pending}
              className="rounded-md border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              {pending ? "Undoing…" : "Undo this add"}
            </button>
          )}
          <button onClick={() => router.push(`/batch/slabs?b=${encodeURIComponent(batch)}&station=${station}&only=missing`)}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
            Back to missing list
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Adding <span className="font-semibold">slab {slab}</span>.
        {templateSlab != null ? <> Prefilled from slab <span className="font-semibold">{templateSlab}</span>.</> : <> No neighbouring slab found to copy from.</>}
        {weightField && avgWeight != null ? <> Weight set to batch average <span className="font-semibold">{avgWeight} kg</span>.</> : null}
        {" "}Verify and edit any field, then add.
      </div>

      <div className={grid}>
        {editable.map((f) => (
          <FieldInput key={f.prismaField} f={f} value={values[f.prismaField]} opts={options[f.prismaField]} operatorName={operatorName} />
        ))}
      </div>

      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/85 px-5 py-3 backdrop-blur">
        <div className="text-sm">{msg ? <span className="text-red-600">{msg}</span> : <span className="text-gray-400">{editable.length} fields · verify before adding</span>}</div>
        <button disabled={pending} className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">
          {pending ? "Adding…" : "Add slab"}
        </button>
      </div>
    </form>
  );
}

function stationFromModel(model: string): string {
  switch (model) {
    case "Press": return "press";
    case "Oven": return "oven";
    case "Jot": return "jot";
    case "PolishEntry": return "polishEntry";
    case "PolishQc": return "polishQc";
    default: return "press";
  }
}
