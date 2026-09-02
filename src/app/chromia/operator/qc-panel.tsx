'use client';

import { useActionState, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { FormError } from '@/components/chromia/ui';
import { SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
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
  /**
   * Where the slab was opened from — a full in-app path, filters and all, to
   * return to once QC is saved (the filtered Slab Records view, say). Absent
   * when the slab was opened from Operator Entry, which is then the default.
   */
  back?: string;
  /**
   * Correction mode (the Edit path): the QC section opens pre-filled with the
   * slab's current grade and outcome, and saving corrects the same record
   * instead of grading a fresh slab.
   */
  edit?: boolean;
  initial?: { grade?: string; disposition?: string; slabRemarks?: string };
}

/** Only an in-app Chromia path is ever navigated to, so a stray `back` can
 *  never send the grader off the module. */
function returnTarget(back?: string): string {
  return back && back.startsWith('/chromia/') ? back : APP_ROUTES.operator;
}

/**
 * The QC Section, on the operator's own screen.
 *
 * Its own form and its own button, deliberately — correcting the operator's
 * entry and deciding a slab's grade are different acts, and the grade opens a
 * dispatch, a stock entry or a recalibration trip.
 *
 * ── SAVE, THEN RETURN — WITHOUT A SERVER REDIRECT ─────────────────────────
 * The action reports success and nothing more (see slab.ts): it does NOT
 * redirect. A server redirect inside a useActionState action kept this button
 * pinned on "Saving…" until a heavy destination page finished rendering, which
 * on a slow render never happened — the save looked stuck though it had
 * committed. Here instead the button's pending clears the instant the save
 * returns, and THIS component then navigates the grader back to wherever the
 * slab was opened from: the same filtered Slab Records view, or Operator Entry.
 * Every outcome returns the same way — Recalibration included; it no longer
 * jumps to the Recalibration page. The button stays disabled from the first
 * click through the return, so a slab is never double-graded and the control is
 * never left in a stuck state.
 */
export function QcPanel({
  slabId,
  slabNo,
  recalibrationReasons,
  back,
  edit = false,
  initial,
}: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    edit ? editSlabQcAction : completeSlabAction,
    INITIAL_STATE,
  );
  const [isReturning, startReturn] = useTransition();
  const returnedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || returnedFor.current === state.savedAt) return;
    returnedFor.current = state.savedAt; // navigate once per successful save
    startReturn(() => router.push(returnTarget(back)));
  }, [state.savedAt, back, router]);

  const saved = Boolean(state.savedAt);
  // Disabled from the click through the return: no second submit, and never a
  // control left enabled while work is still in flight.
  const busy = isPending || isReturning || saved;

  return (
    <div className="mb-6">
      <SectionCard title={edit ? 'QC Section — correct' : 'QC Section'} accent="grade">
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="slabId" value={slabId} />

          <QcSection
            recalibrationReasons={recalibrationReasons}
            errors={state.fieldErrors}
            initial={edit ? initial : undefined}
          />

          <FormError message={state.error} />

          <div className="border-line flex flex-wrap items-center gap-4 border-t pt-5">
            <button
              type="submit"
              disabled={busy}
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isPending
                ? 'Saving…'
                : saved
                  ? 'Saved — returning…'
                  : edit
                    ? `Save QC changes for slab ${slabNo}`
                    : `Save QC for slab ${slabNo}`}
            </button>
            {saved ? (
              <span className="text-status-active text-sm font-medium">
                ✓ QC saved for slab {slabNo}.
              </span>
            ) : (
              <span className="text-muted text-sm">
                {edit
                  ? 'This replaces the current grade and outcome on the same record.'
                  : 'The entry above stays In-Processing until this is saved.'}
              </span>
            )}
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
