'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { registerDay } from '@/lib/chromia/operator-register';
import { recordDispatch } from '@/lib/chromia/server/services/disposition-service';

export interface DispatchFormState {
  error?: string;
  /** Set on success, so the lists refresh and the row clears. */
  dispatchedSlabId?: string;
  dispatchedAt?: number;
}

/**
 * Send a decided-dispatch slab out for real.
 *
 * The date is required — a dispatch with no date is the very thing this page
 * exists to prevent — and the slab is then dispatched through the existing
 * dispatch logic, so a slab sent from here is indistinguishable from one
 * dispatched any other way, and its traceability is unchanged.
 */
export async function sendForDispatchAction(
  _previousState: DispatchFormState,
  formData: FormData,
): Promise<DispatchFormState> {
  const slabId = String(formData.get('slabId') ?? '').trim();
  const dateRaw = String(formData.get('dispatchDate') ?? '').trim();

  if (!slabId) return { error: 'That slab could not be identified.' };
  if (!dateRaw) return { error: 'Pick the date this slab was dispatched.' };

  const dispatchDate = registerDay(dateRaw);
  if (!dispatchDate) return { error: 'Enter a valid dispatch date.' };

  try {
    const user = await requireActingUser();
    await recordDispatch({ slabId, dispatchDate }, user.id, {
      note: 'Sent for dispatch from the Dispatch page',
    });
  } catch (error) {
    if (isAppError(error) || error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath(APP_ROUTES.dispatch);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
  revalidatePath(APP_ROUTES.reports);

  return { dispatchedSlabId: slabId, dispatchedAt: Date.now() };
}
