import "server-only";

// Reads for the Chromia screens. Ported from the standalone module's
// server/repositories/*, collapsed into one module because the ERP keeps a
// department's data access in one place (compare lib/fab/*).
//
// Everything here is READ-ONLY. Writes live in actions.ts, where each one is a
// transaction that updates the slab's denormalised position and appends the
// event that explains it — the two must never drift, and separating the files
// makes it obvious which side of that line a function is on.

import { prisma } from "@/lib/prisma";
import {
  recalibrationAgeing, STAGE_ORDER,
  type ProcessStage, type RecalibrationAgeing, type SlabStatus,
} from "./process";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardCounts {
  byStatus: Record<string, number>;
  byStage: Array<{ stage: ProcessStage; count: number }>;
  onLine: number;
  awaitingQc: number;
  outForRecalibration: number;
  overdueRecalibrations: number;
  receivedToday: number;
  completedToday: number;
  totalSlabs: number;
}

function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function dashboardCounts(now = new Date()): Promise<DashboardCounts> {
  const since = startOfToday(now);

  const [statusRows, stageRows, total, receivedToday, completedToday, outstanding] =
    await Promise.all([
      prisma.chromiaSlab.groupBy({
        by: ["status"], where: { deletedAt: null }, _count: { _all: true },
      }),
      prisma.chromiaSlab.groupBy({
        by: ["currentStage"],
        where: { deletedAt: null, currentStage: { not: null } },
        _count: { _all: true },
      }),
      prisma.chromiaSlab.count({ where: { deletedAt: null } }),
      prisma.chromiaSlab.count({ where: { deletedAt: null, receivedDate: { gte: since } } }),
      // "Completed today" is the cycle coming OUT of the processing window, not
      // the slab being created — a slab received last week and finished this
      // morning belongs to today's output.
      prisma.chromiaProcessCycle.count({ where: { outTime: { gte: since } } }),
      prisma.chromiaRecalibrationCycle.findMany({
        where: { receivedDate: null, status: { in: ["SENT", "AT_FACILITY"] } },
        select: { sentDate: true, expectedReturnDate: true },
      }),
    ]);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r._count._all;

  const stageCounts = new Map<string, number>();
  for (const r of stageRows) {
    if (r.currentStage) stageCounts.set(r.currentStage, r._count._all);
  }
  // Every stage is listed, including the empty ones: a WIP board with gaps
  // where nothing is sitting reads as a broken query rather than an idle stage.
  const byStage = STAGE_ORDER.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 }));

  const overdueRecalibrations = outstanding.filter(
    (r) => recalibrationAgeing(r, now).overdue,
  ).length;

  return {
    byStatus,
    byStage,
    onLine: byStatus.IN_PROCESS ?? 0,
    awaitingQc: byStatus.UNDER_INSPECTION ?? 0,
    outForRecalibration: byStatus.OUT_FOR_RECALIBRATION ?? 0,
    overdueRecalibrations,
    receivedToday,
    completedToday,
    totalSlabs: total,
  };
}

// ---------------------------------------------------------------------------
// Slab register
// ---------------------------------------------------------------------------

export interface SlabRow {
  id: string;
  slabNo: string;
  batchNo: string;
  status: SlabStatus;
  currentStage: ProcessStage | null;
  cycleNumber: number;
  grade: string | null;
  disposition: string | null;
  design: string | null;
  location: string | null;
  recalibrationCount: number;
  receivedDate: Date;
}

export interface SlabQuery {
  q?: string | null;
  status?: string | null;
  stage?: string | null;
  limit?: number;
  offset?: number;
}

