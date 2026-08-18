'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import {
  combineDayAndTime,
  recalibrationTripSchema,
  restartAfterRecalibrationSchema,
} from '@/lib/chromia/validation/recalibration-flow';
import { restartProduction, saveTrip } from '@/lib/chromia/server/services/recalibration-flow-service';

export interface RecalibrationFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' ? value : undefined;
}

function toState(error: unknown): RecalibrationFormState {
  if (isAppError(error)) return { error: error.message };
  if (error instanceof Error) return { error: error.message };
  throw error;
}

function refresh() {
  revalidatePath(APP_ROUTES.recalibrations);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
}

/** Sent date, and later the received date, on one trip. */
export async function saveTripAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = recalibrationTripSchema.safeParse({
    slabId: text(formData, 'slabId'),
    sentDate: text(formData, 'sentDate'),
    receivedDate: text(formData, 'receivedDate'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const user = await requireActingUser();
    await saveTrip(
      parsed.data.slabId,
      { sentDate: parsed.data.sentDate, receivedDate: parsed.data.receivedDate },
      user.id,
    );
  } catch (error) {
    return toState(error);
  }

  refresh();
  redirect(APP_ROUTES.recalibrations);
}

/** The register entry that puts a returned slab back on the line. */
export async function restartProductionAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = restartAfterRecalibrationSchema.safeParse({
    slabId: text(formData, 'slabId'),
    receivedDate: text(formData, 'receivedDate'),
    batchNo: text(formData, 'batchNo'),
    slabNo: text(formData, 'slabNo'),
    baseMaterial: text(formData, 'baseMaterial'),
    fileName: text(formData, 'fileName'),
    thicknessCm: text(formData, 'thicknessCm'),
    inTime: text(formData, 'inTime'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const user = await requireActingUser();
    const { inTime, ...rest } = parsed.data;
    await restartProduction(
      { ...rest, inTime: combineDayAndTime(parsed.data.receivedDate, inTime) },
      user.id,
    );
  } catch (error) {
    return toState(error);
  }

  refresh();
  redirect(APP_ROUTES.recalibrations);
}
