'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import {
  checkSlabNoAction,
  updateSlabRecordAction,
  type SlabRecordFormState,
} from '@/lib/chromia/server/actions/slab-record';

const INITIAL_STATE: SlabRecordFormState = {};

export interface EditableSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  designFileName: string;
  thicknessCm: string;
  receivedDate: string;
  inTime: string;
  fullyPrintedDate: string;
  remarks: string;
}

/**
 * Correct a slab record.
 *
 * The register's own form, pre-filled with what the record currently says, so
 * the operator corrects a row in the shape they wrote it. Every field they
 * typed is here — including the two the in-charge types at QC — and nothing
 * they did not: grade, outcome and status are decisions, made where they are
 * made, and typing over them here would leave the grade decision and the slab
 * disagreeing.
 *
 * The slab number is checked for a clash as the field is left, so a duplicate
 * is caught while it is still under the operator's finger rather than after
 * the rest of the row has been filled in.
 */
export function EditForm({
  slab,
  baseMaterials,
  fileNames,
  batchNos,
}: {
  slab: EditableSlab;
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(updateSlabRecordAction, INITIAL_STATE);

  const [slabNo, setSlabNo] = useState(slab.slabNo);
  const [baseMaterial, setBaseMaterial] = useState(slab.baseMaterial);
  const [fileName, setFileName] = useState(slab.designFileName);
  const [inTime, setInTime] = useState(slab.inTime);

  /** Set by the on-the-spot check, cleared the moment the number changes. */
  const [duplicate, setDuplicate] = useState(false);
  const [, startCheck] = useTransition();

  useEffect(() => {
    if (state.savedAt) router.push(APP_ROUTES.slabs);
  }, [state.savedAt, router]);

  const checkSlabNo = () => {
    const value = slabNo.trim();
    if (value === '' || value === slab.slabNo) {
      setDuplicate(false);
      return;
    }
    startCheck(async () => {
      const { taken } = await checkSlabNoAction(value, slab.id);
      setDuplicate(taken);
    });
  };

  const errors = state.fieldErrors;
  const slabNoError = errors?.slabNo?.[0] ?? (duplicate ? DUPLICATE_SLAB_NO_MESSAGE : undefined);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="slabId" value={slab.id} />

      <SectionCard title="Slab record" accent="active">
        <FieldGrid columns={3}>
          <Field label="Production Date *" htmlFor="receivedDate" error={errors?.receivedDate?.[0]}>
            <input
              id="receivedDate"
              name="receivedDate"
              type="date"
              required
              defaultValue={slab.receivedDate}
              className={field}
            />
          </Field>

          <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
            <input
              id="batchNo"
              name="batchNo"
              required
              list="edit-batch-list"
              defaultValue={slab.batchNo}
              placeholder="1245"
              className={`${field} font-mono`}
            />
            <datalist id="edit-batch-list">
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

          <Field label="Thickness of Slab (cm)" htmlFor="thicknessCm" error={errors?.thicknessCm?.[0]}>
            <input
              id="thicknessCm"
              name="thicknessCm"
              inputMode="decimal"
              defaultValue={slab.thicknessCm}
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

          <Field
            label="Fully Printed Date"
            htmlFor="fullyPrintedDate"
            error={errors?.fullyPrintedDate?.[0]}
          >
            <input
              id="fullyPrintedDate"
              name="fullyPrintedDate"
              type="date"
              defaultValue={slab.fullyPrintedDate}
              className={field}
            />
          </Field>

          <Field label="Slab Remarks" htmlFor="remarks" error={errors?.remarks?.[0]}>
            <input
              id="remarks"
              name="remarks"
              defaultValue={slab.remarks}
              className={field}
            />
          </Field>
        </FieldGrid>
      </SectionCard>

      <FormError message={state.error} />

      <div className="border-line surface flex flex-wrap items-center justify-end gap-3 rounded-xl border px-6 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <Link
          href={APP_ROUTES.slabs}
          className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending || duplicate}
          className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
