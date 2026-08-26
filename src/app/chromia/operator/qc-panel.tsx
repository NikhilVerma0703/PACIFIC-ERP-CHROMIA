'use client';

import { useActionState } from 'react';

import { FormError } from '@/components/chromia/ui';
import { SectionCard } from '@/components/chromia/ui/form';
import {
  completeSlabAction,
  editSlabQcAction,
  type SlabIntakeFormState,
} from '@/lib/chromia/server/actions/slab';

import { QcSection, type Option } from '../slabs/new/qc-section';

const INITIAL_STATE: SlabIntakeFormState = {};

interface Props {
  slabId: string;
  slabNo: string;
  recalibrationReasons: Option[];
  /** The filtered Slab Records query to return to after saving — see slabHref. */
  back?: string;
  /**
   * Correction mode (the Edit path): the QC section opens pre-filled with the
   * slab's current grade and outcome, and saving corrects the same record
   * instead of grading a fresh slab.
   */
  edit?: boolean;
  initial?: { grade?: string; disposition?: string; slabRemarks?: string };
}

/**
 * The QC Section, on the operator's own screen.
 *
 * It used to be the second half of a page of its own — /chromia/slabs/new —
 * whose first half asked for a "fully printed date" that the person grading
 * was not there to know. That page is gone: its first half went with the field
 * and its second half is this, sitting under the entry the slab was booked on
 * with the same grade and outcome rules it always had.
 *
 * Its own form and its own button, deliberately. Correcting what the operator
 * typed and deciding a slab's grade are different acts with different
 * consequences — the grade opens a dispatch, a stock entry or a recalibration
 * trip — and one button that silently did both would make the second one an
 * accident of pressing the first.
 *
 * `QcSection` itself is imported unchanged from where it has always lived, so
 * the allowed grade/outcome pairs stay decided in exactly one place.
 */
export function QcPanel({
  slabId,
  slabNo,
  recalibrationReasons,
  back,
  edit = false,
  initial,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    edit ? editSlabQcAction : completeSlabAction,
    INITIAL_STATE,
  );

  return (
    <div className="mb-6">
      <SectionCard title={edit ? 'QC Section — correct' : 'QC Section'} accent="grade">
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="slabId" value={slabId} />
          {/* The filtered view to return to once this is saved. Absent when the
              slab was not opened from a filtered Slab Records search. */}
          {back ? <input type="hidden" name="back" value={back} /> : null}

          <QcSection
            recalibrationReasons={recalibrationReasons}
            errors={state.fieldErrors}
            initial={edit ? initial : undefined}
          />

          <FormError message={state.error} />

          <div className="border-line flex flex-wrap items-center gap-4 border-t pt-5">
            <button
              type="submit"
              disabled={isPending}
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isPending
                ? 'Saving…'
                : edit
                  ? `Save QC changes for slab ${slabNo}`
                  : `Save QC for slab ${slabNo}`}
            </button>
            <span className="text-muted text-sm">
              {edit
                ? 'This replaces the current grade and outcome on the same record.'
                : 'The entry above stays In-Processing until this is saved.'}
            </span>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
