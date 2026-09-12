"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "./Toast";
import { createRow } from "@/app/tables/actions";
import { guardAction, SERVER_UNREACHABLE } from "@/lib/guardAction";
import { getSmartDefaults, getBatchForSlab } from "@/app/entry/slab/actions";
import type { FieldMeta } from "@/lib/tables";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { isCurated, OTHER_SENTINEL } from "@/lib/categoricalFields";
import { secondsToHHMM } from "@/lib/time";
import type { SlabMode } from "@/lib/smartEntry";
import { isRequiredField } from "@/lib/requiredFields";
import { PhotoField, type PhotoFieldState } from "./PhotoField";
import { shouldReloadDefaults } from "@/lib/entryReload";
import {
  PHOTO_SLOTS, hasPhotoPair, PAIR_TARGET, PAIR_HARD_MAX, PHOTO_WARN_PREFIX,
  REJECT_GRADE_FIELD, REJECT_PHOTOS_RULE, isRejectGrade, rejectPhotosRequired, photoProblem,
} from "@/lib/photoSlots";

const guardedCreateRow = guardAction(createRow, SERVER_UNREACHABLE);

// Current local date+time as a datetime-local value ("YYYY-MM-DDTHH:mm"), used to
// pre-fill empty Date fields so an entry always carries a date even if the
// operator doesn't touch it (it stays editable — they can still change it).
function nowLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/** The photo inputs for a slab entry. Polish QC gets the far/near pair the slab
 *  -intake form uses — the same two views of the same defect, so a grade can be
 *  looked at again later. Every other station keeps the single generic photo it
 *  has always had. Both post through createRow → savePhotoFromForm, which stores
 *  whichever slots arrive.
 *
 *  OPTIONAL ON EVERY GRADE BUT A REJECT. The pair started out optional here
 *  (owner, 2026-09-01) because QC entry runs slab after slab and must never be
 *  stopped by a camera, and that is still true for A, A2 and B — 43,360 of the
 *  44,449 graded slabs on live Neon, 2026-09-04. The owner narrowed it on
 *  2026-09-03: a C (Reject) may not be saved without both photos, because a
 *  reject is the one verdict whose evidence somebody comes back to look at.
 *  Narrowed, not reversed — nothing about the other grades changed.
 *
 *  The slots go red the moment C is picked, not at Save: discovering a camera
 *  requirement after filling the whole form is how an operator learns to grade
 *  the slab B instead. lib/photoSlots owns the predicate; tables/actions.ts
 *  enforces it again on the server, because this check can be bypassed. */
function PhotoFields({ model, grade, onSlotState }: {
  model: string;
  grade: string;
  onSlotState: (slot: string, s: PhotoFieldState) => void;
}) {
  if (!hasPhotoPair(model)) return <PhotoField />;
  const must = isRejectGrade(grade);
  return (
    <>
      {must && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 sm:col-span-2 lg:col-span-3">
          <b>C (Reject)</b> — both photos are mandatory before this slab can be saved: the {PHOTO_SLOTS.map((p) => p.label).join(" and the ")}.
        </div>
      )}
      {PHOTO_SLOTS.map((p) => (
        <PhotoField
          key={p.slot} field={p.field} label={p.title} hint={p.hint}
          target={PAIR_TARGET} hardMax={PAIR_HARD_MAX}
          status={must ? "required" : "optional"}
          onState={(s) => onSlotState(p.slot, s)}
        />
      ))}
    </>
  );
}

