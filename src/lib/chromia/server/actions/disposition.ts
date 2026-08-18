'use server';

import { revalidatePath } from 'next/cache';

import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import {
  dispatchSchema,
  sampleCuttingSchema,
  stockSchema,
  wasteSchema,
} from '@/lib/chromia/validation/disposition';
import {
  declareWaste,
  recordDispatch,
  recordSampleCutting,
  recordStock,
} from '@/lib/chromia/server/services/disposition-service';

export interface DispositionFormState {
  error?: string;
}

function toError(error: unknown): DispositionFormState {
  if (isAppError(error)) return { error: error.message };
  if (error instanceof Error) return { error: error.message };
  throw error;
}

function revalidate() {
  revalidatePath('/chromia/slabs');
  revalidatePath('/chromia/recalibrations');
}

export async function dispatchAction(
  _previousState: DispositionFormState,
  formData: FormData,
): Promise<DispositionFormState> {
  const parsed = dispatchSchema.safeParse({
    slabId: formData.get('slabId'),
    dispatchDate: formData.get('dispatchDate'),
  });

  if (!parsed.success) return { error: 'Enter a valid dispatch date.' };

  try {
    const user = await requireActingUser();
    await recordDispatch(parsed.data, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidate();
  return {};
}

export async function stockAction(
  _previousState: DispositionFormState,
  formData: FormData,
): Promise<DispositionFormState> {
  const parsed = stockSchema.safeParse({
    slabId: formData.get('slabId'),
    stockDate: formData.get('stockDate'),
    locationId: formData.get('locationId'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) return { error: 'Check the stock details.' };

  try {
    const user = await requireActingUser();
    await recordStock(parsed.data, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidate();
  return {};
}

export async function sampleCuttingAction(
  _previousState: DispositionFormState,
  formData: FormData,
): Promise<DispositionFormState> {
  const parsed = sampleCuttingSchema.safeParse({
    slabId: formData.get('slabId'),
    cutDate: formData.get('cutDate'),
    piecesProduced: formData.get('piecesProduced'),
    purpose: formData.get('purpose'),
    destination: formData.get('destination'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) return { error: 'Check the sample cutting details.' };

  try {
    const user = await requireActingUser();
    await recordSampleCutting(parsed.data, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidate();
  return {};
}

export async function wasteAction(
  _previousState: DispositionFormState,
  formData: FormData,
): Promise<DispositionFormState> {
  const parsed = wasteSchema.safeParse({
    slabId: formData.get('slabId'),
    finalDefectTypeId: formData.get('finalDefectTypeId'),
    rootCause: formData.get('rootCause'),
    disposalRef: formData.get('disposalRef'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) return { error: 'Check the waste details.' };

  try {
    const user = await requireActingUser();
    await declareWaste(parsed.data, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidate();
  return {};
}
