"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FieldInput } from "@/components/RecordEditor";
import { createVerifiedSlab } from "./actions";
import { undoLast } from "../undo";
import type { FieldMeta } from "@/lib/tables";
import { REJECT_GRADE_FIELD, rejectGradeNotHere } from "@/lib/photoSlots";

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

  // ---- THIS FORM CANNOT TAKE A REJECT (owner, 2026-09-04) ------------------
  // "Add & verify" fills a GAP in a batch: it copies a neighbouring slab's
  // values and posts them, and it renders no photo input of any kind — every
  // field it draws comes from `fields.filter(f => f.editable)`. Until today
  // qualityGrade was one of those fields, and getAddSlabForm PRE-FILLS from the
  // neighbour, so a batch whose previous slab was a reject offered 'C (Reject)'
  // already selected: one tap wrote an undocumented reject straight past the
  // rule that createRow and saveRow both enforce.
  //
  // NOT A THEORETICAL DOOR. Measured on live Neon 2026-09-04: 240 of the 718
  // batches in polish_qc hold at least one reject, and 1,206 slab positions
  // have a reject as their next-lower slab in the same batch — every one of
  // those is a gap this screen would have opened with 'C (Reject)' preselected.
  // Both figures move with the line; the door does not depend on them.
  //
  // The owner's answer was to refuse the grade here rather than bolt a camera
  // onto a form built for another job — "Dont let it add c grade slabs.
  // Instead prompt the user ... either do it from tables or from the qc form."
  // lib/photoSlots owns the sentence, so both routes are named the same way
  // wherever this refusal appears. The page that renders this form also strips
  // a pre-filled reject out of the values (see add/page.tsx), so the dropdown
  // does not start on a grade this screen will not accept.
  //
  // THIS IS THE COURTESY HALF, AND IT IS NOT THE ENFORCEMENT. A client check
  // can be bypassed by posting the form; the server half belongs in
  // createVerifiedSlab (src/app/batch/slabs/actions.ts) and IS NOT THERE YET —
  // that file was outside the scope of this change. Until it calls
  // rejectGradeNotHere the same way createRow and saveRow call
  // rejectPhotoRefusal, a posted form can still write a reject with no photos.
  const [grade, setGrade] = useState("");
  const rejectHere = rejectGradeNotHere(model, grade);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Read the posted value, not the mirror: the mirror is only what the last
    // change event saw, and a grade restored by the browser or set any other
    // way must be refused too.
    const refusal = rejectGradeNotHere(model, String(fd.get(REJECT_GRADE_FIELD) ?? ""));
    if (refusal) { setGrade(String(fd.get(REJECT_GRADE_FIELD) ?? "")); setMsg(refusal); return; }
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
    <form
      onSubmit={onSubmit}
      // The grade box is uncontrolled like every other field here; this mirrors
      // it so the banner appears the moment C is picked, rather than at Add.
      onChange={(e) => {
        // React types a bubbled change target as the FORM, not the control that
        // fired it — hence the widening, exactly as SmartSlabForm does it. All
        // this reads is name+value, which every input and select carries.
        const t = e.target as unknown as { name?: string; value?: string };
        if (t.name === REJECT_GRADE_FIELD) { setGrade(t.value ?? ""); setMsg(null); }
      }}
    >
      {rejectHere && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700">
          {rejectHere}
        </div>
      )}
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

      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/85 px-5 py-3 backdrop-blur safe-bottom">
        <div className="text-sm">{msg ? <span className="text-red-600">{msg}</span> : <span className="text-gray-400">{editable.length} fields · verify before adding</span>}</div>
        {/* Down while the grade is one this screen cannot record — a tap that
            can only be refused is worse than a button that says so first. */}
        <button disabled={pending || !!rejectHere} className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">
          {pending ? "Adding…" : rejectHere ? "Pick a non-C grade" : "Add slab"}
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
