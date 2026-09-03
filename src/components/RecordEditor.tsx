"use client";

import { useState, useEffect, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { saveRow, createRow, deleteRow } from "@/app/tables/actions";
import { guardAction, SERVER_UNREACHABLE } from "@/lib/guardAction";
import type { FieldMeta } from "@/lib/tables";
import { fmt } from "@/components/ui";
import { secondsToHHMM } from "@/lib/time";
import { THICKNESS_FIELDS, THICKNESS_OPTS, canonThickness } from "@/lib/thickness";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { isRequiredField } from "@/lib/requiredFields";
import { PhotoField, type PhotoFieldState } from "./PhotoField";
import {
  PHOTO_SLOTS, hasPhotoPair, PAIR_TARGET, PAIR_HARD_MAX, PHOTO_WARN_PREFIX,
  REJECT_GRADE_FIELD, REJECT_PHOTOS_RULE, isRejectGrade, rejectPhotosRequired, photoProblem,
  type PhotoSlotName,
} from "@/lib/photoSlots";
import { isCurated } from "@/lib/categoricalFields";
import { classifyMixer, mixerFullLabel } from "@/lib/mixerLabels";
import type { SiloFormInfo } from "@/lib/silo";

const guardedSaveRow = guardAction(saveRow, SERVER_UNREACHABLE);
const guardedCreateRow = guardAction(createRow, SERVER_UNREACHABLE);

const base = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const grid = "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3";

function display(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function SiloInfoCard({ info, siloNo, canEditBags, need }: { info: SiloFormInfo | null; siloNo: string; canEditBags?: boolean; need?: number }) {
  const want = typeof need === "number" && need > 0 ? need : 0;
  if (!info || info.bags === 0) return (
    <div className="mt-2 text-[11px] text-amber-600">
      Silo {siloNo} — empty / no live data
      {want > 0 && <span className="ml-1 font-semibold text-red-600">⚠ short by {fmt(want)} kg (nothing in stock)</span>}
    </div>
  );
  const short = want - info.remaining;
  const meta = [info.grade, info.type].filter(Boolean).join(" · ");
  return (
    <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
      <div>
        {info.size && <span className="font-semibold text-gray-800">{info.size}</span>}
        {meta && <span>{info.size ? " · " : ""}{meta}</span>}
      </div>
      {info.supplier && <div className="text-gray-500">Supplier: {info.supplier}</div>}
      <div className="mb-1 text-gray-500">{fmt(info.remaining)} kg · {info.bags} bag{info.bags > 1 ? "s" : ""}{want > 0 && short <= 0 ? <span className="ml-1 text-green-600">✓ enough for {fmt(want)} kg</span> : null}</div>
      {want > 0 && short > 0 && (
        <div className="mb-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700">⚠ Low stock — needs {fmt(want)} kg, only {fmt(info.remaining)} kg here · short by {fmt(short)} kg</div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {info.bagList.map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] text-gray-700">
            <span className="font-medium">#{b.bagNo ?? "?"}</span>
            <span className="text-gray-400">{fmt(b.remaining ?? 0)} kg</span>
          </span>
        ))}
      </div>
      {canEditBags && <a href={`/tables/Silo?silo=${encodeURIComponent(siloNo)}&from=${encodeURIComponent("/entry/mixer")}`} className="mt-1 inline-block text-[10px] font-medium text-brand hover:underline">Edit bags in Silo table →</a>}
    </div>
  );
}

function SiloSelect({ name, value, onChange, numbers }: { name: string; value: string; onChange: (v: string) => void; numbers: string[] }) {
  const opts = [...new Set([...numbers, ...(value ? [value] : [])])].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)} className={base}>
      <option value="">—</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Grit row: silo dropdown + weight (side by side), live info card full-width below.
