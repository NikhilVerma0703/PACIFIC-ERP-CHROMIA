'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { field, SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { saveTripAction, type RecalibrationFormState } from '@/lib/chromia/server/actions/recalibration-flow';

const INITIAL_STATE: RecalibrationFormState = {};

export interface TripSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  designFileName: string;
  remarks: string;
  sentDate: string;
  receivedDate: string;
}

/** Read-only identity, so the in-charge can see they have the right slab. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted mb-1 text-[11px] font-semibold tracking-[0.12em] uppercase">
        {label}
      </p>
      <p className="text-[15px] font-medium">{value || '—'}</p>
    </div>
  );
}

/**
 * The trip out of the plant.
 *
 * Two dates and nothing else. They are filled in on two different days — the
 * slab goes out with a load, and comes back a week or a month later — so the
 * same form is opened twice rather than splitting a single physical journey
 * across two screens. Everything above them is what QC and the operator have
 * already recorded, shown but not editable: this screen exists to record where
 * the slab went, not to re-litigate what it is.
 */
export function TripForm({ slab }: { slab: TripSlab }) {
  const [state, formAction, isPending] = useActionState(saveTripAction, INITIAL_STATE);
  const errors = state.fieldErrors;
  const alreadySent = slab.sentDate !== '';

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="slabId" value={slab.id} />

      <SectionCard title="Slab" accent="brand">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Batch No." value={slab.batchNo} />
          <Detail label="Slab No." value={slab.slabNo} />
          <Detail label="Base Material / Slab Name" value={slab.baseMaterial} />
          <Detail label="File Name / Planned Design" value={slab.designFileName} />
          <Detail label="Slab Remarks" value={slab.remarks} />
        </div>
      </SectionCard>

      <SectionCard title="Recalibration Trip" accent="grade">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Field
            label="Sent Date for Recalibration"
            htmlFor="sentDate"
            error={errors?.sentDate?.[0]}
          >
            <input
              id="sentDate"
              name="sentDate"
              type="date"
              required
              defaultValue={slab.sentDate}
              className={field}
            />
          </Field>

          <Field
            label="Received Date from Recalibration"
            htmlFor="receivedDate"
            error={errors?.receivedDate?.[0]}
            hint={alreadySent ? undefined : 'Leave empty until the slab comes back'}
          >
            <input
              id="receivedDate"
              name="receivedDate"
              type="date"
              defaultValue={slab.receivedDate}
              className={field}
            />
          </Field>
        </div>
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
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
