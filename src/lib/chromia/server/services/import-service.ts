import { ChromiaAuditAction as AuditAction, ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaImportStatus as ImportStatus, ChromiaRecalibrationStatus as RecalibrationStatus, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { prisma } from '@/lib/chromia/db';
import { NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { daysBetween, toDateColumn } from '@/lib/chromia/utils/dates';
import { importStatus, importSummaryLine } from '@/lib/chromia/import/outcome';
import type { ParsedSlabRow, ParseResult } from '@/lib/chromia/import/pro-register';
import { markSlabsChromia, unmarkSlabsChromia } from '@/lib/chromia/inventory-bridge';

const log = createLogger('import');

export interface ImportSummary {
  importBatchId: string;
  totalRows: number;
  imported: number;
  /** Slabs already in the ERP, left untouched. */
  alreadyPresent: number;
  /** Blank spacer rows the sheet carries. Not slabs. */
  blankRows: number;
  /** Rows the parser could not read at all. */
  unreadable: number;
  /** Rows that threw while being written. The only real failures. */
  failed: number;
  /** What happened, in one line — see importSummaryLine. */
  line: string;
  /** Everything worth showing: unreadable rows, skips and failures alike. */
  errors: { sourceRow: number; reason: string }[];
}

/** Slug a free-text name into a stable master-data code. */
function toCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Status implied by an imported row's disposition. */
function statusFor(row: ParsedSlabRow): SlabStatus {
  switch (row.disposition) {
    case Disposition.DISPATCH:
      return SlabStatus.DISPATCHED;
    case Disposition.STOCK:
      return SlabStatus.IN_STOCK;
    case Disposition.SAMPLE_CUTTING:
      return SlabStatus.SAMPLE_CUT;
    case Disposition.WASTE:
      return SlabStatus.WASTE;
    case Disposition.RECALIBRATION:
      return row.recalReceivedDate
        ? SlabStatus.RECEIVED_FROM_RECALIBRATION
        : SlabStatus.OUT_FOR_RECALIBRATION;
    default:
      return SlabStatus.IN_PROCESS;
  }
}

/**
 * Load a parsed monthly register into the database.
 *
 * Every imported slab keeps a pointer back to its origin — source file, sheet,
 * row number and the original remark text — so an imported record can always
 * be reconciled against the spreadsheet it came from.
 *
 * Rows whose slab number already exists are skipped rather than overwritten:
 * live data always wins over an import.
 */
export async function importProRegister(
  parseResult: ParseResult,
  meta: { sourceFile: string; sheetName: string; periodLabel: string | null },
  userId: string,
): Promise<ImportSummary> {
  const startedAt = new Date();

  const importBatch = await prisma.chromiaImportBatch.create({
    data: {
      sourceFile: meta.sourceFile,
      sheetName: meta.sheetName,
      periodLabel: meta.periodLabel,
      status: ImportStatus.PROCESSING,
      totalRows: parseResult.rows.length,
      startedAt,
      importedById: userId,
    },
  });

  /*
   * Three outcomes, counted separately.
   *
   * They used to share one `errors` array, and the status was then decided by
   * how long that array was — so a SKIP counted as a fault. A skip is the
   * documented behaviour of this importer ("live data always wins"), and the
   * register produces them on a first import too, because it repeats a slab
   * number when a slab comes back from recalibration. The result was a clean
   * import reported as PARTIAL and a re-import reported as FAILED, both beside
   * a "Failed: 0" that contradicted them. See lib/chromia/import/outcome.ts.
   *
   * `notes` is what the screen lists; the counters are what the status is
   * decided from. Keeping them apart is the fix.
   */
  const notes: { sourceRow: number; reason: string }[] = [...parseResult.issues];
  const unreadable = parseResult.issues.length;
  const blankRows = parseResult.skipped;
  let imported = 0;
  let failed = 0;
  let alreadyPresent = 0;

  // Slabs this import leaves physically AT Chromia — in process, in Chromia
  // stock, or out at recalibration. Finished goods is told about these, once,
  // after the loop. A row the register already shows dispatched, wasted or cut
  // for samples left Chromia in its own month; stamping today's inventory
  // CHROMIA for it would be fiction.
  const atChromia: string[] = [];
  const AT_CHROMIA = new Set<SlabStatus>([
    SlabStatus.IN_PROCESS,
    SlabStatus.IN_STOCK,
    SlabStatus.OUT_FOR_RECALIBRATION,
    SlabStatus.RECEIVED_FROM_RECALIBRATION,
  ]);

  // Resolve (and create where needed) the master data the sheet references.
  const materialIds = new Map<string, string>();
  const designIds = new Map<string, string>();
  const reasonIds = new Map<string, string>();

  for (const reason of await prisma.chromiaRecalibrationReason.findMany({
    select: { id: true, code: true },
  })) {
    reasonIds.set(reason.code, reason.id);
  }

  async function materialId(name: string): Promise<string> {
    const key = name.toUpperCase();
    const cached = materialIds.get(key);
    if (cached) return cached;

    const record = await prisma.chromiaBaseMaterial.upsert({
      where: { code: toCode(name) },
      update: {},
      create: { code: toCode(name), name },
      select: { id: true },
    });
    materialIds.set(key, record.id);
    return record.id;
  }

  async function designId(fileName: string): Promise<string> {
    const key = fileName.toUpperCase();
    const cached = designIds.get(key);
    if (cached) return cached;

    const record = await prisma.chromiaDesign.upsert({
      where: { code: toCode(fileName) },
      update: {},
      create: { code: toCode(fileName), name: fileName, fileName },
      select: { id: true },
    });
    designIds.set(key, record.id);
    return record.id;
  }

  for (const row of parseResult.rows) {
    try {
      const existing = await prisma.chromiaSlab.findUnique({
        where: { slabNo: row.slabNo },
        select: { id: true },
      });

      if (existing) {
        alreadyPresent += 1;
        notes.push({
          sourceRow: row.sourceRow,
          reason: `Slab ${row.slabNo} already exists — left untouched`,
        });
        continue;
      }

      const baseMaterialId = await materialId(row.materialName);
      const plannedDesignId = row.designFile ? await designId(row.designFile) : null;

      const isRecalibration = row.disposition === Disposition.RECALIBRATION;
      const status = statusFor(row);
      // An explicit in-time when the file carried one, else the production date
      // — the same fallback the operator entry uses.
      const inTime = row.inTime ?? row.receivedDate;
      const outTime = row.fullyPrintedDate ?? row.bypassedDate ?? null;

      await prisma.$transaction(async (tx) => {
        const batch =
          (await tx.chromiaBatch.findUnique({ where: { batchNo: row.batchNo } })) ??
          (await tx.chromiaBatch.create({
            data: {
              batchNo: row.batchNo,
              baseMaterialId,
              receivedDate: row.receivedDate,
              createdById: userId,
            },
          }));

        const slab = await tx.chromiaSlab.create({
          data: {
            slabNo: row.slabNo,
            batchId: batch.id,
            baseMaterialId,
            plannedDesignId,
            status,
            currentCycleNumber: 1,
            currentGrade: row.grade,
            currentDisposition: row.disposition,
            originalThicknessMm: row.thicknessMm,
            currentThicknessMm: row.thicknessMm,
            recalibrationCount: isRecalibration ? 1 : 0,
            isRecalibrationOut: status === SlabStatus.OUT_FOR_RECALIBRATION,
            receivedDate: row.receivedDate,
            legacySourceFile: meta.sourceFile,
            legacySheetName: meta.sheetName,
            legacySourceRow: row.sourceRow,
            legacyRemark: row.remark,
            importBatchId: importBatch.id,
            createdById: userId,
            updatedById: userId,
          },
        });

        await tx.chromiaBatch.update({
          where: { id: batch.id },
          data: { totalSlabs: { increment: 1 } },
        });

        const cycle = await tx.chromiaProcessCycle.create({
          data: {
            slabId: slab.id,
            cycleNumber: 1,
            designId: plannedDesignId,
            inTime,
            outTime,
            // The register's own "fully printed" column. It doubles as the
            // out-time, since that is when the slab left the line, but it is
            // also kept in its own column so the download sheets can show it.
            fullyPrintedDate: toDateColumn(row.fullyPrintedDate),
            processingMinutes:
              outTime && inTime
                ? Math.max(0, Math.round((outTime.getTime() - inTime.getTime()) / 60_000))
                : null,
            status: outTime ? CycleStatus.COMPLETED : CycleStatus.ACTIVE,
            completedAt: outTime,
            disposition: row.disposition,
            finalGrade: row.grade,
            createdById: userId,
          },
        });

        await tx.chromiaSlabEvent.create({
          data: {
            slabId: slab.id,
            cycleId: cycle.id,
            eventType: SlabEventType.SLAB_CREATED,
            toStatus: status,
            userId,
            occurredAt: row.receivedDate,
            note: `Imported from ${meta.sourceFile} row ${row.sourceRow}${
              row.remark ? ` — "${row.remark}"` : ''
            }`,
          },
        });

        // The remark's grade and outcome, recorded as a real grade decision so
        // a historical row carries the same Grade + Outcome a slab graded at QC
        // does — not just a disposition with no grade behind it.
        if (row.grade && row.disposition) {
          await tx.chromiaGradeDecision.create({
            data: {
              cycleId: cycle.id,
              slabId: slab.id,
              grade: row.grade,
              disposition: row.disposition,
              reason: 'Graded from register remark on import',
              remarks: row.remark,
              decidedById: userId,
              decidedAt: row.receivedDate,
              attemptNumberAtDecision: 1,
            },
          });

          await tx.chromiaSlabEvent.create({
            data: {
              slabId: slab.id,
              cycleId: cycle.id,
              eventType: SlabEventType.GRADE_ASSIGNED,
              toStatus: status,
              userId,
              occurredAt: row.receivedDate,
              note: `Grade ${row.grade} → ${row.disposition} (from import remark)`,
            },
          });
        }

        if (isRecalibration) {
          const sentDate = row.recalSentDate ?? row.receivedDate;
          const receivedDate = row.recalReceivedDate;

          await tx.chromiaRecalibrationCycle.create({
            data: {
              slabId: slab.id,
              attemptNumber: 1,
              status: receivedDate ? RecalibrationStatus.RECEIVED : RecalibrationStatus.SENT,
              failedCycleId: cycle.id,
              reasonId: row.recalibrationReasonCode
                ? (reasonIds.get(row.recalibrationReasonCode) ?? null)
                : null,
              reasonNotes: row.remark,
              sentDate,
              receivedDate,
              turnaroundDays: receivedDate ? daysBetween(sentDate, receivedDate) : null,
              createdById: userId,
            },
          });
        }

        // The register's last date column is the day the slab left the line,
        // whatever the outcome. Which record it becomes is decided by the
        // remark, NOT by the presence of a date — a row remarked "Stock" with
        // a date in that column is a stock entry, not a dispatch.
        const outcomeDate = row.dispatchDate ?? row.receivedDate;

        if (row.disposition === Disposition.DISPATCH) {
          await tx.chromiaDispatch.create({
            data: {
              slabId: slab.id,
              dispatchDate: outcomeDate,
              dispatchedById: userId,
            },
          });
        }

        if (row.disposition === Disposition.STOCK) {
          await tx.chromiaStockEntry.create({
            data: {
              slabId: slab.id,
              stockDate: outcomeDate,
              notes: row.remark,
              createdById: userId,
            },
          });
        }

        if (row.disposition === Disposition.SAMPLE_CUTTING) {
          await tx.chromiaSampleCutting.create({
            data: {
              slabId: slab.id,
              cutDate: outcomeDate,
              purpose: row.remark,
              doneById: userId,
            },
          });
        }
      });

      imported += 1;
      if (AT_CHROMIA.has(status)) atChromia.push(row.slabNo);
    } catch (error) {
      failed += 1;
      notes.push({
        sourceRow: row.sourceRow,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const counts = { imported, alreadyPresent, blankRows, unreadable, failed };
  const status = importStatus(counts);
  const line = importSummaryLine(counts);

  await prisma.chromiaImportBatch.update({
    where: { id: importBatch.id },
    data: {
      status: ImportStatus[status],
      importedRows: imported,
      // The column has always been "rows not written". Both halves of that are
      // reported separately on screen; the stored figure keeps its old meaning
      // so previous runs stay comparable.
      skippedRows: alreadyPresent + blankRows,
      failedRows: failed,
      completedAt: new Date(),
      errorLog: notes.length > 0 ? notes : undefined,
    },
  });

  // One batched call, after every row is settled — the bridge never throws,
  // and a failure costs the inventory annotation, not the import.
  await markSlabsChromia(atChromia, null);

  log.info({ sourceFile: meta.sourceFile, status, ...counts }, 'Register import finished');

  return {
    importBatchId: importBatch.id,
    totalRows: parseResult.rows.length,
    ...counts,
    line,
    errors: notes.slice(0, 50),
  };
}

/**
 * Undo an import — remove the slabs a file brought in, and the batch record.
 *
 * Everything that hangs off each slab (its cycle, QC, grade decision, history,
 * recalibration trips and outcome record) goes with it by the same cascade a
 * single delete uses, scoped to the slab's own id. Each production batch keeps
 * its slab count straight, and an audit entry records the removal after the
 * rows it names are gone.
 *
 * Slab numbers are handed back to the plant, so a file imported by mistake can
 * be corrected and imported again.
 */
export async function deleteImportBatch(
  importBatchId: string,
  userId: string,
): Promise<{ deleted: number; sourceFile: string }> {
  const batch = await prisma.chromiaImportBatch.findUnique({
    where: { id: importBatchId },
    select: { id: true, sourceFile: true },
  });
  if (!batch) throw new NotFoundError('Import batch');

  const slabs = await prisma.chromiaSlab.findMany({
    where: { importBatchId },
    select: { id: true, batchId: true, slabNo: true },
  });

  await prisma.$transaction(async (tx) => {
    // Each production batch loses exactly the slabs this import gave it.
    const perBatch = new Map<string, number>();
    for (const slab of slabs) perBatch.set(slab.batchId, (perBatch.get(slab.batchId) ?? 0) + 1);
    for (const [batchId, count] of perBatch) {
      await tx.chromiaBatch.update({
        where: { id: batchId },
        data: { totalSlabs: { decrement: count } },
      });
    }

    // One id each, and everything removed with a slab is that slab's own
    // children — the database's cascade, the same one deleteSlabRecord relies on.
    if (slabs.length > 0) {
      await tx.chromiaSlab.deleteMany({ where: { importBatchId } });
    }

    await tx.chromiaAuditLog.create({
      data: {
        entity: 'ImportBatch',
        entityId: batch.id,
        action: AuditAction.DELETE,
        userId,
        changes: { sourceFile: batch.sourceFile, deletedSlabs: slabs.length },
      },
    });

    // No slab points at it now, so the batch row goes cleanly.
    await tx.chromiaImportBatch.delete({ where: { id: batch.id } });
  });

  // The marks the import made go with it — "a file imported by mistake can be
  // corrected and imported again" has to include the finished-goods sheet, or
  // a mistaken monthly import leaves hundreds of slabs stranded CHROMIA.
  // Guarded per slab: only a slab actually CHROMIA moves back; the re-import
  // then re-marks whatever the corrected file still shows at Chromia.
  await unmarkSlabsChromia(slabs.map((s) => s.slabNo), null);

  log.warn({ importBatchId, deleted: slabs.length }, 'Import batch deleted');
  return { deleted: slabs.length, sourceFile: batch.sourceFile };
}

export { MAX_RECALIBRATION_ATTEMPTS };
