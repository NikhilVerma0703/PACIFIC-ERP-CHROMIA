'use server';

import { revalidatePath } from 'next/cache';

import { requireActingUser } from '@/lib/chromia/current-user';
import { resolveRecalibrationReasonId } from '@/lib/chromia/server/services/reference-service';
import { isAppError } from '@/lib/chromia/errors';
import {
  recalibrationEntrySchema,
  receiveFromRecalibrationSchema,
  restartAfterRecalibrationSchema,
  sendForRecalibrationSchema,
} from '@/lib/chromia/validation/recalibration';
import {
  receiveFromRecalibration,
  restartAfterRecalibration,
  sendForRecalibration,
} from '@/lib/chromia/server/services/recalibration-service';

export interface RecalibrationFormState {
  error?: string;
}

function toError(error: unknown): RecalibrationFormState {
  if (isAppError(error)) return { error: error.message };
  if (error instanceof Error) return { error: error.message };
  throw error;
}

export async function sendForRecalibrationAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = sendForRecalibrationSchema.safeParse({
    slabId: formData.get('slabId'),
    reason: formData.get('reason'),
    sentDate: formData.get('sentDate'),
    expectedReturnDate: formData.get('expectedReturnDate'),
    facilityName: formData.get('facilityName'),
    gatePassNo: formData.get('gatePassNo'),
    transporter: formData.get('transporter'),
    vehicleNo: formData.get('vehicleNo'),
    conditionOnSend: formData.get('conditionOnSend'),
    thicknessBeforeMm: formData.get('thicknessBeforeMm'),
    reasonNotes: formData.get('reasonNotes'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? 'Check the recalibration details.' };
  }

  try {
    const user = await requireActingUser();
    const reasonId = await resolveRecalibrationReasonId(parsed.data.reason);
    await sendForRecalibration({ ...parsed.data, reasonId }, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidatePath('/chromia/slabs');
  revalidatePath('/chromia/recalibrations');
  return {};
}

export async function receiveFromRecalibrationAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = receiveFromRecalibrationSchema.safeParse({
    recalibrationId: formData.get('recalibrationId'),
    receivedDate: formData.get('receivedDate'),
    thicknessAfterMm: formData.get('thicknessAfterMm'),
    conditionOnReturn: formData.get('conditionOnReturn'),
    workAccepted: formData.get('workAccepted') ?? 'true',
    locationId: formData.get('locationId'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? 'Check the return details.' };
  }

  try {
    const user = await requireActingUser();
    await receiveFromRecalibration(parsed.data, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidatePath('/chromia/slabs');
  revalidatePath('/chromia/recalibrations');
  return {};
}

export async function restartAfterRecalibrationAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = restartAfterRecalibrationSchema.safeParse({
    recalibrationId: formData.get('recalibrationId'),
    locationId: formData.get('locationId'),
  });

  if (!parsed.success) {
    return { error: 'Invalid recalibration.' };
  }

  try {
    const user = await requireActingUser();
    await restartAfterRecalibration(parsed.data, user.id);
  } catch (error) {
    return toError(error);
  }

  revalidatePath('/chromia/slabs');
  revalidatePath('/chromia/recalibrations');
  return {};
}

/**
 * Recalibration entry — reason, sent date and received date in one submit.
 *
 * Runs the existing send and receive services back to back, so the resulting
 * history is identical to doing it in two steps on the slab page. The slab is
 * then sitting at RECEIVED_FROM_RECALIBRATION, ready to be restarted.
 */
export async function recordRecalibrationEntryAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = recalibrationEntrySchema.safeParse({
    slabId: formData.get('slabId'),
    reason: formData.get('reason'),
    sentDate: formData.get('sentDate'),
    receivedDate: formData.get('receivedDate'),
    reasonNotes: formData.get('reasonNotes'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? 'Check the recalibration details.' };
  }

  const input = parsed.data;

  try {
    const user = await requireActingUser();
    // The reason can be typed as well as picked — match it, or create it.
    const reasonId = await resolveRecalibrationReasonId(input.reason);

    const cycle = await sendForRecalibration(
      {
        slabId: input.slabId,
        reasonId,
        sentDate: input.sentDate,
        reasonNotes: input.reasonNotes,
        expectedReturnDate: undefined,
        facilityName: undefined,
        gatePassNo: undefined,
        transporter: undefined,
        vehicleNo: undefined,
        conditionOnSend: undefined,
        thicknessBeforeMm: undefined,
      },
      user.id,
    );

    await receiveFromRecalibration(
      {
        recalibrationId: cycle.id,
        receivedDate: input.receivedDate,
        workAccepted: true,
        thicknessAfterMm: undefined,
        conditionOnReturn: undefined,
        locationId: undefined,
        notes: undefined,
      },
      user.id,
    );
  } catch (error) {
    return toError(error);
  }

  revalidatePath('/chromia/slabs');
  revalidatePath('/chromia/recalibrations');
  revalidatePath('/chromia/dashboard');
  return {};
}
