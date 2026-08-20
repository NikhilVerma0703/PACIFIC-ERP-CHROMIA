'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { ChromiaDisposition as Disposition } from '@prisma/client';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { intakeQcSchema, type IntakeQcInput } from '@/lib/chromia/validation/slab';
import {
  declareWaste,
  recordDispatch,
  recordSampleCutting,
  recordStock,
} from '@/lib/chromia/server/services/disposition-service';
import { applyIntakeGrade } from '@/lib/chromia/server/services/intake-outcome-service';
import { markAwaitingRecalibration } from '@/lib/chromia/server/services/recalibration-flow-service';
import { resolveRecalibrationReasonId } from '@/lib/chromia/server/services/reference-service';
import { completeSlabIntake } from '@/lib/chromia/server/services/slab-intake-service';

export interface SlabIntakeFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/** Run the outcome-specific record for everything except recalibration. */
async function applyDisposition(slabId: string, qc: IntakeQcInput, userId: string) {
  switch (qc.disposition) {
    case Disposition.DISPATCH:
      return recordDispatch({ slabId, dispatchDate: qc.dispatchDate }, userId);

    case Disposition.STOCK:
      return recordStock(
        {
          slabId,
          stockDate: qc.stockDate,
          notes: qc.stockNotes,
        },
        userId,
      );

    case Disposition.SAMPLE_CUTTING:
      return recordSampleCutting(
        {
          slabId,
          cutDate: qc.cutDate,
          notes: undefined,
        },
        userId,
      );

    case Disposition.WASTE:
      return declareWaste(
        {
          slabId,
          finalDefectTypeId: qc.finalDefectTypeId,
          rootCause: qc.rootCause,
          disposalRef: qc.disposalRef,
          notes: undefined,
        },
        userId,
      );

    default:
      // RECALIBRATION is completed on the Recalibration page.
      return undefined;
  }
}

/**
 * Finish a slab the operator already entered.
 *
 * Identical form, identical QC rules — the only difference is that section 1
 * updates a slab instead of creating one. Keeping both paths on one function
 * means a change to the grading rules can never apply to new slabs and quietly
 * miss the ones being finished.
 */
export async function completeSlabAction(
  _previousState: SlabIntakeFormState,
  formData: FormData,
): Promise<SlabIntakeFormState> {
  const raw = formData.get('slabId');
  const slabId = typeof raw === 'string' ? raw : '';
  if (!slabId) return { error: 'This slab could not be identified. Reopen it from Slabs.' };

  return saveQc(formData, (userId) => completeSlabIntake(slabId, userId).then((slab) => slab.id));
}

async function saveQc(
  formData: FormData,
  persist: (userId: string) => Promise<string>,
): Promise<SlabIntakeFormState> {
  /**
   * Read a form field as text.
   *
   * `FormData.get` returns **null** for a field that is not in the document,
   * and the QC section only renders the panel for the outcome that was chosen —
   * so on a dispatch, every stock and sample-cutting field is absent. The
   * optional schemas accept a string or nothing, never null, so passing the raw
   * result rejected the form on fields the user could not even see, and the
   * errors had nowhere to appear. Nothing saved, nothing shown.
   */
  const text = (key: string): string | undefined => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : undefined;
  };

  const qcParsed = intakeQcSchema.safeParse({
    grade: text('grade'),
    disposition: text('disposition'),
    slabRemarks: text('slabRemarks'),
    dispatchDate: text('dispatchDate'),
    stockDate: text('stockDate'),
    stockNotes: text('stockNotes'),
    cutDate: text('cutDate'),
    recalibrationReason: text('recalibrationReason'),
    finalDefectTypeId: text('finalDefectTypeId'),
    rootCause: text('rootCause'),
    disposalRef: text('disposalRef'),
  });

  if (!qcParsed.success) {
    return { fieldErrors: qcParsed.error.flatten().fieldErrors };
  }

  const qc = qcParsed.data;
  let slabId: string;

  let reasonId: string | undefined;

  try {
    const user = await requireActingUser();

    // The reason can be typed as well as picked, so a name becomes a record
    // here — matched against what exists, created only when new.
    if (qc.disposition === Disposition.RECALIBRATION && qc.recalibrationReason) {
      reasonId = await resolveRecalibrationReasonId(qc.recalibrationReason);
    }

    slabId = await persist(user.id);

    await applyIntakeGrade(slabId, qc, user.id);
    await applyDisposition(slabId, qc, user.id);

    // A condemned slab is not sent anywhere yet — it is put down inside the
    // plant. This opens that waiting record so it appears on the Recalibration
    // page with its reason and an attempt count that has deliberately not
    // moved, and writes the slab off if this was the sixth condemnation.
    if (qc.disposition === Disposition.RECALIBRATION) {
      await markAwaitingRecalibration(slabId, reasonId, user.id);
    }
  } catch (error) {
    if (isAppError(error)) {
      return { error: error.message };
    }
    if (error instanceof Error && error.message.includes('db:seed')) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
  revalidatePath(APP_ROUTES.recalibrations);
  // QC is graded from the operator screen now, so that screen is stale the
  // moment this returns — without this, going Back to it re-offers the QC
  // section for a slab that has just been graded.
  revalidatePath(APP_ROUTES.operator);

  // Straight to the Recalibration page, where the slab is now waiting to be
  // sent. No query string: the record is simply in the table.
  if (qc.disposition === Disposition.RECALIBRATION) {
    redirect(APP_ROUTES.recalibrations);
  }

  // Back to the history table: the record the in-charge just completed is the
  // top row, and there is no per-slab page to land on any more.
  redirect(APP_ROUTES.slabs);
}
