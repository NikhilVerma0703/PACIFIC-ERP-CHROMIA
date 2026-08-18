'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { completeSlabAction, type SlabIntakeFormState } from '@/lib/chromia/server/actions/slab';

import { QcSection, type Option } from './qc-section';
import { field, SectionCard } from './ui';

/** The slab being finished, as the operator entered it. */
export interface ExistingSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  designFileName: string;
  thicknessCm: string;
  receivedDate: string;
  fullyPrintedDate: string;
}

interface Props {
  recalibrationReasons: Option[];
  today: string;
  existing: ExistingSlab;
}

const INITIAL_STATE: SlabIntakeFormState = {};

/**
 * Slab intake — the QC half of a slab's life.
 *
 * Everything about the slab itself is recorded by the operator when it goes on
 * the line: batch, number, material, artwork, thickness. Asking for it a second
 * time here only invited a second, different answer. What is genuinely new
 * after processing is the day it came off printed and the quality decision, so
 * that is all this page shows.
 */
export function IntakeForm({ recalibrationReasons, today, existing }: Props) {
  const [state, formAction, isPending] = useActionState(completeSlabAction, INITIAL_STATE);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="slabId" value={existing.id} />

      {/* ------------------------------------- fully printed date --- */}
      <div className="border-line surface rounded-xl border px-7 py-6 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="mx-auto w-full max-w-xs">
          <Field
            label="Fully Printed Date"
            htmlFor="fullyPrintedDate"
            error={errors?.fullyPrintedDate?.[0]}
          >
            <input
              id="fullyPrintedDate"
              name="fullyPrintedDate"
              type="date"
              defaultValue={existing.fullyPrintedDate}
              className={field}
            />
          </Field>
        </div>
      </div>

      {/* ------------------------------------------------ QC Section --- */}
      <SectionCard title="QC Section" accent="grade">
        <QcSection
          recalibrationReasons={recalibrationReasons}
          today={today}
          errors={errors}
        />
      </SectionCard>

      <FormError message={state.error} />

      {/* -------------------------------------------------- actions --- */}
      <div className="border-line surface flex flex-wrap items-center justify-end gap-3 rounded-xl border px-6 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <Link
          href={APP_ROUTES.slabs}
          className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? 'Saving…' : 'Save slab entry'}
        </button>
      </div>
    </form>
  );
}
