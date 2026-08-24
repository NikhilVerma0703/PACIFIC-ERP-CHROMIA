'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { stockRecalibrationSchema, stockReleaseSchema } from '@/lib/chromia/validation/stockyard';
import { releaseFromStock, sendStockToRecalibration } from '@/lib/chromia/server/services/stockyard-service';

export interface StockyardFormState {
  error?: string;
  /** Set on success, so the page can say which slab went out. */
  releasedSlabNo?: string;
  releasedAt?: number;
  /** Set when a slab was sent for recalibration rather than dispatched. */
  recalibratedSlabNo?: string;
}

export async function releaseFromStockAction(
  _previousState: StockyardFormState,
  formData: FormData,
): Promise<StockyardFormState> {
  const value = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === 'string' ? raw : undefined;
  };

  const parsed = stockReleaseSchema.safeParse({
    slabId: value('slabId'),
    dispatchDate: value('dispatchDate'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the dispatch date.' };
  }

  let slabNo: string;

  try {
    const user = await requireActingUser();
    const released = await releaseFromStock(parsed.data, user.id);
    slabNo = released.slabNo;
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath(APP_ROUTES.stockyard);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
  revalidatePath(APP_ROUTES.reports);

  return { releasedSlabNo: slabNo, releasedAt: Date.now() };
}

/**
 * Stock → Recalibration.
 *
 * The rack's other exit, sitting beside Dispatch. It opens the slab's waiting
 * recalibration record and takes it off the rack; from there it is an ordinary
 * recalibration, sent and received on the Recalibration page like any other.
 */
export async function sendToRecalibrationAction(
  _previousState: StockyardFormState,
  formData: FormData,
): Promise<StockyardFormState> {
  const raw = formData.get('slabId');
  const parsed = stockRecalibrationSchema.safeParse({
    slabId: typeof raw === 'string' ? raw : undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Pick a slab from the list.' };
  }

  let slabNo: string;

  try {
    const user = await requireActingUser();
    const result = await sendStockToRecalibration(parsed.data, user.id);
    slabNo = result.slabNo;
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  // Both lists move: the slab leaves the rack and appears on Recalibration.
  revalidatePath(APP_ROUTES.stockyard);
  revalidatePath(APP_ROUTES.recalibrations);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
  revalidatePath(APP_ROUTES.reports);

  return { recalibratedSlabNo: slabNo, releasedAt: Date.now() };
}
