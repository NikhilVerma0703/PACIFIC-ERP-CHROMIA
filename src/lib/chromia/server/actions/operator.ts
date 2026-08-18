'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { operatorEntrySchema } from '@/lib/chromia/validation/operator';
import { recordOperatorEntry } from '@/lib/chromia/server/services/operator-service';

export interface OperatorFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set on success — the client uses it to reset the row and re-focus. */
  savedSlabNo?: string;
  /** Bumped on every save so the client can react to two saves in a row. */
  savedAt?: number;
}

export async function recordOperatorEntryAction(
  _previousState: OperatorFormState,
  formData: FormData,
): Promise<OperatorFormState> {
  const parsed = operatorEntrySchema.safeParse({
    entryDate: formData.get('entryDate'),
    inTime: formData.get('inTime'),
    batchNo: formData.get('batchNo'),
    slabNo: formData.get('slabNo'),
    baseMaterial: formData.get('baseMaterial'),
    fileName: formData.get('fileName'),
    thicknessCm: formData.get('thicknessCm'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const user = await requireActingUser();
    await recordOperatorEntry(parsed.data, user.id);
  } catch (error) {
    if (isAppError(error)) {
      // A duplicate belongs under the field that caused it.
      if (error.message === DUPLICATE_SLAB_NO_MESSAGE) {
        return { fieldErrors: { slabNo: [error.message] } };
      }
      return { error: error.message };
    }
    if (error instanceof Error && error.message.includes('db:seed')) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(APP_ROUTES.operator);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);

  return { savedSlabNo: parsed.data.slabNo, savedAt: Date.now() };
}
