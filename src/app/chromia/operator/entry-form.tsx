'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { nowClockTime } from '@/lib/chromia/clock-time';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { recordOperatorEntryAction, type OperatorFormState } from '@/lib/chromia/server/actions/operator';
import { checkSlabNoAction } from '@/lib/chromia/server/actions/slab-record';

const INITIAL_STATE: OperatorFormState = {};

interface Props {
  /** `yyyy-mm-dd` the register is open on. */
  entryDate: string;
  /** `HH:mm` on the server when the page rendered — avoids a hydration mismatch. */
  nowTime: string;
  nextSerialNo: number;
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
}

export function EntryForm({
  entryDate,
  nowTime,
  nextSerialNo,
  baseMaterials,
  fileNames,
  batchNos,
}: Props) {
  const [state, formAction, isPending] = useActionState(recordOperatorEntryAction, INITIAL_STATE);

  // Batch, material, artwork and thickness stay put between rows — an operator
  // books a whole run of the same thing. Slab no. clears every time.
  const [batchNo, setBatchNo] = useState('');
  const [baseMaterial, setBaseMaterial] = useState('');
  const [fileName, setFileName] = useState('');
  const [thicknessCm, setThicknessCm] = useState('');
  const [slabNo, setSlabNo] = useState('');
  const [inTime, setInTime] = useState(nowTime);

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
    if (value === '') {
      setDuplicate(false);
      return;
    }
    startCheck(async () => {
      const { taken } = await checkSlabNoAction(value);
      setDuplicate(taken);
    });
  };

  useEffect(() => {
    if (!state.savedAt) return;
    setSlabNo('');
    setDuplicate(false);
    setInTime(nowClockTime());
    slabInput.current?.focus();
  }, [state.savedAt]);

  const errors = state.fieldErrors;
  const slabNoError = errors?.slabNo?.[0] ?? (duplicate ? DUPLICATE_SLAB_NO_MESSAGE : undefined);

  return (
    <div className="mb-6">
      <SectionCard
        title="New entry"
        accent="active"
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            Next S. No.{' '}
            <span className="text-foreground font-semibold tabular-nums">{nextSerialNo}</span>
          </span>
        }
      >
        <form action={formAction} className="flex flex-col gap-6">
          <FieldGrid columns={3}>
            <Field label="Production Date *" htmlFor="entryDate" error={errors?.entryDate?.[0]}>
              <input
                id="entryDate"
                name="entryDate"
                type="date"
                required
                defaultValue={entryDate}
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
                autoFocus
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

            <Field label="In-time *" htmlFor="inTime" error={errors?.inTime?.[0]}>
              <TimeInput
                id="inTime"
                name="inTime"
                required
                value={inTime}
                onChange={setInTime}
                className={field}
              />
            </Field>
          </FieldGrid>

          <FormError message={state.error} />

          <div className="border-line flex flex-wrap items-center gap-4 border-t pt-5">
            <button
              type="submit"
              disabled={isPending || duplicate}
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isPending ? 'Saving…' : 'Save entry'}
            </button>

            {state.savedSlabNo && !state.error ? (
              <span className="text-status-done inline-flex items-center gap-2 text-sm font-medium">
                <span className="bg-status-done inline-block size-1.5 rounded-full" />
                Slab {state.savedSlabNo} saved
              </span>
            ) : null}
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
