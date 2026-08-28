import { ChromiaDisposition as Disposition } from '@prisma/client';
import type { ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';

import { prisma } from '@/lib/chromia/db';
import { isWithinRangeDays, padRange, type DateRange, type ExportKind } from '@/lib/chromia/exports';

/**
 * Rows for the download sheets.
 *
 * Every row carries the full slab record — the same columns the Slabs table
 * shows — plus the fields specific to that outcome. One row per outcome record,
 * so a slab stocked twice appears twice, which is what a movement sheet should
 * do.
 */
export interface ExportRow {
  slabId: string;
  /** The date this sheet is filtered on. */
  date: Date;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  design: string | null;
  inTime: Date | null;
  outTime: Date | null;
  processingMinutes: number | null;
  status: SlabStatus;
  grade: SlabGrade | null;
  disposition: Disposition | null;
  cycleNumber: number;
  recalibrationCount: number;
  receivedDate: Date;
  fullyPrintedDate: Date | null;
  thicknessMm: string | null;
  remarks: string | null;
  /** Outcome-specific columns, already labelled for the sheet. */
  extra: Record<string, string | number | null>;
}

/** The slab fields every sheet repeats. */
const slabSelect = {
  id: true,
  slabNo: true,
  status: true,
  currentGrade: true,
  currentDisposition: true,
  currentCycleNumber: true,
  recalibrationCount: true,
  receivedDate: true,
  currentThicknessMm: true,
  remarks: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { name: true, fileName: true } },
  cycles: {
    orderBy: { cycleNumber: 'desc' },
    take: 1,
    select: { inTime: true, outTime: true, processingMinutes: true, fullyPrintedDate: true },
  },
} as const;

type SlabPart = {
  id: string;
  slabNo: string;
  status: SlabStatus;
  currentGrade: SlabGrade | null;
  currentDisposition: Disposition | null;
  currentCycleNumber: number;
  recalibrationCount: number;
  receivedDate: Date;
  currentThicknessMm: { toString(): string } | null;
  remarks: string | null;
  batch: { batchNo: string };
  baseMaterial: { name: string };
  plannedDesign: { name: string; fileName: string } | null;
  cycles: {
    inTime: Date | null;
    outTime: Date | null;
    processingMinutes: number | null;
    fullyPrintedDate: Date | null;
  }[];
};

function baseRow(slab: SlabPart, date: Date, extra: ExportRow['extra']): ExportRow {
  const cycle = slab.cycles[0];

  return {
    slabId: slab.id,
    date,
    batchNo: slab.batch.batchNo,
    slabNo: slab.slabNo,
    baseMaterial: slab.baseMaterial.name,
    design: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? null,
    inTime: cycle?.inTime ?? null,
    outTime: cycle?.outTime ?? null,
    processingMinutes: cycle?.processingMinutes ?? null,
    status: slab.status,
    grade: slab.currentGrade,
    disposition: slab.currentDisposition,
    cycleNumber: slab.currentCycleNumber,
    recalibrationCount: slab.recalibrationCount,
    receivedDate: slab.receivedDate,
    fullyPrintedDate: cycle?.fullyPrintedDate ?? null,
    thicknessMm: slab.currentThicknessMm?.toString() ?? null,
    remarks: slab.remarks,
    extra,
  };
}