function GritRow({ siloField, weightField, gritNumbers, silos, values, canEditBags }: { siloField: FieldMeta; weightField?: FieldMeta; gritNumbers: string[]; silos?: SiloFormInfo[]; values: Record<string, unknown>; canEditBags?: boolean }) {
  const [val, setVal] = useState((values[siloField.prismaField] as string) ?? "");
  const [wt, setWt] = useState(weightField ? String(values[weightField.prismaField] ?? "") : "");
  const info = silos?.find((s) => s.siloNo === val) ?? null;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Silo number</span>
          <SiloSelect name={siloField.prismaField} value={val} onChange={setVal} numbers={gritNumbers} />
        </label>
        {weightField && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">Weight (kg)</span>
            <input name={weightField.prismaField} type="number" step="any" value={wt} onChange={(e) => setWt(e.target.value)} className={base} />
          </label>
        )}
      </div>
      {val && <SiloInfoCard info={info} siloNo={val} canEditBags={canEditBags} need={Number(wt)} />}
    </>
  );
}

function FillerPicker({ name, defaultValue, numbers, silos, canEditBags }: { name: string; defaultValue?: string; numbers: string[]; silos?: SiloFormInfo[]; canEditBags?: boolean }) {
  const [val, setVal] = useState(defaultValue ?? "");
  const info = silos?.find((s) => s.siloNo === val) ?? null;
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Filler silo / buffer</span>
        <SiloSelect name={name} value={val} onChange={setVal} numbers={numbers} />
      </label>
      {val && <SiloInfoCard info={info} siloNo={val} canEditBags={canEditBags} />}
    </div>
  );
}

