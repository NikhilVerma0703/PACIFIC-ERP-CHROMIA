'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  restartProductionAction,
  type RecalibrationFormState,
} from '@/lib/chromia/server/actions/recalibration-flow';

const INITIAL_STATE: RecalibrationFormState = {};

export interface RestartSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  designFileName: string;
  thicknessCm: string;
  receivedDate: string;
}

/**
 * Back on the line, after a trip to the recalibration department.
 *
 * The operator's register, pre-filled from what this slab already was. Every
 * field stays editable, because a recalibrated slab is genuinely different
 * when it comes back: it is thinner, and the design is sometimes reassigned
 * before the second pass. Saving opens a new production cycle — the failed
 * pass keeps its own in-time, out-time, grade and QC record for ever.
 */
export function RestartForm({
  slab,
  attempt,
  baseMaterials,
  fileNames,
  batchNos,
  today,
  nowTime,
}: {
  slab: RestartSlab;
  attempt: number;
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
  today: string;
  nowTime: string;
}) {
  const [state, formAction, isPending] = useActionState(restartProductionAction, INITIAL_STATE);
  const errors = state.fieldErrors;

  const [baseMaterial, setBaseMaterial] = useState(slab.baseMaterial);
  const [fileName, setFileName] = useState(slab.designFileName);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="slabId" value={slab.id} />

      <SectionCard title={`After Recalibration Attempt ${attempt}`} accent="grade">
        <FieldGrid columns={3}>
          <Field label="Production Date *" htmlFor="receivedDate" error={errors?.receivedDate?.[0]}>
            <input
              id="receivedDate"
              name="receivedDate"
              type="date"
              required
              defaultValue={today}
              className={field}
            />
          </Field>

          <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
            <input
              id="batchNo"
              name="batchNo"
              required
              list="restart-batch-list"
              defaultValue={slab.batchNo}
              className={`${field} font-mono`}
            />
            <datalist id="restart-batch-list">
              {batchNos.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>

          <Field label="Slab No. *" htmlFor="slabNo" error={errors?.slabNo?.[0]}>
            <input
              id="slabNo"
              name="slabNo"
              required
              defaultValue={slab.slabNo}
              className={`${field} font-mono`}
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
              defaultValue={nowTime}
              className={field}
            />
          </Field>
        </FieldGrid>
      </SectionCard>

      <FormError message={state.error} />

      <div className="border-line surface flex flex-wrap items-center justify-end gap-3 rounded-xl border px-6 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <Link
          href={APP_ROUTES.recalibrations}
          className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? 'Saving…' : 'Save entry'}
        </button>
      </div>
    </form>
  );
}
