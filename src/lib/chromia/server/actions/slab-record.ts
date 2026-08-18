'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { combineDateAndTime } from '@/lib/chromia/operator-register';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { slabRecordDeleteSchema, slabRecordEditSchema } from '@/lib/chromia/validation/slab-record';
import { isSlabNoTaken } from '@/lib/chromia/server/repositories/slab-record-repository';
import { deleteSlabRecord, updateSlabRecord } from '@/lib/chromia/server/services/slab-record-service';

export interface SlabRecordFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set on success, so the page can say what it did before navigating away. */
  savedSlabNo?: string;
  savedAt?: number;
}

/** Everywhere a slab list has to be right again after a correction. */
function revalidateSlabViews() {
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.operator);
  revalidatePath(APP_ROUTES.dashboard);
  revalidatePath(APP_ROUTES.recalibrations);
  revalidatePath(APP_ROUTES.recalibrationTracking);
  revalidatePath(APP_ROUTES.stockyard);
  revalidatePath(APP_ROUTES.reports);
}

export async function updateSlabRecordAction(
  _previousState: SlabRecordFormState,
  formData: FormData,
): Promise<SlabRecordFormState> {
  const parsed = slabRecordEditSchema.safeParse({
    slabId: formData.get('slabId'),
    receivedDate: formData.get('receivedDate'),
    inTime: formData.get('inTime'),
    batchNo: formData.get('batchNo'),
    slabNo: formData.get('slabNo'),
    baseMaterial: formData.get('baseMaterial'),
    fileName: formData.get('fileName'),
    thicknessCm: formData.get('thicknessCm'),
    fullyPrintedDate: formData.get('fullyPrintedDate'),
    remarks: formData.get('remarks'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const inTime = combineDateAndTime(parsed.data.receivedDate, parsed.data.inTime);
  if (!inTime) {
    return { error: 'Enter a valid date and in-time' };
  }

  try {
    const user = await requireActingUser();
    await updateSlabRecord({ ...parsed.data, inTime }, user.id);
  } catch (error) {
    if (isAppError(error)) {
      // A duplicate belongs under the field that caused it, not in the banner
      // at the top of a nine-field form.
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

  revalidateSlabViews();

  return { savedSlabNo: parsed.data.slabNo, savedAt: Date.now() };
}

export async function deleteSlabRecordAction(
  _previousState: SlabRecordFormState,
  formData: FormData,
): Promise<SlabRecordFormState> {
  const parsed = slabRecordDeleteSchema.safeParse({
    slabId: formData.get('slabId'),
    slabNo: formData.get('slabNo'),
  });

  if (!parsed.success) {
    return { error: 'This record could not be identified. Reload Slab Records and try again.' };
  }

  try {
    const user = await requireActingUser();
    await deleteSlabRecord(parsed.data, user.id);
  } catch (error) {
    if (isAppError(error)) {
      return { error: error.message };
    }
    if (error instanceof Error && error.message.includes('db:seed')) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateSlabViews();

  return { savedSlabNo: parsed.data.slabNo, savedAt: Date.now() };
}

/**
 * Is this slab number free?
 *
 * Called from the register and the correction form as the operator leaves the
 * field, so a duplicate is caught while the number is still under their finger
 * rather than after they have filled in the rest of the row. The save is still
 * refused by the service and by the database's unique index — this is the
 * courtesy, not the guard.
 */
export async function checkSlabNoAction(
  slabNo: string,
  exceptId?: string,
): Promise<{ taken: boolean }> {
  const trimmed = slabNo.trim();
  if (trimmed === '') return { taken: false };

  return { taken: await isSlabNoTaken(trimmed, exceptId) };
}
