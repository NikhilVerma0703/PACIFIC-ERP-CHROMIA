'use server';

import { revalidatePath } from 'next/cache';

import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { qualityCheckSchema } from '@/lib/chromia/validation/quality';
import { recordQualityCheck } from '@/lib/chromia/server/services/quality-service';

export interface QualityFormState {
  error?: string;
}

export async function recordQualityCheckAction(
  _previousState: QualityFormState,
  formData: FormData,
): Promise<QualityFormState> {
  const parsed = qualityCheckSchema.safeParse({
    cycleId: formData.get('cycleId'),
    verdict: formData.get('verdict'),
    printQualityResult: formData.get('printQualityResult'),
    colourMatchResult: formData.get('colourMatchResult'),
    surfaceFinishResult: formData.get('surfaceFinishResult'),
    glossResult: formData.get('glossResult'),
    dimensionalResult: formData.get('dimensionalResult'),
    edgeConditionResult: formData.get('edgeConditionResult'),
    glossReading: formData.get('glossReading'),
    colourDeviation: formData.get('colourDeviation'),
    defectTypeIds: formData.getAll('defectTypeIds').map(String),
    remarks: formData.get('remarks'),
    grade: formData.get('grade'),
    disposition: formData.get('disposition'),
    gradeReason: formData.get('gradeReason'),
    targetLocationId: formData.get('targetLocationId'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input.' };
  }

  try {
    const user = await requireActingUser();
    await recordQualityCheck(parsed.data, user.id);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath('/chromia/slabs');
  return {};
}