export function FieldInput({ f, value, opts, operatorName, label, required = false }: { f: FieldMeta; value: unknown; opts?: string[]; operatorName?: string | null; label?: string; required?: boolean }) {
  const niceName = label ?? mixerFullLabel(f.prismaField, f.airtableName);
  const autoOp = f.editable && OPERATOR_FIELDS.has(f.prismaField) && !!operatorName;
  const labelEl = (
    <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
      {niceName}
      {required && <span className="text-red-500" title="Required">*</span>}
      {!f.editable && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">read-only</span>}
      {autoOp && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">you · auto</span>}
    </span>
  );
  let input;
  if (!f.editable) {
    input = <input disabled defaultValue={display(value)} className={base} />;
  } else if (autoOp) {
    const v = value != null && String(value) ? String(value) : (operatorName as string);
    input = <input name={f.prismaField} defaultValue={v} readOnly className={`${base} bg-brand/[0.04] text-gray-700`} />;
  } else if (THICKNESS_FIELDS.has(f.prismaField)) {
    // Canonical thicknesses PLUS any transition values seen in the data (e.g.
    // "3 cm to 2 cm") so edit matches the smart-entry form's full list.
    const all = [...new Set([...THICKNESS_OPTS, ...(opts ?? [])])];
    const canon = canonThickness(value);
    const cur = all.includes(canon) ? canon : (value == null ? "" : String(value));
    const extra = cur && !all.includes(cur) ? [cur] : [];
    input = <select name={f.prismaField} defaultValue={cur} className={base}><option value="">—</option>{[...extra, ...all].map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  } else if (f.airtableType === "duration") {
    input = <input name={f.prismaField} type="time" defaultValue={secondsToHHMM(value)} className={base} />;
  } else if ((f.airtableType === "singleSelect" || isCurated(f.prismaField)) && opts && opts.length) {
    const cur = value == null ? "" : String(value);
    const extra = cur && !opts.includes(cur) ? [cur] : [];
    input = <select name={f.prismaField} defaultValue={cur} required={required} className={base}><option value="">—</option>{[...extra, ...opts].map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  } else if (f.airtableType === "multipleSelects" && opts && opts.length) {
    const arr = Array.isArray(value) ? value.map(String) : [];
    // Mirror the singleSelect branch above: a value this row ALREADY holds must stay
    // rendered even when it is no longer offered, or it silently disappears on save —
    // the checkbox is never drawn, so the browser never submits it. Reasons retired from
    // the MIS list (lib/tables.ts RETIRED_OPTIONS) are exactly this case: 728 rows hold
    // one, and editing any of them for an unrelated reason would have erased it.
    //
    // Compared TRIMMED on both sides, because selectOptions trims the values it offers
    // while the stored value may still carry whitespace from an older Airtable import
    // (live: oven.slab_defect "Cavity " on 119 rows, 12 inventory.design values). A raw
    // comparison would render BOTH "Cavity " and "Cavity" — two identical-looking chips,
    // the very split the trim exists to remove. Matching trimmed shows one, already
    // ticked, and saving writes the clean value, so the row self-heals on edit.
    const norm = (v: string) => v.trim();
    const extra = arr.filter((v) => !opts.some((o) => norm(o) === norm(v)));
    const checked = (o: string) => arr.some((v) => norm(v) === norm(o));
    input = <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto rounded-lg border border-gray-200 p-2">{[...extra, ...opts].map((o) => <label key={o} className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"><input type="checkbox" name={f.prismaField} value={o} defaultChecked={checked(o)} className="h-3.5 w-3.5 rounded border-gray-300 text-brand" />{o}</label>)}</div>;
  } else if (f.kind === "bool") {
    input = <label className="inline-flex cursor-pointer items-center gap-2"><input name={f.prismaField} type="checkbox" defaultChecked={value === true} className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30" /><span className="text-sm text-gray-500">Yes</span></label>;
  } else if (f.kind === "date") {
    const d = value instanceof Date ? value.toISOString().slice(0, 16) : value ? String(value).slice(0, 16) : "";
    input = <input name={f.prismaField} type="datetime-local" defaultValue={d} className={base} />;
  } else {
    const type = f.kind === "number" || f.kind === "int" ? "number" : "text";
    input = <input name={f.prismaField} type={type} step={type === "number" ? "any" : undefined} inputMode={f.kind === "int" ? "numeric" : f.kind === "number" ? "decimal" : undefined} required={required} defaultValue={display(value)} className={base} />;
  }
  return <label className="block">{labelEl}{input}</label>;
}

function groupFields(fs: FieldMeta[]): { title: string; fields: FieldMeta[] }[] {
  const groups = new Map<string, FieldMeta[]>();
  const add = (t: string, f: FieldMeta) => { (groups.get(t) ?? groups.set(t, []).get(t)!).push(f); };
  for (const f of fs) {
    const c = classifyMixer(f.prismaField);
    if (c) { add(`Mixer ${c.mixer}`, f); continue; }
    const m = f.airtableName.match(/^Phase\s*([1-9])\b/i);
    if (m) { add(`Phase ${m[1]}`, f); continue; }
    add("General", f);
  }
  const rank = (t: string) => t === "General" ? 0 : t.startsWith("Mixer") ? 10 + Number(t.split(" ")[1]) : t.startsWith("Phase") ? 30 + Number(t.split(" ")[1]) : 100;
  return [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((t) => ({ title: t, fields: groups.get(t)! }));
}

export function RecordEditor({ model, id, fields, values, mode, options = {}, hideFields = [], operatorName, silos, canEditBags, onSaved, canDelete = false, storedPhotoSlots = [] }: { model: string; id?: string; fields: FieldMeta[]; values: Record<string, unknown>; mode: "edit" | "new"; options?: Record<string, string[]>; hideFields?: string[]; operatorName?: string | null; silos?: SiloFormInfo[]; canEditBags?: boolean; onSaved?: () => void; canDelete?: boolean; storedPhotoSlots?: PhotoSlotName[]; }) {
  // guardAction: a dropped connection mid-save shows in the bar instead of
  // throwing the page to global-error with the edits half typed (lib/guardAction).
  const [msg, action, pending] = useActionState(mode === "edit" ? guardedSaveRow : guardedCreateRow, undefined);
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const onDelete = () => {
    if (!id) return;
    setDelMsg(null);
    if (!window.confirm("Delete this record permanently? It can be restored with Undo.")) return;
    startDelete(async () => {
      const r = await deleteRow(model, id);
      if (r === "ok") { router.push(`/tables/${model}`); router.refresh(); }
      else setDelMsg(r);
    });
  };
  // notify the wrapper (smart mixer form) after a successful save
  useEffect(() => {
    if (!pending && (msg === "ok" || (typeof msg === "string" && msg.startsWith("\u2713")))) {
      setDelMsg(null);
      onSaved?.();
      // A CREATE left every box exactly as typed with the Save button still
      // live under the thumb, so one more tap wrote the record a second time.
      // Only the stations with a natural key (slab+batch, mixer cycle) are
      // caught by the duplicate guards in tables/actions.ts createRow \u2014 a
      // generic table has none, so the second tap simply made a twin row that
      // someone had to find and delete later. A wrapper that supplies onSaved
      // (SmartMixerForm) resets the form itself by remounting it for the next
      // cycle; a standalone /tables/<model>/new has nothing to reset TO, so it
      // leaves for the table listing, where the row it just wrote is visible \u2014
      // that listing IS the confirmation.
      if (mode === "new" && !onSaved) { router.push(`/tables/${model}`); router.refresh(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, msg]);

  // ---- THE REJECT RULE, on the edit screen (lib/photoSlots) ----------------
  // THE BACK DOOR is the point of this half. Guarding only the entry form would
  // make the rule decoration: save the slab as B with no photos, open it here,
  // change the grade to C, done. tables/actions.ts saveRow enforces it for real;
  // this draws it so nobody meets it as a surprise.
  //
  // Two things keep it from bricking honest work, and both mirror what saveRow
  // does — they have to agree, or the screen refuses what the server allows:
  //   * A photo ALREADY ON FILE satisfies its slot. Editing the remarks of a
  //     properly photographed reject must never demand a re-upload of a slab
  //     that has long since left the bay.
  //   * A row that was ALREADY a reject when it loaded is not re-judged. Of the
  //     1,253 'C (Reject)' rows on live Neon (2026-09-04) exactly ONE carries
  //     both photos, because until today the pair was optional here; demanding
  //     them on every edit would make the other 1,252 uncorrectable forever,
  //     and no photograph of those slabs can be taken now. The rule bites where
  //     it was asked to: on a grade being CHANGED to C.
  const storedSlots = new Set<PhotoSlotName>(storedPhotoSlots);
  const loadedGrade = display(values[REJECT_GRADE_FIELD]);
  const [grade, setGrade] = useState(loadedGrade);
  const [photoState, setPhotoState] = useState<Record<string, PhotoFieldState>>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  const wasReject = mode === "edit" && isRejectGrade(loadedGrade);
  const mustPhoto = rejectPhotosRequired(model, grade) && !wasReject;
  const slotRequired = (slot: PhotoSlotName) => mustPhoto && !storedSlots.has(slot);

  const guardRejectPhotos = (e: React.FormEvent<HTMLFormElement>) => {
    if (!mustPhoto) { setBlocked(null); return; }
    const fd = new FormData(e.currentTarget);
    for (const p of PHOTO_SLOTS) {
      if (!slotRequired(p.slot)) continue;
      // The same three conditions the server applies — see the note on the
      // twin guard in SmartSlabForm; a size-only test refuses on the server
      // for a photo this screen called acceptable.
      const bad = photoProblem(fd.get(p.field), p.label);
      if (!bad) continue;
      e.preventDefault();
      setBlocked(photoState[p.slot] === "busy"
        ? `The ${p.label} is still compressing — wait for “✓ ready”, then save.`
        : `${REJECT_PHOTOS_RULE} ${bad}`);
      return;
    }
    setBlocked(null);
  };
  const compressing = mustPhoto && PHOTO_SLOTS.some((p) => slotRequired(p.slot) && photoState[p.slot] === "busy");

  const hidden = new Set(hideFields);
  const editable = fields.filter((f) => f.editable && !hidden.has(f.prismaField));

  const isMixerToggle = (f: FieldMeta) => /^mixer[1-4]$/.test(f.prismaField);
  const mixerToggles = editable.filter(isMixerToggle);
  const groups = groupFields(editable.filter((f) => !isMixerToggle(f)));
  const mixerGroups = groups.filter((g) => /^Mixer [1-4]$/.test(g.title));
  const otherGroups = groups.filter((g) => !/^Mixer [1-4]$/.test(g.title));
  const mixerNums = [...new Set([...mixerGroups.map((g) => Number(g.title.split(" ")[1])), ...mixerToggles.map((f) => Number(f.prismaField.replace("mixer", "")))])].sort();
  const hasMixers = mixerNums.length > 0;
  const grouped = otherGroups.length > 1 || hasMixers;

  const [active, setActive] = useState<Set<number>>(() => new Set(mixerNums.filter((n) => values[`mixer${n}`] === true)));
  const toggle = (n: number) => setActive((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });

  const gritNumbers = (silos ?? []).filter((s) => s.kind === "grit").map((s) => s.siloNo);
  const fillerNumbers = [...new Set([...(options["fillerSiloBuffer"] ?? []), ...(silos ?? []).filter((s) => s.kind === "filler").map((s) => s.siloNo)])];

  const renderFields = (fs: FieldMeta[]) => fs.map((f) =>
    f.prismaField === "fillerSiloBuffer"
      ? <FillerPicker key={f.prismaField} name={f.prismaField} defaultValue={values[f.prismaField] as string} numbers={fillerNumbers} silos={silos} canEditBags={canEditBags} />
      : <FieldInput key={f.prismaField} f={f} value={values[f.prismaField]} opts={options[f.prismaField]} operatorName={operatorName} required={isRequiredField(model, f.prismaField)} />);

  function renderMixer(n: number, fs: FieldMeta[]) {
    const grits = new Map<number, { silo?: FieldMeta; weight?: FieldMeta }>();
    let filler: FieldMeta | undefined, resinW: FieldMeta | undefined, resinD: FieldMeta | undefined;
    const others: FieldMeta[] = [];
    for (const f of fs) {
      const c = classifyMixer(f.prismaField);
      if (!c) { others.push(f); continue; }
      if (c.kind === "silo" && c.grit) { const e = grits.get(c.grit) ?? {}; e.silo = f; grits.set(c.grit, e); }
      else if (c.kind === "weight" && c.grit) { const e = grits.get(c.grit) ?? {}; e.weight = f; grits.set(c.grit, e); }
      else if (c.kind === "filler") filler = f;
      else if (c.kind === "resinWeight") resinW = f;
      else if (c.kind === "resinDtn") resinD = f;
      else others.push(f);
    }
    const gritNumsLocal = [...grits.keys()].sort((a, b) => a - b);
    return (
      <div className="mt-4 rounded-xl border border-brand/25 bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-brand">Mixer {n}</div>
        <div className="space-y-2.5">
          {gritNumsLocal.map((g) => {
            const e = grits.get(g)!;
            return (
              <div key={g} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Grit {g}</div>
                {e.silo
                  ? <GritRow siloField={e.silo} weightField={e.weight} gritNumbers={gritNumbers} silos={silos} values={values} canEditBags={canEditBags} />
                  : (e.weight && <FieldInput f={e.weight} value={values[e.weight.prismaField]} label="Weight (kg)" />)}
              </div>
            );
          })}
          {(filler || resinW || resinD) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Filler &amp; resin</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {filler && <FieldInput f={filler} value={values[filler.prismaField]} label="Filler weight (kg)" />}
                {resinW && <FieldInput f={resinW} value={values[resinW.prismaField]} label="Resin weight (kg)" />}
                {resinD && <FieldInput f={resinD} value={values[resinD.prismaField]} opts={options[resinD.prismaField]} label="Resin DTN" />}
              </div>
            </div>
          )}
          {others.length > 0 && <div className={grid}>{others.map((f) => <FieldInput key={f.prismaField} f={f} value={values[f.prismaField]} opts={options[f.prismaField]} operatorName={operatorName} required={isRequiredField(model, f.prismaField)} />)}</div>}
        </div>
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={guardRejectPhotos}
      // Change events bubble, so one listener sees the grade select without the
      // uncontrolled FieldInput having to know the reject rule exists.
      onChange={(e) => {
        // React types a bubbled change target as the FORM, not the control that
        // fired it — hence the widening. All this listener reads is name+value,
        // which every input and select carries.
        const t = e.target as unknown as { name?: string; value?: string };
        if (t.name === REJECT_GRADE_FIELD) { setGrade(t.value ?? ""); setBlocked(null); }
        else if (PHOTO_SLOTS.some((p) => p.field === t.name)) setBlocked(null);
      }}
    >
      <input type="hidden" name="__model" value={model} />
      {id ? <input type="hidden" name="__id" value={id} /> : null}
      {hideFields.map((hf) => values[hf] != null ? <input key={hf} type="hidden" name={hf} value={String(values[hf])} /> : null)}

      {grouped ? otherGroups.map((g) => (
        g.title === "General"
          ? <div key="General" className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Details</div>
              <div className={grid}>{renderFields(g.fields)}</div>
            </div>
          : <details key={g.title} open className="group mb-4 rounded-2xl border border-gray-200 bg-white/60 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-gray-700"><span>{g.title} <span className="font-normal text-gray-400">· {g.fields.length}</span></span><span className="text-gray-400 transition group-open:rotate-180">▾</span></summary>
              <div className={`${grid} mt-4`}>{renderFields(g.fields)}</div>
            </details>
      )) : (
        <div className={grid}>{renderFields(editable)}</div>
      )}

      {hasMixers && (
        <div className="mb-4 rounded-2xl border border-brand/20 bg-brand/[0.03] p-4">
          <div className="mb-1 text-sm font-semibold text-gray-700">Mixers used</div>
          <p className="mb-3 text-xs text-gray-500">Select the mixers in use, then fill grit/silo, weights, filler and resin for each.</p>
          <div className="flex flex-wrap gap-2">
            {mixerNums.map((n) => (
              <button type="button" key={n} onClick={() => toggle(n)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${active.has(n) ? "bg-brand text-white shadow-sm" : "border border-gray-300 text-gray-600 hover:bg-white"}`}>
                Mixer {n}
              </button>
            ))}
          </div>
          {[...active].map((n) => <input key={n} type="checkbox" name={`mixer${n}`} defaultChecked readOnly className="hidden" />)}

          {mixerNums.filter((n) => active.has(n)).map((n) => {
            const grp = mixerGroups.find((g) => Number(g.title.split(" ")[1]) === n);
            return <div key={n}>{renderMixer(n, grp?.fields ?? [])}</div>;
          })}
          {active.size === 0 && <p className="mt-4 text-sm text-gray-400">No mixer selected yet.</p>}
        </div>
      )}

      {/* The same slots the record's own entry form offers, so a photo missed
          at the machine — or a second, better one — can be added from tables
          (owner, 2026-09-01). Added, not replaced: the strip above this form
          keeps every photo, because a defect photo is evidence. */}
      {hasPhotoPair(model) ? (
        <div className="mb-4 max-w-2xl">
          {mustPhoto && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
              <b>C (Reject)</b> — both photos are mandatory before this grade can be saved: the {PHOTO_SLOTS.map((p) => p.label).join(" and the ")}.
              {storedSlots.size > 0 && " Photos already on file count — only the missing ones are asked for."}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PHOTO_SLOTS.map((p) => (
              <PhotoField
                key={p.slot} field={p.field} label={p.title} hint={p.hint}
                target={PAIR_TARGET} hardMax={PAIR_HARD_MAX}
                status={slotRequired(p.slot) ? "required" : storedSlots.has(p.slot) ? "onFile" : "optional"}
                onState={(s) => setPhotoState((m) => ({ ...m, [p.slot]: s }))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 max-w-sm"><PhotoField /></div>
      )}
      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/85 px-5 py-3 backdrop-blur safe-bottom">
        {/* A refusal this screen made outranks the last server answer — see the
            same rule in SmartSlabForm's bottom bar. */}
        {/* Amber for "saved, but a photo did not land" — the edit IS stored and
            must not be retyped, but it is not the green everything-landed
            either. Same rule as SmartSlabForm's bar; see PHOTO_WARN_PREFIX. */}
        <div className="text-sm">{blocked ? <span className="text-red-600">{blocked}</span> : delMsg ? <span className="text-red-600">{delMsg}</span> : msg === "ok" ? <span className="text-green-600">Saved &#10003;</span> : msg?.startsWith("✓") ? <span className="text-green-600">{msg}</span> : msg?.startsWith(PHOTO_WARN_PREFIX) ? <span className="text-amber-700">{msg}</span> : msg ? <span className="text-red-600">{msg}</span> : <span className="text-gray-400">{editable.length} editable fields</span>}</div>
        <div className="flex items-center gap-2">
          {mode === "edit" && canDelete && id && (
            <button type="button" onClick={onDelete} disabled={deleting || pending}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          <button disabled={pending || deleting || compressing} className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">{pending ? "Saving…" : compressing ? "Compressing photo…" : mode === "edit" ? "Save changes" : "Create record"}</button>
        </div>
      </div>
    </form>
  );
}
