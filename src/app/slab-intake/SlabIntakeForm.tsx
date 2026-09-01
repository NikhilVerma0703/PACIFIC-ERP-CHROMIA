"use client";

// The slab intake form, in plant language — the SimpleMaterialsEntry lesson
// applied before anyone has to report it: one search box, then every detail of
// the slab as a plain labelled field with the current/QC value printed in grey
// beside it, never hidden. No families, no expandable rows, no jargon.
//
// The values shown grey are REFERENCE, the boxes are the DECISION: for an
// existing slab each box holds the inventory's current value and the latest
// Polish QC row is printed beside it where the two disagree; for a missing
// slab the boxes arrive prefilled from whatever the line recorded (Polish QC,
// then Jot, then Press) with the source named under each, so the person checks
// a claim instead of retyping one.
//
// Every server response is a sentence; the buttons disable while a call is in
// flight (double-submit guard); and the gate is the server's — this file only
// renders for people the page already admitted, and every action re-checks.

import { useMemo, useRef, useState, useTransition } from "react";
import { Card, H2 } from "@/components/ui";
import { compressPhoto } from "@/components/PhotoField";
import { GRADE_OPTIONS, SLAB_STATUSES, DEFECT_PHOTOS, type DefectPhotoSlot } from "@/lib/inventory/intakeRules";
import { PAIR_TARGET, PAIR_HARD_MAX } from "@/lib/photoSlots";
import { Lightbox, type LightboxPhoto } from "@/components/Lightbox";
import { lookupSlab, saveSlab, type LookupRes, type QcReference, type SlabPhotos } from "./actions";

interface Lists { designs: string[]; issues: string[]; polishTypes: string[]; thicknesses: string[]; bays: string[] }

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available", RESERVED: "Reserved (PI hold)", PACKED: "Packed",
  DISPATCHED: "Dispatched", RETURNED: "Returned", CTS: "Cut to size (CTS)",
  CHROMIA: "At Chromia (printing)",
};

// TWO photos share one request and the body caps at ~4.5 MB — the figures live
// in photoSlots with the pair, because the QC form carries the same two photos
// under the same budget and the two must not drift apart.
const NO_PHOTOS: Record<DefectPhotoSlot, { file: File | null; state: "" | "busy" | "ready" | "off" }> =
  { far: { file: null, state: "" }, near: { file: null, state: "" } };
const GRADE_LABEL: Record<string, string> = {
  A: "A", A2: "A2", B: "B", C: "C", CTS: "CTS — cut to size",
  SAMPLE: "SAMPLE — cut for samples", Printing: "Printing — Chromia printed slab",
};

/** The form's own working copy of the fields — numbers kept as strings so an
 *  emptied box is "not entered" rather than 0. */
interface Draft {
  design: string; grade: string; slabThickness: string; qualityIssue: string[];
  polishType: string; rwStatus: string; repolishStatus: string; batchNumber: string;
  lengthIn: string; widthIn: string; bayNumber: string; frameNumber: string;
  status: string; notes: string;
}
const emptyDraft: Draft = {
  design: "", grade: "", slabThickness: "", qualityIssue: [], polishType: "",
  rwStatus: "", repolishStatus: "", batchNumber: "", lengthIn: "137", widthIn: "79",
  bayNumber: "", frameNumber: "", status: "AVAILABLE", notes: "",
};

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

