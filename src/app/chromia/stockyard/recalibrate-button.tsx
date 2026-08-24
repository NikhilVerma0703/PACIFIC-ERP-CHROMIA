'use client';

import { useActionState, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/chromia/ui/confirm-dialog';
import { sendToRecalibrationAction, type StockyardFormState } from '@/lib/chromia/server/actions/stockyard';

const INITIAL_STATE: StockyardFormState = {};

/**
 * The rack's second exit — send a stocked slab for recalibration.
 *
 * Its own form beside Dispatch, and its own confirm step: unlike a dispatch it
 * takes no date, so one click would otherwise be enough to move a slab off the
 * rack, and this is a consequential change of course. The dialog names the slab
 * for the same reason the delete dialog does — a row position is not something
 * anyone can check before saying yes.
 */
export function RecalibrateButton({ slabId, slabNo }: { slabId: string; slabNo: string }) {
  const [state, formAction, isPending] = useActionState(sendToRecalibrationAction, INITIAL_STATE);
  const [asking, setAsking] = useState(false);

  // Close on success. A failure keeps the dialog open with the reason on it.
  useEffect(() => {
    if (state.recalibratedSlabNo) setAsking(false);
  }, [state.recalibratedSlabNo]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Send slab ${slabNo} for recalibration`}
        className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-[var(--surface-muted)]"
      >
        Recalibration
      </button>

      <ConfirmDialog
        open={asking}
        busy={isPending}
        title="Send this slab for recalibration?"
        detail={`Slab ${slabNo} will leave the stock rack and move to the Recalibration list, waiting to be sent. You record the date it actually goes there.`}
        error={state.error}
        onCancel={() => setAsking(false)}
      >
        <form action={formAction} className="contents">
          <input type="hidden" name="slabId" value={slabId} />
          <button
            type="submit"
            disabled={isPending}
            className="bg-brand-600 inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Saving…' : 'Send for recalibration'}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}