// Module-scope field component: keeps a stable component identity across renders
// so uncontrolled inputs are NOT remounted (typed values survive state updates).
function PumpBoxes({ name, def }: { name: string; def: string }) {
  // def is the stored pump list, e.g. "1,3" — which pumps ran this batch
  const initial = new Set(String(def || "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= 4));
  const [on, setOn] = useState<boolean[]>([1, 2, 3, 4].map((n) => initial.has(n)));
  const list = [1, 2, 3, 4].filter((n) => on[n - 1]).join(",");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2">
      {[0, 1, 2, 3].map((i) => (
        <label key={i} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${on[i] ? "border-brand bg-brand/10 text-brand" : "border-gray-200 text-gray-600"}`}>
          <input type="checkbox" checked={on[i]} onChange={() => setOn((s) => s.map((v, j) => (j === i ? !v : v)))} className="h-3.5 w-3.5" />
          Pump {i + 1}
        </label>
      ))}
      <input type="hidden" name={name} value={list} />
    </div>
  );
}

function SlabField({ f, locked, def, opts, operatorName, unlocked, onUnlock, required = false }: { f: FieldMeta; locked: boolean; def: string; opts?: string[]; operatorName?: string | null; unlocked: Set<string>; onUnlock: (field: string) => void; required?: boolean }) {
  const [typeNew, setTypeNew] = useState(false); // curated fields: "+ Add new…" escape
  // Pre-fill an empty Date field with the current date+time once mounted (after
  // SSR, so no hydration mismatch). Remounts per slab via the fields key, so each
  // slab gets the current time; a value the operator already has is left alone.
  const dateRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (f.kind === "date" && dateRef.current && !dateRef.current.value) dateRef.current.value = nowLocalDatetime();
  }, [f.kind]);
  if (f.prismaField === "vacuumPumps") {
    return (
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Vacuum pumps</span>
        <PumpBoxes name={f.prismaField} def={def} />
      </label>
    );
  }
  if (OPERATOR_FIELDS.has(f.prismaField) && operatorName) {
    return (
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">{f.airtableName}<span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">you</span></span>
        <input name={f.prismaField} defaultValue={operatorName} readOnly className={inputCls + " bg-brand/[0.04] text-gray-700"} />
      </label>
    );
  }
  const isLocked = locked && !unlocked.has(f.prismaField);
  const tint = isLocked ? " border-brand/30 bg-brand/[0.04] text-gray-700" : "";
  let input;
  const selectable = (f.airtableType === "singleSelect" || isCurated(f.prismaField)) && opts?.length;
  if (selectable && typeNew) {
    input = (
      <div className="flex gap-1.5">
        <input name={f.prismaField} autoFocus placeholder="type the new value…" className={inputCls} />
        <button type="button" onClick={() => setTypeNew(false)} className="shrink-0 rounded-lg border border-gray-300 px-2 text-xs text-gray-500 hover:bg-gray-50">list</button>
      </div>
    );
  } else if (selectable) {
    const extra = def && !opts!.includes(def) ? [def] : [];
    input = (
      <select name={f.prismaField} defaultValue={def} required={required} onChange={(e) => { if (e.target.value === OTHER_SENTINEL) setTypeNew(true); }} className={inputCls + tint}>
        <option value="">—</option>
        {[...extra, ...opts!].map((o) => <option key={o} value={o}>{o}</option>)}
        {isCurated(f.prismaField) && <option value={OTHER_SENTINEL}>+ Add new…</option>}
      </select>
    );
  } else if (f.airtableType === "multipleSelects" && opts?.length) {
    const arr = def ? def.split(",").map((x) => x.trim()) : [];
    input = <div className={`flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2${isLocked ? " bg-brand/[0.04]" : ""}`}>{opts.map((o) => <label key={o} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs"><input type="checkbox" name={f.prismaField} value={o} defaultChecked={arr.includes(o)} className="h-3.5 w-3.5" />{o}</label>)}</div>;
  } else if (f.airtableType === "duration") {
    // time-of-day picker (same UX as the Date field) — stored as duration
    input = <input name={f.prismaField} type="time" defaultValue={def ? secondsToHHMM(Number(def)) : ""} readOnly={isLocked} className={inputCls + tint} />;
  } else if (isLocked) {
    input = <input name={f.prismaField} defaultValue={def} readOnly className={inputCls + tint} />;
  } else if (f.kind === "bool") {
    input = <input name={f.prismaField} type="checkbox" defaultChecked={def === "true"} className="h-4 w-4 rounded border-gray-300 text-brand" />;
  } else {
    const type = f.kind === "number" || f.kind === "int" ? "number" : f.kind === "date" ? "datetime-local" : "text";
    input = <input ref={f.kind === "date" ? dateRef : undefined} name={f.prismaField} type={type} step={type === "number" ? "any" : undefined} inputMode={f.kind === "int" ? "numeric" : f.kind === "number" ? "decimal" : undefined} required={required} defaultValue={def} className={inputCls} />;
  }
  const isReadonlyText = isLocked && !(opts?.length && (f.airtableType === "singleSelect" || f.airtableType === "multipleSelects"));
  return (
    <label className="block" onDoubleClick={() => isReadonlyText && onUnlock(f.prismaField)}>
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">{f.airtableName}{required && <span className="text-red-500" title="Required">*</span>}{isLocked && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from batch{isReadonlyText ? " · dbl-click" : ""}</span>}</span>
      {input}
    </label>
  );
}

export function SmartSlabForm({ model, tableName, fields, paramFieldSet, options = {}, operatorName, batchField = "batch", slabMode = "increment", slabOptions = [], slabFirst = false }: { model: string; tableName: string; fields: FieldMeta[]; paramFieldSet: string[]; options?: Record<string, string[]>; operatorName?: string | null; batchField?: string; slabMode?: SlabMode; slabOptions?: number[]; slabFirst?: boolean; }) {
  // guardAction: a dropped connection mid-save shows in the bar instead of
  // throwing the page to global-error with the slab half typed (lib/guardAction).
  const [msg, action, pending] = useActionState(guardedCreateRow, undefined);
  const [batch, setBatch] = useState("");
  const [defaults, setDefaults] = useState<{ values: Record<string, unknown>; slabAutofill?: number | null; lineThickness?: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [batchLocked, setBatchLocked] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  // The grade the operator has picked, watched only so the two photo slots can
  // go red the instant it becomes a reject (see PhotoFields). The field itself
  // stays uncontrolled — this mirrors it, it does not own it.
  const [grade, setGrade] = useState("");
  const [photoState, setPhotoState] = useState<Record<string, PhotoFieldState>>({});
  // A refusal this form made itself, kept apart from `msg` (the server's answer)
  // so a client refusal never looks like a save that failed at the far end.
  const [blocked, setBlocked] = useState<string | null>(null);
  const router = useRouter();
  // The slab box, so a save can empty it and put the cursor back in it. Only
  // the increment mode's box is remounted by the version bump below (its key
  // carries the version, so it re-renders holding last+1); the polish stations
  // keep a stable key so the number the operator typed survives a re-render —
  // which is exactly how the box came to still hold the slab just saved, one
  // thumb-width from the Save button. Nothing was lost when that second tap
  // landed (the PolishEntry/PolishQc duplicate guard in tables/actions.ts
  // refuses it), but the operator lost the queue's time reading "already
  // entered" and wondering which of the two saves counted.
  const slabBox = useRef<HTMLInputElement | null>(null);
  // WHAT WAS LAST LOADED, so a blur that changed nothing does nothing. Both
  // boxes below re-fetch on blur, and a blur fires whenever anything else is
  // tapped — the camera button above all (lib/entryReload says what that cost).
  // Refs and not state: nothing on screen depends on these, and a re-render
  // between the blur and the answer would lose them.
  const loadedBatch = useRef<string | null>(null);
  const resolvedSlab = useRef<string | null>(null);
  // After every successful save: toast, then RELOAD the batch defaults so the
  // slab number auto-advances (+1) and parameters re-fill for the next slab.
  useEffect(() => {
    if (pending || msg !== "ok") return;
    setSavedCount((c) => c + 1);
    // FORCED, and it is the one reload that must ignore the guard below: this
    // is the same batch on purpose, reloaded so the slab number advances and
    // the row just entered is cleared off the screen.
    if (batch.trim()) void loadDefaults({ force: true });
    // The box is emptied below, so the next number typed must resolve even if
    // it is the one just saved (which the duplicate guard will then refuse, by
    // name, instead of the form silently doing nothing).
    resolvedSlab.current = null;
    if (slabMode !== "increment") {
      // SAVED MEANS DONE, the slab-intake rule: empty the box and take the
      // cursor back, because the next thing this person does is the next slab.
      // The green confirmation in the bottom bar is deliberately NOT cleared —
      // it is the only record on screen of what just happened.
      if (slabBox.current) { slabBox.current.value = ""; slabBox.current.focus(); }
      // "awaiting QC" is a server query taken at page load, so the slab just
      // graded stayed in the list — and in the datalist that offers it — until
      // someone reloaded by hand. The page is force-dynamic, so a refresh
      // re-runs polishEntrySlabOptions and drops it; a refresh re-renders the
      // server tree without remounting this form, so the confirmation stays.
      if (slabMode === "dropdown") router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, msg]);

  // Every field below lives under key={`fields-${version}`} and is remounted on
  // a version bump (a new batch, or the reload after a save), so the grade goes
  // back to its default and both file inputs come back empty. The mirrors have
  // to be emptied with them — a stale "C" here would paint the next slab's
  // slots red, and a stale "ready" would let a save through with no photo.
  useEffect(() => { setGrade(""); setPhotoState({}); setBlocked(null); }, [version]);

  /** THE CLIENT HALF OF THE REJECT RULE — it exists so the operator finds out
   *  BEFORE waiting out two uploads, not instead of the server check. The same
   *  rule runs again in tables/actions.ts createRow, which is what actually
   *  enforces it (this handler can be bypassed; a form can be posted without
   *  ever running it). Refuse by name — "a photo is required" leaves someone
   *  looking at two empty slots wondering which one. */
  const guardRejectPhotos = (e: React.FormEvent<HTMLFormElement>) => {
    if (!rejectPhotosRequired(model, grade)) { setBlocked(null); return; }
    const fd = new FormData(e.currentTarget);
    for (const p of PHOTO_SLOTS) {
      // THE SAME THREE CONDITIONS THE SERVER APPLIES, not just "a file is
      // attached". This used to test `f.size > 0` alone, so a small file with a
      // non-image MIME passed here and was refused by the action — the operator
      // refused for a photo they HAD attached, with nothing on screen saying
      // why, and the way out of a form that will not save is to type a
      // different grade. photoProblem is the one spelling, in lib/photoSlots.
      const bad = photoProblem(fd.get(p.field), p.label);
      if (!bad) continue;
      e.preventDefault();
      // Mid-compression is a WAIT, not a mistake: PhotoField empties the input
      // the moment it starts shrinking an oversized camera JPEG, so the photo
      // the operator just attached is genuinely not on the form yet.
      setBlocked(photoState[p.slot] === "busy"
        ? `The ${p.label} is still compressing — wait for “✓ ready”, then save.`
        : `${REJECT_PHOTOS_RULE} ${bad}`);
      return;
    }
    setBlocked(null);
  };

  // Save stays down while a photo the rule DEMANDS is still being shrunk —
  // otherwise the honest thing to do with a tap is refuse it, and a refusal for
  // work already done is the one that gets a rule worked around.
  const compressing = rejectPhotosRequired(model, grade) && PHOTO_SLOTS.some((p) => photoState[p.slot] === "busy");

  const paramSet = new Set(paramFieldSet);
  const editable = fields.filter((f) => f.editable && f.prismaField !== batchField);
  const paramF = editable.filter((f) => paramSet.has(f.prismaField) && f.prismaField !== "remarks");
  const slabF0 = editable.filter((f) => (!paramSet.has(f.prismaField) || f.prismaField === "remarks") && f.prismaField !== "slabNumber");
  // remarks always last, under Slab details
  const slabF = [...slabF0.filter((f) => f.prismaField !== "remarks"), ...slabF0.filter((f) => f.prismaField === "remarks")];
  const slabNumberField = editable.find((f) => f.prismaField === "slabNumber");

  async function loadDefaults(opts?: { force?: boolean }) {
    if (!batch.trim()) return;
    // An identical answer cannot change what is on screen, so remounting the
    // fields to apply it can only throw away typing. Only `force` (the reload
    // after a save) goes round this.
    if (!opts?.force && !shouldReloadDefaults(loadedBatch.current, batch)) return;
    setLoading(true);
    const r = await getSmartDefaults(model, batch);
    if (!r) { setLoading(false); return; } // no access to this form
    // Recorded only on success, so a failed lookup can be retried by blurring
    // the box again rather than being remembered as done.
    loadedBatch.current = batch.trim();
    setDefaults(r); setUnlocked(new Set()); setVersion((v) => v + 1); setLoading(false);
  }

  // Polish stations: slab number drives the batch (looked up from Press).
  //
  // THE GUARD IS THE WHOLE FIX for "the already filled form clears". This runs
  // on the slab box's blur, and the camera button blurs it — so without the
  // check it re-resolved the number already showing and remounted every field
  // under it, wiping the entry the operator had just finished typing.
  async function resolveFromSlab(slabVal: string) {
    if (!shouldReloadDefaults(resolvedSlab.current, slabVal)) return;
    setLoading(true);
    const r = await getBatchForSlab(model, slabVal.trim());
    setLoading(false);
    if (!r) return;
    resolvedSlab.current = slabVal.trim();
    if (r.batch) {
      setBatch(r.batch); setBatchLocked(true);
      loadedBatch.current = r.batch.trim();
      setDefaults(r.defaults ?? null); setUnlocked(new Set()); setVersion((v) => v + 1);
    } else {
      setBatchLocked(false); // not in Press — operator enters the batch
    }
  }

  function dv(f: string): string {
    const v = defaults?.values?.[f];
    if (v == null) return "";
    return Array.isArray(v) ? v.join(", ") : String(v);
  }

  const grid = "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3";

  function clearForm() {
    setBatch(""); setDefaults(null); setUnlocked(new Set()); setBatchLocked(false); setVersion((v) => v + 1);
    // Forget what was loaded, or the batch just cleared would be refused a
    // reload when it is typed again.
    loadedBatch.current = null; resolvedSlab.current = null;
  }

  return (
    <form
      action={action}
      autoComplete="off"
      onSubmit={guardRejectPhotos}
      // One listener instead of threading a callback through SlabField: change
      // events bubble, and the only two the reject rule cares about are the
      // grade (which turns it on) and a photo slot (which can turn a standing
      // refusal off). Everything else falls through untouched.
      onChange={(e) => {
        // React types a bubbled change target as the FORM, not the control that
        // fired it — hence the widening. All this listener reads is name+value,
        // which every input and select carries.
        const t = e.target as unknown as { name?: string; value?: string };
        if (t.name === REJECT_GRADE_FIELD) { setGrade(t.value ?? ""); setBlocked(null); }
        else if (PHOTO_SLOTS.some((p) => p.field === t.name)) setBlocked(null);
      }}
    >
      <Toast trigger={savedCount} text="Saved — enter the next slab" />
      {batch.trim() && defaults && (
        <div className="sticky top-0 z-10 -mx-5 mb-4 border-b border-brand/20 bg-brand/[0.06] px-5 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-brand">Batch {batch.trim().toUpperCase()}</span>
          {defaults?.lineThickness && <span className="ml-2 rounded bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">Thickness {defaults.lineThickness} <span className="font-normal text-gray-500">(from line head)</span></span>}
          <span className="ml-2 text-xs text-gray-500">{tableName} — every save goes to this batch</span>
        </div>
      )}
      <input type="hidden" name="__model" value={model} />
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Batch &amp; slab</div>
          <button type="button" onClick={clearForm} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50">Clear form</button>
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
          <label className={`block ${slabFirst ? "sm:order-2" : ""}`}>
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">Batch{slabFirst && batchLocked && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from Press</span>}</span>
            <input name={batchField} value={batch} onChange={(e) => setBatch(e.target.value)} onBlur={batchLocked ? undefined : () => loadDefaults()} readOnly={batchLocked} required placeholder="e.g. D1310" className={inputCls + (batchLocked ? " border-brand/30 bg-brand/[0.04] text-gray-700" : "")} />
            <span className="mt-1 block text-[11px] text-gray-400">{loading ? "Loading…" : slabFirst ? (batchLocked ? "auto-filled from Press for this slab" : "not in Press — enter the batch") : "Enter batch, then Tab — parameters auto-fill"}</span>
          </label>
          {slabNumberField && (
            <label className={`block ${slabFirst ? "sm:order-1" : ""}`} key={slabFirst ? "slab" : `slab-${version}`}>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">Slab Number
                {slabMode === "increment" && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">+1 in batch</span>}
                {slabMode === "dropdown" && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">awaiting QC</span>}
                {slabMode === "manual" && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">manual</span>}
              </span>
              {slabMode === "dropdown" ? (
                <>
                  <input ref={slabBox} name="slabNumber" type="text" required list="slab-options" defaultValue="" placeholder="type to search…" onBlur={slabFirst ? (e) => resolveFromSlab(e.target.value) : undefined} className={`${inputCls} font-medium`} />
                  <datalist id="slab-options">{slabOptions.map((n) => <option key={n} value={n} />)}</datalist>
                  <span className="mt-1 block text-[11px] text-gray-400">{slabOptions.length.toLocaleString("en-IN")} polish-entry slab(s) awaiting QC · type to search &amp; pick</span>
                </>
              ) : slabMode === "manual" ? (
                <>
                  <input ref={slabBox} name="slabNumber" type="text" required defaultValue="" onBlur={slabFirst ? (e) => resolveFromSlab(e.target.value) : undefined} className={`${inputCls} font-medium`} />
                  <span className="mt-1 block text-[11px] text-gray-400">manual — enter the slab number (e.g. 84, or 84a for an in-between slab)</span>
                </>
              ) : (
                <>
                  <input name="slabNumber" type="text" required defaultValue={defaults?.slabAutofill ?? ""} className={`${inputCls} font-medium`} />
                  <span className="mt-1 block text-[11px] text-gray-400">{defaults ? (defaults.slabAutofill != null ? "auto: last in batch + 1 · editable · extra in-between slab? type e.g. 84a" : "first slab of this batch — enter it manually") : "enter batch — autofills last + 1"}</span>
                </>
              )}
            </label>
          )}
        </div>
      </div>

      <div key={`fields-${version}`}>
        {paramF.length > 0 && (
          <div className="mb-5 rounded-2xl border border-brand/15 bg-brand/[0.02] p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand/80">Batch parameters {defaults ? "· auto-filled" : ""}</div>
            <div className={grid}>{paramF.map((f) => <SlabField key={f.prismaField} f={f} locked={defaults?.values?.[f.prismaField] != null} def={dv(f.prismaField)} opts={options[f.prismaField]} operatorName={operatorName} unlocked={unlocked} onUnlock={(fld) => setUnlocked((s) => new Set(s).add(fld))} required={isRequiredField(model, f.prismaField)} />)}</div>
          </div>
        )}
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Slab details</div>
          <div className={grid}>{slabF.map((f) => <SlabField key={f.prismaField} f={f} locked={false} def={f.prismaField === "qualityGrade" ? "Not graded yet" : ""} opts={options[f.prismaField]} operatorName={operatorName} unlocked={unlocked} onUnlock={(fld) => setUnlocked((s) => new Set(s).add(fld))} required={isRequiredField(model, f.prismaField)} />)}<PhotoFields model={model} grade={grade} onSlotState={(slot, s) => setPhotoState((m) => ({ ...m, [slot]: s }))} /></div>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/85 px-5 py-3 backdrop-blur safe-bottom">
        {/* A refusal this form made outranks the last server answer: the slab on
            screen is the one that was just refused, and leaving a stale green
            "Saved ✓" above it would read as if this one had saved too. */}
        {/* "Saved, but a photo did not land" is amber, not red: the slab IS in
            the table, and red reads as "nothing saved" — which an operator
            answers by entering the slab again. See PHOTO_WARN_PREFIX. */}
        <div className="text-sm">{blocked ? <span className="text-red-600">{blocked}</span> : msg === "ok" ? <span className="text-green-600">Saved &#10003; — enter the next slab</span> : msg?.startsWith(PHOTO_WARN_PREFIX) ? <span className="text-amber-700">{msg}</span> : msg ? <span className="text-red-600">{msg}</span> : <span className="text-gray-400">{tableName} · smart entry</span>}</div>
        <button disabled={pending || compressing} className="min-h-[44px] rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">{pending ? "Saving…" : compressing ? "Compressing photo…" : "Save slab"}</button>
      </div>
    </form>
  );
}
