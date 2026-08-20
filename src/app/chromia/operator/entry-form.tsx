'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { recordOperatorEntryAction, type OperatorFormState } from '@/lib/chromia/server/actions/operator';
import { checkSlabNoAction } from '@/lib/chromia/server/actions/slab-record';
import { updateSlabRecordAction } from '@/lib/chromia/server/actions/slab-record';

const INITIAL_STATE: OperatorFormState = {};

/** The slab this form is correcting, when it is open on one. */
export interface EditingSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessCm: string;
  receivedDate: string;
  inTime: string;
  remarks: string;
}

interface Props {
  /** `yyyy-mm-dd` the blank form starts on. */
  entryDate: string;
  /** `HH:mm` on the server when the page rendered — avoids a hydration mismatch. */
  nowTime: string;
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
  /** Set when the screen is open on an existing slab — see the operator page. */
  editing?: EditingSlab;
}

export function EntryForm({
  entryDate,
  nowTime,
  baseMaterials,
  fileNames,
  batchNos,
  editing,
}: Props) {
  const isEditing = editing !== undefined;

  /*
   * One form, two actions. Saving a new row records an entry; saving an open
   * slab corrects it. The two server actions return the same shape, so the
   * form does not care which it called — and keeping it one component is what
   * stops the fields and their rules drifting apart, which is the whole reason
   * a correction is held to the same schema as the original entry.
   */
  const [state, formAction, isPending] = useActionState<OperatorFormState, FormData>(
    isEditing ? updateSlabRecordAction : recordOperatorEntryAction,
    INITIAL_STATE,
  );

  /*
   * PRODUCTION DATE STAYS PUT. It used to be an uncontrolled input whose
   * defaultValue was today, and React resets uncontrolled fields after a form
   * action — so every save silently sent the date back to today. An operator
   * catching up on Tuesday's production would set the date once, save, and the
   * next four slabs would be booked against today without anyone seeing it.
   *
   * It is held in state now, like the batch and the material either side of it:
   * the operator sets it when the day changes and not before.
   *
   * Every field below is seeded from props ONCE, so the page mounts this with a
   * `key` that changes with the slab. That is not belt and braces: the App
   * Router deliberately keeps a segment's React state across a search-param
   * change ("search params do not cause state to be lost"), so navigating from
   * one ?slab= to another re-renders this component rather than remounting it.
   * Without the key the hidden slabId and the action would switch to the new
   * slab while the visible fields still held the old one's values — and the
   * next Save would write them onto it.
   */
  const [productionDate, setProductionDate] = useState(editing?.receivedDate ?? entryDate);

  // Batch, material, artwork and thickness stay put between rows — an operator
  // books a whole run of the same thing. Slab no. clears every time.
  const [batchNo, setBatchNo] = useState(editing?.batchNo ?? '');
  const [baseMaterial, setBaseMaterial] = useState(editing?.baseMaterial ?? '');
  const [fileName, setFileName] = useState(editing?.fileName ?? '');
  const [thicknessCm, setThicknessCm] = useState(editing?.thicknessCm ?? '');
  const [slabNo, setSlabNo] = useState(editing?.slabNo ?? '');
  /* Blank, not the clock. The in-time is optional now, and pre-filling it with
     "now" made a guess look like a reading on every row that was left alone. */
  const [inTime, setInTime] = useState(editing?.inTime ?? '');
  /* Only sent when correcting — a new entry has no remark yet, and the QC
     section is what writes one. See the field below. */
  const [remarks, setRemarks] = useState(editing?.remarks ?? '');

  const slabInput = useRef<HTMLInputElement>(null);

  /**
   * Caught as the operator leaves the field, not after the whole row is filled
   * in. The save is refused by the service and by the database's unique index
   * as well — this is the courtesy, not the guard.
   */
  const [duplicate, setDuplicate] = useState(false);
  const [, startCheck] = useTransition();

  const checkSlabNo = () => {
    const value = slabNo.trim();
    // The slab keeps its own number when its own entry is being corrected.
    if (value === '' || value === editing?.slabNo) {
      setDuplicate(false);
      return;
    }
    startCheck(async () => {
      const { taken } = await checkSlabNoAction(value);
      setDuplicate(taken);
    });
  };

  useEffect(() => {
    if (!state.savedAt || isEditing) return;
    // Only the slab number and the in-time clear: everything else is the run
    // the operator is still booking, the production date included.
    setSlabNo('');
    setInTime('');
    setDuplicate(false);
    slabInput.current?.focus();
  }, [state.savedAt, isEditing]);

  const errors = state.fieldErrors;
  const slabNoError = errors?.slabNo?.[0] ?? (duplicate ? DUPLICATE_SLAB_NO_MESSAGE : undefined);
  const dateFieldName = isEditing ? 'receivedDate' : 'entryDate';
  const dateError = (isEditing ? errors?.receivedDate?.[0] : errors?.entryDate?.[0]) ?? undefined;

  /* An error under a field this form does not render has nowhere to appear, and
     the screen would simply sit still on Save — which is exactly what a missing
     `remarks` field did. Anything unplaced is said in the banner instead. */
  const shown = new Set(['entryDate', 'receivedDate', 'batchNo', 'slabNo', 'baseMaterial', 'fileName', 'thicknessCm', 'inTime', 'remarks']);
  const unplaced = Object.entries(errors ?? {})
    .filter(([key, messages]) => !shown.has(key) && messages && messages.length > 0)
    .map(([key, messages]) => `${key}: ${messages?.[0]}`)
    .join(' · ');

  return (
    <div className="mb-6">
      <SectionCard
        title={isEditing ? `Entry — slab ${editing.slabNo}` : 'New entry'}
        accent="active"
      >
        <form action={formAction} className="flex flex-col gap-6">
          {isEditing ? <input type="hidden" name="slabId" value={editing.id} /> : null}

          <FieldGrid columns={3}>
            <Field label="Production Date *" htmlFor={dateFieldName} error={dateError}>
              <input
                id={dateFieldName}
                name={dateFieldName}
                type="date"
                required
                value={productionDate}
                onChange={(event) => setProductionDate(event.target.value)}
                className={field}
              />
            </Field>

            <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
              <input
                id="batchNo"
                name="batchNo"
                required
                list="batch-list"
                value={batchNo}
                onChange={(event) => setBatchNo(event.target.value)}
                placeholder="1245"
                className={`${field} font-mono`}
              />
              <datalist id="batch-list">
                {batchNos.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>

            <Field label="Slab No. *" htmlFor="slabNo" error={slabNoError}>
              <input
                id="slabNo"
                name="slabNo"
                required
                autoFocus={!isEditing}
                ref={slabInput}
                value={slabNo}
                onChange={(event) => {
                  setSlabNo(event.target.value);
                  setDuplicate(false);
                }}
                onBlur={checkSlabNo}
                placeholder="130520"
                aria-invalid={slabNoError ? true : undefined}
                className={`${field} font-mono ${slabNoError ? 'border-status-waste' : ''}`}
              />
            </Field>

            {/*
             * Pick from the list, or type something the list has never seen.
             *
             * A plain select cannot express "one of these, or a new one", and a
             * material that arrived this morning is not a reason to stop the
             * register. The server matches what is typed against the existing
             * records — ignoring case and stray spaces — and creates one only
             * when the name is genuinely new.
             */}
            <Field
              label="Base Material / Slab Name *"
              htmlFor="baseMaterial"
              error={errors?.baseMaterial?.[0]}
            >
              <ComboInput
                id="baseMaterial"
                name="baseMaterial"
                options={baseMaterials}
                value={baseMaterial}
                onChange={setBaseMaterial}
                required
                placeholder="Pick one, or type a new name"
                className={selectField}
              />
            </Field>

            <Field
              label="File Name / Planned Design *"
              htmlFor="fileName"
              error={errors?.fileName?.[0]}
            >
              <ComboInput
                id="fileName"
                name="fileName"
                options={fileNames}
                value={fileName}
                onChange={setFileName}
                required
                placeholder="Pick one, or type a new design"
                className={selectField}
              />
            </Field>

            <Field
              label="Thickness of Slab (cm)"
              htmlFor="thicknessCm"
              error={errors?.thicknessCm?.[0]}
            >
              <input
                id="thicknessCm"
                name="thicknessCm"
                inputMode="decimal"
                value={thicknessCm}
                onChange={(event) => setThicknessCm(event.target.value)}
                placeholder="2"
                className={field}
              />
            </Field>

            {/* No asterisk: the in-time is genuinely sometimes not known when
                the row is written, and refusing the entry over it only bought a
                guessed time that nothing downstream can tell from a real one. */}
            <Field label="In-time" htmlFor="inTime" error={errors?.inTime?.[0]}>
              <TimeInput
                id="inTime"
                name="inTime"
                value={inTime}
                onChange={setInTime}
                placeholder={nowTime}
                className={field}
              />
            </Field>

            {/*
             * Only when correcting, and it MUST be rendered then. The
             * correction is a whole-record save: the service writes
             * `remarks: input.remarks ?? null`, so a form that does not send
             * the field would blank whatever QC wrote there. Leaving it out
             * did worse than that — FormData.get returns null for a field that
             * is not in the document, the schema takes a string or nothing but
             * never null, and every "Save changes" failed the parse with the
             * error landing under a field that was not on screen to show it.
             */}
            {isEditing ? (
              <Field label="Slab Remarks" htmlFor="remarks" error={errors?.remarks?.[0]}>
                <input
                  id="remarks"
                  name="remarks"
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  placeholder="Dispatch · Stock · RECALIBRATE - reason"
                  className={field}
                />
              </Field>
            ) : null}
          </FieldGrid>

          <FormError message={state.error ?? (unplaced || undefined)} />

          <div className="border-line flex flex-wrap items-center gap-4 border-t pt-5">
            <button
              type="submit"
              disabled={isPending || duplicate}
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Save entry'}
            </button>

            {state.savedSlabNo && !state.error ? (
              <span className="text-status-done inline-flex items-center gap-2 text-sm font-medium">
                <span className="bg-status-done inline-block size-1.5 rounded-full" />
                Slab {state.savedSlabNo} {isEditing ? 'updated' : 'saved'}
              </span>
            ) : null}
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
