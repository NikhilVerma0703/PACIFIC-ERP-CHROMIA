import { ChromiaAuditAction as AuditAction, ChromiaSlabEventType as SlabEventType } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { ConflictError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { registerDay, toDateInput } from '@/lib/chromia/operator-register';
import {
  describeSlabRecordChanges,
  diffSlabRecord,
  DUPLICATE_SLAB_NO_MESSAGE,
  type SlabRecordFields,
} from '@/lib/chromia/slab-record';
import type { SlabRecordDeleteInput, SlabRecordEditInput } from '@/lib/chromia/validation/slab-record';
import { isSlabNoTaken, loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import { resolveBaseMaterialId, resolveDesignId } from '@/lib/chromia/server/services/reference-service';

const log = createLogger('slab-record');

const pad = (value: number) => `${value}`.padStart(2, '0');
const timeOf = (date: Date | null) =>
  date === null ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const dayOf = (date: Date | null) => (date === null ? '' : toDateInput(date));

/**
 * A `@db.Date` column comes back at UTC midnight, so it must be read back the
 * same way it was written or the day drifts by one either side of Greenwich.
 */

/**
 * Correct a slab record.
 *
 * Every field a person typed, and nothing a person did not: grade, outcome and
 * status are decisions with their own records, and typing over them here would
 * leave the grade decision, the dispatch and the slab telling three different
 * stories.
 *
 * What the correction does not do is as important as what it does. The slab
 * keeps its id, so every cycle, QC record, grade decision, recalibration trip
 * and history event still points at it. The change itself is written into that
 * history as a CORRECTION event, in words, which is what the schema meant by
 * "history is never overwritten".
 */
export async function updateSlabRecord(input: SlabRecordEditInput, userId: string) {
  const record = await loadSlabRecord(input.slabId);
  if (!record) throw new NotFoundError('Slab');

  // Checked here as well as by the database's unique index. The index is what
  // makes a duplicate impossible; this is what makes it a sentence the operator
  // can read instead of a constraint violation.
  if (await isSlabNoTaken(input.slabNo, record.id)) {
    throw new ConflictError(DUPLICATE_SLAB_NO_MESSAGE);
  }

  const before: SlabRecordFields = {
    receivedDate: dayOf(record.receivedDate),
    batchNo: record.batchNo,
    slabNo: record.slabNo,
    baseMaterial: record.baseMaterial,
    fileName: record.designFileName,
    thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
    inTime: timeOf(record.inTime),
    remarks: record.remarks ?? '',
  };

  const after: SlabRecordFields = {
    receivedDate: input.receivedDate,
    batchNo: input.batchNo,
    slabNo: input.slabNo,
    baseMaterial: input.baseMaterial,
    fileName: input.fileName,
    thicknessCm: input.thicknessCm === undefined ? '' : String(input.thicknessCm),
    inTime: timeOf(input.inTime),
    remarks: input.remarks ?? '',
  };

  const changes = diffSlabRecord(before, after);

  // Opening the form and closing it again is not a correction, and should not
  // leave a line in the history saying it was.
  if (changes.length === 0) {
    return { slabNo: record.slabNo, changed: 0 };
  }

  const baseMaterialId = await resolveBaseMaterialId(input.baseMaterial);
  const designId = await resolveDesignId(input.fileName);
  const thicknessMm = input.thicknessCm === undefined ? null : input.thicknessCm * 10;
  // The production date the operator chose dates the record — not the in-time,
  // which is optional now and may not be there at all. They agree whenever a
  // time was typed. See operator-register.registerDay.
  const receivedDate = registerDay(input.receivedDate) ?? record.receivedDate;

  await prisma.$transaction(async (tx) => {
    // The batch is found or created exactly as the register does it, and the
    // slab counts on both batches are kept straight when a slab moves.
    let batchId = record.batchId;

    if (input.batchNo !== record.batchNo) {
      const existing = await tx.chromiaBatch.findUnique({ where: { batchNo: input.batchNo } });
      const batch =
        existing ??
        (await tx.chromiaBatch.create({
          data: {
            batchNo: input.batchNo,
            baseMaterialId,
            receivedDate,
            createdById: userId,
          },
        }));

      batchId = batch.id;

      await tx.chromiaBatch.update({
        where: { id: record.batchId },
        data: { totalSlabs: { decrement: 1 } },
      });
      await tx.chromiaBatch.update({
        where: { id: batch.id },
        data: { totalSlabs: { increment: 1 } },
      });
    }

    await tx.chromiaSlab.update({
      where: { id: record.id },
      data: {
        slabNo: input.slabNo,
        batchId,
        baseMaterialId,
        plannedDesignId: designId,
        receivedDate,
        currentThicknessMm: thicknessMm,
        // A slab that has been recalibrated is genuinely thinner than it
        // started, and that difference is a measurement, not a typing mistake.
        // Only a slab that has never been away has its original rewritten too.
        ...(record.recalibrationCount === 0 ? { originalThicknessMm: thicknessMm } : {}),
        remarks: input.remarks ?? null,
        updatedById: userId,
      },
    });

    if (record.cycleId) {
      await tx.chromiaProcessCycle.update({
        where: { id: record.cycleId },
        // fullyPrintedDate is deliberately NOT written here: the field is gone
        // from the form, and writing it from an absent value would blank the
        // figure the register importer put there. See validation/slab.ts.
        data: { inTime: input.inTime, designId },
      });
    }

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: record.id,
        cycleId: record.cycleId,
        eventType: SlabEventType.CORRECTION,
        userId,
        note: describeSlabRecordChanges(changes),
        payload: {
          changes: changes.map((change) => ({
            field: change.field,
            label: change.label,
            from: change.from,
            to: change.to,
          })),
        },
      },
    });
  });

  log.info(
    { slabId: record.id, from: record.slabNo, to: input.slabNo, changed: changes.length },
    'Slab record corrected',
  );

  return { slabNo: input.slabNo, changed: changes.length };
}

