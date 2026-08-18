'use client';

import { useActionState } from 'react';

import { field } from '@/components/chromia/ui/form';
import { releaseFromStockAction, type StockyardFormState } from '@/lib/chromia/server/actions/stockyard';

const INITIAL_STATE: StockyardFormState = {};

/**
 * One row of the rack list — its own form.
 *
 * A single form over the whole table would need a chosen row and a chosen date
 * to agree with each other; a form per row cannot get that wrong. The date is
 * required by the browser as well as the schema, because the whole reason this
 * screen exists is that the day a slab left the rack is not the day somebody
 * got round to typing it in.
 */
export function ReleaseForm({ slabId, today }: { slabId: string; today: string }) {
  const [state, formAction, isPending] = useActionState(releaseFromStockAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="slabId" value={slabId} />
      <input
        aria-label="Dispatch date"
        name="dispatchDate"
        type="date"
        required
        defaultValue={today}
        className={`${field} w-[10.5rem]`}
      />
      <button
        type="submit"
        disabled={isPending}
        className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isPending ? 'Saving…' : 'Dispatch'}
      </button>
      {state.error ? (
        <span className="text-status-waste max-w-[14rem] text-xs font-medium">{state.error}</span>
      ) : null}
    </form>
  );
}