export async function listSlabs(query: SlabQuery = {}): Promise<{
  slabs: SlabRow[]; total: number;
}> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const q = (query.q ?? "").trim();

  const where = {
    deletedAt: null,
    // Slab number OR batch number, because that is how the floor asks: someone
    // holding a slab reads its own number, someone chasing an order has the
    // batch. Requiring the user to know which box to type it in is the kind of
    // friction that sends people back to the spreadsheet.
    ...(q
      ? {
          OR: [
            { slabNo: { contains: q, mode: "insensitive" as const } },
            { batch: { batchNo: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(query.status ? { status: query.status as SlabStatus } : {}),
    ...(query.stage ? { currentStage: query.stage as ProcessStage } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.chromiaSlab.findMany({
      where,
      orderBy: [{ receivedDate: "desc" }, { slabNo: "asc" }],
      take: limit,
      skip: offset,
      select: {
        id: true, slabNo: true, status: true, currentStage: true,
        currentCycleNumber: true, currentGrade: true, currentDisposition: true,
        recalibrationCount: true, receivedDate: true,
        batch: { select: { batchNo: true } },
        plannedDesign: { select: { name: true } },
        currentLocation: { select: { name: true } },
      },
    }),
    prisma.chromiaSlab.count({ where }),
  ]);

  return {
    total,
    slabs: rows.map((r) => ({
      id: r.id,
      slabNo: r.slabNo,
      batchNo: r.batch.batchNo,
      status: r.status as SlabStatus,
      currentStage: r.currentStage as ProcessStage | null,
      cycleNumber: r.currentCycleNumber,
      grade: r.currentGrade,
      disposition: r.currentDisposition,
      design: r.plannedDesign?.name ?? null,
      location: r.currentLocation?.name ?? null,
      recalibrationCount: r.recalibrationCount,
      receivedDate: r.receivedDate,
    })),
  };
}

// ---------------------------------------------------------------------------
// One slab, in full — the traceability view
// ---------------------------------------------------------------------------

export async function slabDetail(slabNo: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { slabNo, deletedAt: null },
    include: {
      batch: { select: { batchNo: true, receivedDate: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true } },
      currentLocation: { select: { name: true } },
      cycles: {
        orderBy: { cycleNumber: "asc" },
        include: {
          design: { select: { name: true } },
          stageRecords: { orderBy: { sequence: "asc" } },
          qcRecord: true,
          gradeDecision: true,
        },
      },
      recalibrations: {
        orderBy: { attemptNumber: "asc" },
        include: { reason: { select: { name: true } } },
      },
      // Newest first and capped: the event log is the audit trail, and a slab
      // on its fourth cycle has hundreds. The screen shows the recent ones and
      // the cycles above carry the structure.
      events: { orderBy: { occurredAt: "desc" }, take: 100 },
    },
  });
  return slab;
}

// ---------------------------------------------------------------------------
// Recalibration tracking — the module's whole reason for existing
// ---------------------------------------------------------------------------

export interface RecalibrationRow {
  id: string;
  slabId: string;
  slabNo: string;
  batchNo: string;
  attemptNumber: number;
  status: string;
  reason: string | null;
  facilityName: string | null;
  sentDate: Date | null;
  expectedReturnDate: Date | null;
  receivedDate: Date | null;
  ageing: RecalibrationAgeing;
}

/**
 * Outstanding recalibrations, longest out first.
 *
 * Sorted by send date rather than by created date so the top of the list is
 * always the slab that has been missing longest — the one to chase this
 * morning. `includeReturned` switches the same query to history.
 */
export async function listRecalibrations(
  opts: { includeReturned?: boolean; limit?: number } = {},
  now = new Date(),
): Promise<RecalibrationRow[]> {
  const rows = await prisma.chromiaRecalibrationCycle.findMany({
    where: opts.includeReturned
      ? {}
      : { receivedDate: null, status: { in: ["PENDING_DISPATCH", "SENT", "AT_FACILITY"] } },
    orderBy: [{ sentDate: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(opts.limit ?? 200, 1), 500),
    include: {
      reason: { select: { name: true } },
      slab: { select: { id: true, slabNo: true, batch: { select: { batchNo: true } } } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    slabId: r.slab.id,
    slabNo: r.slab.slabNo,
    batchNo: r.slab.batch.batchNo,
    attemptNumber: r.attemptNumber,
    status: r.status,
    reason: r.reason?.name ?? r.reasonNotes ?? null,
    facilityName: r.facilityName,
    sentDate: r.sentDate,
    expectedReturnDate: r.expectedReturnDate,
    receivedDate: r.receivedDate,
    ageing: recalibrationAgeing(r, now),
  }));
}

// ---------------------------------------------------------------------------
// Operator entry
// ---------------------------------------------------------------------------

/** Slabs an operator can act on right now: on the line or waiting to start.
 *  Terminal states (dispatched, waste, out for recalibration) are excluded —
 *  offering them invites a tap that would have to be undone. */
export async function operatorQueue(limit = 100) {
  return prisma.chromiaSlab.findMany({
    where: {
      deletedAt: null,
      status: { in: ["RECEIVED", "IN_PROCESS", "RECEIVED_FROM_RECALIBRATION", "ON_HOLD"] },
    },
    orderBy: [{ currentStage: "asc" }, { slabNo: "asc" }],
    take: limit,
    select: {
      id: true, slabNo: true, status: true, currentStage: true,
      currentCycleNumber: true, recalibrationCount: true,
      batch: { select: { batchNo: true } },
      currentLocation: { select: { name: true } },
    },
  });
}

/** Master lists the entry forms pick from. Loaded together because every write
 *  screen needs all of them and three round trips is three chances to be slow. */
export async function referenceData() {
  const [machines, locations, designs, reasons] = await Promise.all([
    prisma.chromiaMachine.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.chromiaLocation.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.chromiaDesign.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.chromiaRecalibrationReason.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { machines, locations, designs, reasons };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface SummaryRow {
  label: string;
  value: number;
}

/** The Summary screen's figures for a date window. Grades and dispositions come
 *  from the CYCLE rather than the slab, so a slab graded C on cycle 1 and A on
 *  cycle 2 counts once in each — which is what a monthly output report means. */
export async function summary(from: Date, to: Date) {
  const [grades, dispositions, prints, cycles, recalSent, recalBack] = await Promise.all([
    prisma.chromiaProcessCycle.groupBy({
      by: ["finalGrade"],
      where: { outTime: { gte: from, lte: to }, finalGrade: { not: null } },
      _count: { _all: true },
    }),
    prisma.chromiaProcessCycle.groupBy({
      by: ["disposition"],
      where: { outTime: { gte: from, lte: to }, disposition: { not: null } },
      _count: { _all: true },
    }),
    prisma.chromiaProcessCycle.groupBy({
      by: ["printResult"],
      where: { outTime: { gte: from, lte: to }, printResult: { not: null } },
      _count: { _all: true },
    }),
    prisma.chromiaProcessCycle.aggregate({
      where: { outTime: { gte: from, lte: to }, processingMinutes: { not: null } },
      _count: { _all: true },
      _avg: { processingMinutes: true },
    }),
    prisma.chromiaRecalibrationCycle.count({ where: { sentDate: { gte: from, lte: to } } }),
    prisma.chromiaRecalibrationCycle.count({ where: { receivedDate: { gte: from, lte: to } } }),
  ]);

  return {
    grades: grades.map((g) => ({ label: g.finalGrade ?? "—", value: g._count._all })),
    dispositions: dispositions.map((d) => ({ label: d.disposition ?? "—", value: d._count._all })),
    prints: prints.map((p) => ({ label: p.printResult ?? "—", value: p._count._all })),
    cyclesCompleted: cycles._count._all,
    avgProcessingMinutes: cycles._avg.processingMinutes,
    recalibrationsSent: recalSent,
    recalibrationsReturned: recalBack,
  };
}
