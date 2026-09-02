'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/chromia/ui/confirm-dialog';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { deleteSlabRecordAction, type SlabRecordFormState } from '@/lib/chromia/server/actions/slab-record';

const INITIAL_STATE: SlabRecordFormState = {};

/**
 * Correct or remove one row.
 *
 * Both controls belong to the row they sit in and carry that row's own id, so
 * there is no "selected slab" held anywhere that could drift out of step with
 * what the operator is looking at — the commonest way a delete removes the
 * wrong thing.
 *
 * Delete asks first, and the question names the slab.
 */
export function RowActions({
  slabId,
  slabNo,
  back,
}: {
  slabId: string;
  slabNo: string;
  /** The full Slab Records URL (with filters) to return to after an Edit save,
   *  so correcting a slab keeps the in-charge on the same filtered view. */
  back?: string;
}) {
  const [state, formAction, isPending] = useActionState(deleteSlabRecordAction, INITIAL_STATE);
  const [asking, setAsking] = useState(false);

  // Close on success. A failure keeps the dialog open with the reason on it,
  // because a delete that quietly did nothing is worse than one that refused.
  useEffect(() => {
    if (state.savedAt) setAsking(false);
  }, [state.savedAt]);

  return (
    <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
      <Link
        href={`${APP_ROUTES.operator}?slab=${slabId}&edit=1${back ? `&back=${encodeURIComponent(back)}` : ''}`}
        aria-label={`Edit slab ${slabNo}`}
        className="border-line surface hover:border-line-strong inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[var(--surface-muted)]"
      >
        Edit
      </Link>

      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Delete slab ${slabNo}`}
        className="border-line surface text-status-waste hover:border-status-waste inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--color-status-waste)_8%,transparent)]"
      >
        Delete
      </button>

      <ConfirmDialog
        open={asking}
        busy={isPending}
        title="Are you sure you want to delete this slab record?"
        detail={`Slab ${slabNo} and everything recorded against it will be removed permanently. This cannot be undone.`}
        error={state.error}
        onCancel={() => setAsking(false)}
      >
        <form action={formAction} className="contents">
          <input type="hidden" name="slabId" value={slabId} />
          <input type="hidden" name="slabNo" value={slabNo} />
          <button
            type="submit"
            disabled={isPending}
            className="bg-status-waste inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Deleting…' : 'Delete slab record'}
          </button>
        </form>
      </ConfirmDialog>
    </span>
  );
}