/**
 * Remove a slab record for good.
 *
 * Everything that hangs off the slab goes with it — its cycles, its history,
 * its QC records, its grade decisions, its recalibration trips, its dispatch,
 * stock and sample-cutting records — because none of them mean anything on
 * their own. The database's cascade rules do that, scoped to this slab's id,
 * so no other record can be caught in it.
 *
 * The batch keeps its own count straight, and an audit entry is written so the
 * removal itself is still traceable after the record it describes is gone.
 *
 * The slab number is only handed back to the plant here: while a record exists,
 * deleted or not, its number is taken.
 */
export async function deleteSlabRecord(input: SlabRecordDeleteInput, userId: string) {
  const record = await loadSlabRecord(input.slabId);
  if (!record) throw new NotFoundError('Slab');

  // The page may have been open for a while. If the row now holds a different
  // slab than the one the operator read and clicked, delete nothing.
  if (record.slabNo !== input.slabNo) {
    throw new ConflictError(
      `This record is no longer slab ${input.slabNo}. Reload Slab Records and try again.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.chromiaAuditLog.create({
      data: {
        entity: 'Slab',
        entityId: record.id,
        action: AuditAction.DELETE,
        userId,
        changes: {
          slabNo: record.slabNo,
          batchNo: record.batchNo,
          baseMaterial: record.baseMaterial,
          fileName: record.designFileName,
          receivedDate: dayOf(record.receivedDate),
        },
      },
    });

    await tx.chromiaBatch.update({
      where: { id: record.batchId },
      data: { totalSlabs: { decrement: 1 } },
    });

    // One id, one row. Everything removed with it is the cascade of this slab's
    // own children and nothing else.
    await tx.chromiaSlab.delete({ where: { id: record.id } });
  });

  log.warn({ slabId: record.id, slabNo: record.slabNo }, 'Slab record deleted');

  return { slabNo: record.slabNo };
}