function Field({ label, hint, children }: { label: string; hint?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
      {/* grey, never hidden — the reference the box is judged against */}
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

export function SlabIntakeForm({ lists }: { lists: Lists }) {
  const [slabInput, setSlabInput] = useState("");
  const [looked, setLooked] = useState<LookupRes | null>(null);
  // The number the details BELOW belong to — pinned at lookup time. The search
  // box stays editable while the form is open (typing the next number before
  // pressing Look up), and a save must write to the slab that was looked up,
  // never to whatever the box happens to hold at save time.
  const [lookedFor, setLookedFor] = useState("");
  // The search box, so a cleared form puts the cursor where the next slab number goes.
  const slabBox = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [issueBox, setIssueBox] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  // which already-on-file photo is showing full screen (null = none)
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // The two defect photos, compressed in the browser before the post (the
  // PhotoField lesson: camera photos are 4–8 MB and the request body caps at
  // ~4.5 MB). Per-slot generation counter so a re-pick during compression wins.
  const [photos, setPhotos] = useState(NO_PHOTOS);
  // Bumped whenever the slots are cleared, so the (uncontrolled) file inputs
  // remount empty instead of showing a filename the state no longer holds.
  const [photoKey, setPhotoKey] = useState(0);
  const photoGen = useRef<Record<DefectPhotoSlot, number>>({ far: 0, near: 0 });
  const pickPhoto = (slot: DefectPhotoSlot) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    // The chosen file lives in React state from here on, not in the input — so
    // clear the input at once. Otherwise re-picking the SAME file after a
    // failed compression fires no change event and the retry silently does
    // nothing. The ✓ ready / compressing chips are the indicator, not the
    // input's filename.
    e.target.value = "";
    const my = ++photoGen.current[slot];
    if (!f) { setPhotos((p) => ({ ...p, [slot]: { file: null, state: "" } })); return; }
    if (f.size <= 500_000) { setPhotos((p) => ({ ...p, [slot]: { file: f, state: "ready" } })); return; }
    setPhotos((p) => ({ ...p, [slot]: { file: null, state: "busy" } }));
    let use: File | null = null;
    try { use = await compressPhoto(f, { target: PAIR_TARGET, hardMax: PAIR_HARD_MAX }); } catch { use = null; }
    if (!use && f.size <= PAIR_HARD_MAX) use = f;
    if (photoGen.current[slot] !== my) return; // a newer pick took over
    setPhotos((p) => ({ ...p, [slot]: use ? { file: use, state: "ready" } : { file: null, state: "off" } }));
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const doLookup = (numStr: string) => {
    startTransition(async () => {
      setNote(null); setLightbox(null);
      setPhotos(NO_PHOTOS); setPhotoKey((k) => k + 1); // fresh slab, fresh photo slots
      const r = await lookupSlab(numStr);
      setLooked(r);
      if (!r.ok) return;
      setLookedFor(numStr);
      const src = r.exists ? r.slab : r.prefill;
      setDraft({
        design: src.design ?? "", grade: src.grade ?? "",
        slabThickness: src.slabThickness ?? "", qualityIssue: src.qualityIssue ?? [],
        polishType: src.polishType ?? "", rwStatus: src.rwStatus ?? "",
        repolishStatus: src.repolishStatus ?? "", batchNumber: src.batchNumber ?? "",
        lengthIn: src.lengthIn != null ? String(src.lengthIn) : (r.exists ? "" : "137"),
        widthIn: src.widthIn != null ? String(src.widthIn) : (r.exists ? "" : "79"),
        bayNumber: src.bayNumber ?? "", frameNumber: src.frameNumber ?? "",
        status: src.status || "AVAILABLE", notes: src.notes ?? "",
      });
      setIssueBox("");
    });
  };

  /** Which slots a save still has to carry: both on a create, and on an edit
   *  of a MANUAL_ENTRY slab whichever it does not already have from this form.
   *  A slab that arrived from QC or a bulk upload was never photographed by
   *  this form — photos on it are welcome, never demanded. The server
   *  re-derives this for itself — the form saying so first is the courtesy. */
  const photoRequired = (slot: DefectPhotoSlot): boolean =>
    !looked?.ok ? false
    : !looked.exists ? true
    : looked.slab.source === "MANUAL_ENTRY" && looked.photos[slot].length === 0;

  const doSave = () => {
    if (!looked?.ok) return;
    for (const p of DEFECT_PHOTOS) {
      if (photoRequired(p.slot) && !photos[p.slot].file) {
        setNote({ text: `The ${p.label} is required — attach it before saving.`, ok: false });
        return;
      }
    }
    // A typo'd dimension must be refused HERE: Number("13x7") is NaN, and JSON
    // serializes NaN as null — so past this point the server cannot tell a
    // typo from an emptied box, and would clear the stored figure for it.
    for (const [k, label] of [["lengthIn", "length"], ["widthIn", "width"]] as const) {
      const v = draft[k].trim();
      if (v !== "" && !Number.isFinite(Number(v))) {
        setNote({ text: `"${v}" is not a number of inches — fix the ${label} before saving.`, ok: false });
        return;
      }
    }
    // An issue typed but not yet pressed into a chip still counts — losing it
    // because the thumb went straight to Save is the kind of quiet data loss
    // this form exists to correct, not commit.
    const issues = issueBox.trim() && !draft.qualityIssue.some((x) => x.toLowerCase() === issueBox.trim().toLowerCase())
      ? [...draft.qualityIssue, issueBox.trim()]
      : draft.qualityIssue;
    startTransition(async () => {
      // One FormData: the details as a JSON field, the photos as files beside
      // it — the only shape that carries both across a server-action call.
      const out = new FormData();
      out.set("payload", JSON.stringify({
        slabNumber: lookedFor,
        expectExisting: looked.exists,
        // the status the form LOADED — the server refuses a status override
        // built on a copy that has since gone stale
        expectStatus: looked.exists ? looked.slab.status : null,
        details: {
          design: draft.design || null, grade: draft.grade || null,
          slabThickness: draft.slabThickness || null, qualityIssue: issues,
          polishType: draft.polishType || null, rwStatus: draft.rwStatus || null,
          repolishStatus: draft.repolishStatus || null, batchNumber: draft.batchNumber || null,
          lengthIn: draft.lengthIn.trim() === "" ? null : Number(draft.lengthIn),
          widthIn: draft.widthIn.trim() === "" ? null : Number(draft.widthIn),
          bayNumber: draft.bayNumber || null, frameNumber: draft.frameNumber || null,
          status: draft.status, notes: draft.notes || null,
        },
      }));
      for (const p of DEFECT_PHOTOS) {
        const f = photos[p.slot].file;
        if (f) out.set(p.field, f);
      }
      const r = await saveSlab(out);
      setNote({ text: r.message, ok: r.ok });
      // SAVED MEANS DONE: the form clears itself and the cursor goes back to
      // the slab-number box, because the next thing this person does is the
      // next slab — leaving the saved one on screen invited a second save of
      // a row already written, and left its photos looking un-attached. The
      // confirmation sentence stays; everything else resets.
      if (r.ok) {
        setPhotos(NO_PHOTOS); setPhotoKey((k) => k + 1);
        setLooked(null); setLookedFor("");
        setDraft(emptyDraft); setIssueBox(""); setLightbox(null);
        setSlabInput("");
        slabBox.current?.focus();
      }
    });
  };

  const addIssue = (v: string) => {
    const s = v.trim();
    if (!s) return;
    if (!draft.qualityIssue.some((x) => x.toLowerCase() === s.toLowerCase()))
      set({ qualityIssue: [...draft.qualityIssue, s] });
    setIssueBox("");
  };

  const qc: QcReference | null = looked?.ok ? looked.qc : null;
  const exists = looked?.ok ? looked.exists : false;
  const havePhotos: SlabPhotos = looked?.ok && looked.exists ? looked.photos : { far: [], near: [] };
  // Every photo already on file, far first — one flat list so the full-screen
  // viewer can step between them the way it does in inventory.
  const onFile: LightboxPhoto[] = [
    ...havePhotos.far.map((p) => ({ ...p, slot: "far" })),
    ...havePhotos.near.map((p) => ({ ...p, slot: "near" })),
  ];
  const from: Record<string, string> = looked?.ok && !looked.exists ? looked.from : {};
  const current: Record<string, unknown> | null =
    looked?.ok && looked.exists ? (looked.slab as unknown as Record<string, unknown>) : null;

  /** The grey line under a field: for an existing slab, QC's value where it
   *  disagrees with what the inventory holds; for a new one, where the prefill
   *  came from. */
  const ref = useMemo(() => {
    return (field: string, qcValue: string | null | undefined): string | null => {
      if (!looked?.ok) return null;
      if (!current) return from[field] ? `from ${from[field]}` : null;
      const cur = current[field];
      const curStr = Array.isArray(cur) ? cur.join("; ") : cur == null ? "" : String(cur);
      const qcStr = qcValue == null ? "" : String(qcValue);
      if (!qc || qcStr === "" || qcStr === curStr) return null;
      return `QC says: ${qcStr}`;
    };
  }, [looked, current, from, qc]);

  return (
    <div className="space-y-5">
      <Lightbox
        photos={onFile} index={lightbox}
        onIndex={setLightbox} onClose={() => setLightbox(null)}
        title={lookedFor ? `Slab ${lookedFor}` : undefined}
      />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Slab Intake</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add a slab that is missing from finished goods, or check and correct the details of one that is already there.
        </p>
      </div>

      {/* datalists shared by the fields below — the values the inventory actually holds */}
      <datalist id="si-designs">{lists.designs.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="si-issues">{lists.issues.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="si-polish">{lists.polishTypes.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="si-thickness">{lists.thicknesses.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="si-bays">{lists.bays.map((d) => <option key={d} value={d} />)}</datalist>

      <Card>
        <H2>Find the slab</H2>
        <form
          onSubmit={(e) => { e.preventDefault(); doLookup(slabInput); }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-[180px] flex-1 sm:max-w-xs">
            <label className="mb-1 block text-xs font-medium text-gray-600">Slab number</label>
            <input
              ref={slabBox}
              className={inputCls} inputMode="numeric" placeholder="e.g. 144320"
              value={slabInput} onChange={(e) => setSlabInput(e.target.value)}
            />
          </div>
          <button type="submit" disabled={pending || !slabInput.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Looking…" : "Look up"}
          </button>
        </form>
        {looked && !looked.ok && <p className="mt-3 text-sm text-red-600">{looked.message}</p>}
        {looked?.ok && <p className="mt-3 text-sm text-gray-700">{looked.message}</p>}
      </Card>

      {looked?.ok && (
        <>
          {exists && looked.exists && (
            <Card>
              <H2>As the inventory has it</H2>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-gray-400">Status</div><div className="text-gray-900">{STATUS_LABEL[looked.slab.status] ?? looked.slab.status}</div></div>
                <div><div className="text-xs text-gray-400">Source</div><div className="text-gray-900">{looked.slab.source === "QC_AUTOLINK" ? "QC autolink" : looked.slab.source === "BULK_UPLOAD" ? "Bulk upload" : looked.slab.source === "MANUAL_ENTRY" ? "Manual entry" : looked.slab.source}</div></div>
                <div><div className="text-xs text-gray-400">Last QC</div><div className="text-gray-900">{looked.slab.lastQcAt ? new Date(looked.slab.lastQcAt).toLocaleDateString("en-IN") : "never"}{looked.slab.qcInspector ? ` · ${looked.slab.qcInspector}` : ""}</div></div>
                <div><div className="text-xs text-gray-400">PI hold</div><div className="text-gray-900">{looked.slab.reservedForPi ? `PI ${looked.slab.reservedForPi}${looked.slab.customer ? ` · ${looked.slab.customer}` : ""}` : "none"}</div></div>
              </div>
              {/* Holds are the inventory screen's business — this form deliberately cannot touch them. */}
            </Card>
          )}

          <Card>
            <H2>{exists ? "Details — change what is wrong" : "Details — check, then add"}</H2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Design" hint={ref("design", qc?.design)}>
                <input className={inputCls} list="si-designs" value={draft.design}
                  onChange={(e) => set({ design: e.target.value })} placeholder="e.g. Sakura" />
              </Field>

              <Field label="Grade" hint={ref("grade", qc?.grade)}>
                <select className={inputCls} value={draft.grade} onChange={(e) => set({ grade: e.target.value })}>
                  <option value="">Not graded</option>
                  {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{GRADE_LABEL[g] ?? g}</option>)}
                </select>
              </Field>

              {/* Bay sits HERE, in the second row, on the owner's ask ("add bay
                  option in the form"): it already existed but was parked at the
                  bottom under the dimensions, and the bay is the first thing the
                  intake person knows about a slab — they are standing in it. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bay" hint={ref("bayNumber", qc?.bay)}>
                  <input className={inputCls} list="si-bays" value={draft.bayNumber} onChange={(e) => set({ bayNumber: e.target.value })} placeholder="e.g. Bay 2" />
                </Field>
                <Field label="Frame" hint={null}>
                  <input className={inputCls} value={draft.frameNumber} onChange={(e) => set({ frameNumber: e.target.value })} />
                </Field>
              </div>

              <Field label="Thickness" hint={ref("slabThickness", qc?.slabThickness)}>
                <input className={inputCls} list="si-thickness" value={draft.slabThickness}
                  onChange={(e) => set({ slabThickness: e.target.value })} placeholder="e.g. 2 cm" />
              </Field>

              <Field label="Polish" hint={ref("polishType", qc?.polishType)}>
                <input className={inputCls} list="si-polish" value={draft.polishType}
                  onChange={(e) => set({ polishType: e.target.value })} placeholder="Polish / Suede / Honed / Leathered" />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Quality issues" hint={ref("qualityIssue", qc?.qualityIssue?.join("; "))}>
                  <div className="flex flex-wrap items-center gap-2">
                    {draft.qualityIssue.map((q) => (
                      <span key={q} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                        {q}
                        <button type="button" aria-label={`Remove ${q}`} className="text-amber-600 hover:text-amber-900"
                          onClick={() => set({ qualityIssue: draft.qualityIssue.filter((x) => x !== q) })}>×</button>
                      </span>
                    ))}
                    <input className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
                      list="si-issues" value={issueBox} placeholder="Type an issue and press Enter"
                      onChange={(e) => setIssueBox(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addIssue(issueBox); } }}
                      onBlur={() => addIssue(issueBox)} />
                  </div>
                </Field>
              </div>

              <Field label="R/W status" hint={ref("rwStatus", qc?.rwStatus)}>
                <input className={inputCls} value={draft.rwStatus} onChange={(e) => set({ rwStatus: e.target.value })} />
              </Field>

              <Field label="Repolish status" hint={ref("repolishStatus", qc?.repolishStatus)}>
                <input className={inputCls} value={draft.repolishStatus} onChange={(e) => set({ repolishStatus: e.target.value })} />
              </Field>

              <Field label="Batch" hint={ref("batchNumber", qc?.batchNumber)}>
                <input className={inputCls} value={draft.batchNumber} onChange={(e) => set({ batchNumber: e.target.value })} placeholder="e.g. 1350" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Length" hint={null}>
                  <div className="relative">
                    <input className={inputCls + " pr-8"} inputMode="decimal" value={draft.lengthIn}
                      onChange={(e) => set({ lengthIn: e.target.value })} />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">in</span>
                  </div>
                </Field>
                <Field label="Width" hint={'a full slab is 137" × 79"'}>
                  <div className="relative">
                    <input className={inputCls + " pr-8"} inputMode="decimal" value={draft.widthIn}
                      onChange={(e) => set({ widthIn: e.target.value })} />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">in</span>
                  </div>
                </Field>
              </div>

              <Field label="Status" hint={exists && current?.status === "CHROMIA" ? "set by the Chromia register — override it here only to correct a wrong mark" : null}>
                <select className={inputCls} value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                  {/* CHROMIA is the Chromia register's to write (the intake
                      bridge), never a hand target — the option only renders
                      when it IS the current status, so it can be kept or
                      overridden out of, but not chosen into. */}
                  {SLAB_STATUSES
                    .filter((s) => s !== "CHROMIA" || (exists && current?.status === "CHROMIA"))
                    .map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
                </select>
              </Field>

              <Field label="Notes" hint={null}>
                <textarea className={inputCls} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>

            {/* THE TWO MANDATORY DEFECT PHOTOS (owner: "add 2 photo one far
                photo and one near photo of the defect mandatory"). Both are
                required to ADD a slab; on a correction each slot is required
                only while the slab does not already have it from this form —
                and that rule is said here, on the form, not discovered by a
                refusal. Existing photos render as thumbnails so nobody re-takes
                what is already on file. */}
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="text-sm font-semibold text-gray-900">Defect photos — far and near</div>
              <p className="mt-1 text-xs text-gray-500">
                {!exists
                  ? "Both photos are mandatory to add the slab: one from far (the whole slab) and one from near (close on the defect)."
                  : looked.exists && looked.slab.source !== "MANUAL_ENTRY"
                    ? "This slab came in from the production line, not this form — photos are optional here; attach one to put it on file."
                    : havePhotos.far.length > 0 && havePhotos.near.length > 0
                      ? "This slab already has both photos from this form — attach a new one only to add it alongside."
                      : "This slab is missing its defect photos from this form — the missing ones are required to save."}
              </p>
              <div key={photoKey} className="mt-3 grid gap-4 sm:grid-cols-2">
                {DEFECT_PHOTOS.map((p) => {
                  const st = photos[p.slot];
                  const required = photoRequired(p.slot);
                  return (
                    <div key={p.slot}>
                      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                        {p.slot === "far" ? "Far photo — the whole slab" : "Near photo — close on the defect"}
                        {required
                          ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">required</span>
                          : havePhotos[p.slot].length > 0
                            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">on file</span>
                            : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">optional</span>}
                        {st.state === "busy" && <span className="text-[10px] text-amber-600">compressing…</span>}
                        {st.state === "ready" && <span className="text-[10px] text-emerald-600">✓ ready</span>}
                      </span>
                      <input
                        type="file" accept="image/*" capture="environment" onChange={pickPhoto(p.slot)}
                        className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-brand"
                      />
                      {st.state === "off" && (
                        <p className="mt-1 text-xs text-red-600">Couldn&apos;t shrink this photo enough to upload — retake or pick a smaller one.</p>
                      )}
                      {havePhotos[p.slot].length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {havePhotos[p.slot].map((ph) => (
                            <button
                              key={ph.id} type="button" title={`${ph.filename} — click to enlarge`}
                              onClick={() => setLightbox(onFile.findIndex((x) => x.id === ph.id))}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/api/photo?id=${ph.id}`} alt={ph.filename} className="h-16 w-16 rounded-lg border border-gray-200 object-cover transition hover:border-brand" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* the QC-refresh caveat, in one sentence, ON the form */}
            <p className="mt-4 text-xs text-gray-400">
              Design, grade, thickness, quality issues, polish, R/W, repolish, batch and bay belong to QC — they are refreshed automatically if this slab passes QC again, and a re-QC also clears the frame.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={doSave} disabled={pending || photos.far.state === "busy" || photos.near.state === "busy"}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
                {pending ? "Saving…" : photos.far.state === "busy" || photos.near.state === "busy" ? "Compressing photo…" : exists ? "Save corrections" : "Add slab to finished goods"}
              </button>
              {note && <p className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
