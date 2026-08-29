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

import { useMemo, useState, useTransition } from "react";
import { Card, H2 } from "@/components/ui";
import { GRADE_OPTIONS, SLAB_STATUSES } from "@/lib/inventory/intakeRules";
import { lookupSlab, saveSlab, type LookupRes, type QcReference } from "./actions";

interface Lists { designs: string[]; issues: string[]; polishTypes: string[]; thicknesses: string[]; bays: string[] }

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available", RESERVED: "Reserved (PI hold)", PACKED: "Packed",
  DISPATCHED: "Dispatched", RETURNED: "Returned", CTS: "Cut to size (CTS)",
};
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
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [issueBox, setIssueBox] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const doLookup = (numStr: string) => {
    startTransition(async () => {
      setNote(null);
      const r = await lookupSlab(numStr);
      setLooked(r);
      if (!r.ok) return;
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

  const doSave = () => {
    if (!looked?.ok) return;
    // An issue typed but not yet pressed into a chip still counts — losing it
    // because the thumb went straight to Save is the kind of quiet data loss
    // this form exists to correct, not commit.
    const issues = issueBox.trim() && !draft.qualityIssue.some((x) => x.toLowerCase() === issueBox.trim().toLowerCase())
      ? [...draft.qualityIssue, issueBox.trim()]
      : draft.qualityIssue;
    startTransition(async () => {
      const r = await saveSlab({
        slabNumber: slabInput,
        expectExisting: looked.exists,
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
      });
      setNote({ text: r.message, ok: r.ok });
      // After a successful save the row on the server is the new truth (a
      // create in particular must flip the form to correction mode), so
      // re-read it rather than trusting the copy that was just typed.
      if (r.ok) {
        const again = await lookupSlab(slabInput);
        setLooked(again);
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

              <div className="grid grid-cols-2 gap-3">
                <Field label="Bay" hint={ref("bayNumber", qc?.bay)}>
                  <input className={inputCls} list="si-bays" value={draft.bayNumber} onChange={(e) => set({ bayNumber: e.target.value })} />
                </Field>
                <Field label="Frame" hint={null}>
                  <input className={inputCls} value={draft.frameNumber} onChange={(e) => set({ frameNumber: e.target.value })} />
                </Field>
              </div>

              <Field label="Status" hint={null}>
                <select className={inputCls} value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                  {SLAB_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
                </select>
              </Field>

              <Field label="Notes" hint={null}>
                <textarea className={inputCls} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>

            {/* the QC-refresh caveat, in one sentence, ON the form */}
            <p className="mt-4 text-xs text-gray-400">
              Design, grade, thickness, quality issues, polish, R/W, repolish, batch and bay belong to QC — they are refreshed automatically if this slab passes QC again, and a re-QC also clears the frame.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={doSave} disabled={pending}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
                {pending ? "Saving…" : exists ? "Save corrections" : "Add slab to finished goods"}
              </button>
              {note && <p className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