/** Load one sheet's worth of rows, oldest first so the sheet reads chronologically. */
export async function loadExportRows(kind: ExportKind, range: DateRange): Promise<ExportRow[]> {
  // Padded for the query, then filtered exactly by calendar day — see
  // `padRange` for why comparing instants alone loses whole months.
  const window = padRange(range);
  const onDay = (date: Date | null) => isWithinRangeDays(date, range);

  if (kind === 'DISPATCH') {
    // Dispatch is terminal: a genuinely dispatched slab always ends up with
    // `currentDisposition = DISPATCH`. Requiring it here means a stray record
    // can never put a stocked or sample-cut slab in the dispatch sheet.
    //
    // Stock and Sample Cutting deliberately carry no such guard — a stocked
    // slab may legitimately be dispatched later, and it must still appear in
    // the stock sheet for the period it was stocked.
    const rows = await prisma.chromiaDispatch.findMany({
      where: {
        dispatchDate: window,
        slab: { deletedAt: null, currentDisposition: Disposition.DISPATCH },
      },
      orderBy: [{ dispatchDate: 'asc' }],
      include: { slab: { select: slabSelect } },
    });

    // Dispatch carries no extra columns — the in-charge records only the date.
    return rows
      .filter((row) => onDay(row.dispatchDate))
      .map((row) => baseRow(row.slab, row.dispatchDate, {}));
  }

  if (kind === 'STOCK') {
    const rows = await prisma.chromiaStockEntry.findMany({
      where: { stockDate: window, slab: { deletedAt: null } },
      orderBy: [{ stockDate: 'asc' }],
      include: { slab: { select: slabSelect } },
    });

    // No extra columns. Stock carries the same eleven as every other sheet —
    // the note typed at QC stays on the record and in the slab's history, but
    // it is not something anybody reads a stock sheet for.
    return rows.filter((row) => onDay(row.stockDate)).map((row) => baseRow(row.slab, row.stockDate, {}));
  }

  if (kind === 'SAMPLE_CUTTING') {
    const rows = await prisma.chromiaSampleCutting.findMany({
      where: { cutDate: window, slab: { deletedAt: null } },
      orderBy: [{ cutDate: 'asc' }],
      include: { slab: { select: slabSelect } },
    });

    // Sample cutting carries no extra columns — the cut date is the record.
    return rows.filter((row) => onDay(row.cutDate)).map((row) => baseRow(row.slab, row.cutDate, {}));
  }

  /*
   * Recalibration — the slabs still in the loop.
   *
   * Guarded on `currentDisposition = RECALIBRATION`, like Dispatch, and for a
   * stronger reason: a slab that has been out twice and then passed QC is now
   * Stock or Dispatch, and it has no business on a sheet of slabs awaiting
   * recalibration. Its trips are history, not an outstanding job. The guard
   * reads the slab's *current* outcome, so a slab drops off this sheet the
   * moment QC clears it, without anything having to be tidied up by hand.
   *
   * Dated on when QC condemned the slab rather than when it was sent, because
   * most rows here have never been sent — that is the point of the list.
   */
  const rows = await prisma.chromiaRecalibrationCycle.findMany({
    where: {
      createdAt: window,
      slab: { deletedAt: null, currentDisposition: Disposition.RECALIBRATION },
    },
    orderBy: [{ createdAt: 'asc' }],
    include: {
      reason: { select: { name: true } },
      slab: { select: slabSelect },
    },
  });

  const day = (date: Date | null) => {
    if (!date) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  return rows
    .filter((row) => onDay(row.createdAt))
    .map((row) =>
      baseRow(row.slab, row.createdAt, {
        Attempt: row.attemptNumber,
        Reason: row.reason?.name ?? null,
        'Sent Date': day(row.sentDate),
        'Received Date': day(row.receivedDate),
      }),
    );
}

/**
 * Complete production — every slab received in the period.
 *
 * Not filtered by outcome: this is the whole day's, week's or month's
 * production, whatever became of each slab. The three outcome dates ride along
 * so one row tells the slab's whole story without opening three files.
 */
export interface ProductionRow {
  slabId: string;
  receivedDate: Date;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  design: string | null;
  /** Centimetres — the register's unit. The database stores millimetres. */
  thicknessCm: number | null;
  inTime: Date | null;
  outTime: Date | null;
  fullyPrintedDate: Date | null;
  status: SlabStatus;
  grade: SlabGrade | null;
  disposition: Disposition | null;
  recalibrationCount: number;
  /** The slab's own remark — the same string Slab Records shows. */
  remarks: string | null;
  dispatchDate: Date | null;
  stockDate: Date | null;
  cutDate: Date | null;
}

export async function loadProductionRows(range: DateRange): Promise<ProductionRow[]> {
  const rows = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null, receivedDate: padRange(range) },
    orderBy: [{ receivedDate: 'asc' }, { slabNo: 'asc' }],
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentGrade: true,
      currentDisposition: true,
      recalibrationCount: true,
      receivedDate: true,
      currentThicknessMm: true,
      remarks: true,
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true, fileName: true } },
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { inTime: true, outTime: true, fullyPrintedDate: true },
      },
      dispatches: { orderBy: { dispatchDate: 'desc' }, take: 1, select: { dispatchDate: true } },
      stockEntries: { orderBy: { stockDate: 'desc' }, take: 1, select: { stockDate: true } },
      sampleCuttings: { orderBy: { cutDate: 'desc' }, take: 1, select: { cutDate: true } },
    },
  });

  return rows
    .filter((row) => isWithinRangeDays(row.receivedDate, range))
    .map((row) => {
      const cycle = row.cycles[0];

      return {
        slabId: row.id,
        receivedDate: row.receivedDate,
        batchNo: row.batch.batchNo,
        slabNo: row.slabNo,
        baseMaterial: row.baseMaterial.name,
        design: row.plannedDesign?.fileName ?? row.plannedDesign?.name ?? null,
        thicknessCm:
          row.currentThicknessMm === null ? null : Number(row.currentThicknessMm) / 10,
        inTime: cycle?.inTime ?? null,
        outTime: cycle?.outTime ?? null,
        fullyPrintedDate: cycle?.fullyPrintedDate ?? null,
        status: row.status,
        grade: row.currentGrade,
        disposition: row.currentDisposition,
        recalibrationCount: row.recalibrationCount,
        remarks: row.remarks,
        dispatchDate: row.dispatches[0]?.dispatchDate ?? null,
        stockDate: row.stockEntries[0]?.stockDate ?? null,
        cutDate: row.sampleCuttings[0]?.cutDate ?? null,
      };
    });
}
