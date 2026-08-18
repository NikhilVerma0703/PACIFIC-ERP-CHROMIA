'use server';

import { revalidatePath } from 'next/cache';

import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { recordOutTimeSchema } from '@/lib/chromia/validation/processing';
import { recordOutTime } from '@/lib/chromia/server/services/processing-service';

export interface ProcessingFormState {
  error?: string;
}

export async function recordOutTimeAction(
  _previousState: ProcessingFormState,
  formData: FormData,
): Promise<ProcessingFormState> {
  const parsed = recordOutTimeSchema.safeParse({
    cycleId: formData.get('cycleId'),
    outTime: formData.get('outTime'),
    locationId: formData.get('locationId'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    return { error: 'Check the out-time and try again.' };
  }

  try {
    const user = await requireActingUser();
    await recordOutTime(parsed.data, user.id);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath('/chromia/slabs');
  return {};
}
