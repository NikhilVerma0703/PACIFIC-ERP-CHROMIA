'use client';

import { useActionState } from 'react';

import { field } from '@/components/chromia/ui/form';
import { sendForDispatchAction, type DispatchFormState } from '@/lib/chromia/server/actions/dispatch';

const INITIAL_STATE: DispatchFormState = {};

/**
 * One row of the queue — its own form.
 *
 * The date is required by the browser as well as the server, because a slab may
 * be sent weeks after QC decided it, and the whole point of this page is that
 * the dispatch date is the day it really left — not the day it was graded, and
 * not defaulted to today.
 */
export function SendForDispatchForm({ slabId }: { slabId: string }) {
  const [state, formAction, isPending] = useActionState(sendForDispatchAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="slabId" value={slabId} />
      <input
        aria-label="Dispatch date"
        name="dispatchDate"
        type="date"
        required
        className={`${field} w-[10.5rem]`}
      />
      <button
        type="submit"
        disabled={isPending}
        className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isPending ? 'Saving…' : 'Sent for Dispatch'}
      </button>
      {state.error ? (
        <span className="text-status-waste max-w-[14rem] text-xs font-medium">{state.error}</span>
      ) : null}
    </form>
  );
}
