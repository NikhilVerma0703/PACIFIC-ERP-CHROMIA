/**
 * Chromia process stage catalogue.
 *
 * The enum TYPES come from the Prisma schema (the single source of truth);
 * this module adds the ordering, human labels and business limits that the
 * database does not express.
 *
 * The enum VALUES are declared here as local objects, not imported from
 * '@prisma/client'. A value import of a Prisma enum pulls the client's browser
 * stub — every model's field table — into whichever bundle imports it, and
 * this module is imported by the operator and recalibration tablet screens
 * (≈35 kB gzipped on the shop-floor tablet for four small enums). Prisma's
 * enums are plain `{ A: 'A', ... }` objects, so a local object is identical at
 * runtime; `satisfies Record<E, E>` makes tsc fail the build if the schema
 * ever adds, removes or renames a member, so the two cannot drift.
 */
import type { ChromiaDisposition as DispositionType, ChromiaProcessStage as ProcessStageType, ChromiaSlabGrade as SlabGradeType, ChromiaSlabStatus as SlabStatusType } from '@prisma/client';

export const Disposition = {
  DISPATCH: 'DISPATCH', STOCK: 'STOCK', SAMPLE_CUTTING: 'SAMPLE_CUTTING', RECALIBRATION: 'RECALIBRATION', WASTE: 'WASTE',
} as const satisfies Record<DispositionType, DispositionType>;
export const ProcessStage = {
  INCOMING: 'INCOMING', INCOMING_DETAILS: 'INCOMING_DETAILS', BASE_PRIMER: 'BASE_PRIMER', PRINTING: 'PRINTING',
  MOULDING: 'MOULDING', COOLING: 'COOLING', POLISHING: 'POLISHING', UV_POLISHING: 'UV_POLISHING',
  QUALITY_CHECK: 'QUALITY_CHECK', GRADE_DECISION: 'GRADE_DECISION',
} as const satisfies Record<ProcessStageType, ProcessStageType>;
export const SlabGrade = { A: 'A', B: 'B', C: 'C' } as const satisfies Record<SlabGradeType, SlabGradeType>;
export const SlabStatus = {
  RECEIVED: 'RECEIVED', IN_PROCESS: 'IN_PROCESS', UNDER_INSPECTION: 'UNDER_INSPECTION', GRADED: 'GRADED',
  OUT_FOR_RECALIBRATION: 'OUT_FOR_RECALIBRATION', RECEIVED_FROM_RECALIBRATION: 'RECEIVED_FROM_RECALIBRATION',
  IN_STOCK: 'IN_STOCK', SAMPLE_CUT: 'SAMPLE_CUT', DISPATCHED: 'DISPATCHED', WASTE: 'WASTE', ON_HOLD: 'ON_HOLD',
} as const satisfies Record<SlabStatusType, SlabStatusType>;
// Prisma exports each enum as a value AND a type of the same name; callers
// write `grade: SlabGrade` in a signature and `SlabGrade.A` in a body. Keep
// that contract so every existing import works unchanged.
export type Disposition = DispositionType;
export type ProcessStage = ProcessStageType;
export type SlabGrade = SlabGradeType;
export type SlabStatus = SlabStatusType;
export type { DispositionType as SlabDisposition, ProcessStageType, SlabGradeType, SlabStatusType };

/** Backwards-compatible alias used across the app. */
export const PROCESS_STAGES = ProcessStage;

/** Stage order. Index position is the slab's progress through the line. */
export const PROCESS_STAGE_ORDER: readonly ProcessStageType[] = [
  ProcessStage.INCOMING,
  ProcessStage.INCOMING_DETAILS,
  ProcessStage.BASE_PRIMER,
  ProcessStage.PRINTING,
  ProcessStage.MOULDING,
  ProcessStage.COOLING,
  ProcessStage.POLISHING,
  ProcessStage.UV_POLISHING,
  ProcessStage.QUALITY_CHECK,
  ProcessStage.GRADE_DECISION,
];

export const PROCESS_STAGE_LABELS: Record<ProcessStageType, string> = {
  INCOMING: 'Incoming Slab',
  INCOMING_DETAILS: 'Incoming Details',
  BASE_PRIMER: 'Base Primer',
  PRINTING: 'Printing',
  MOULDING: 'Moulding',
  COOLING: 'Cooling',
  POLISHING: 'Polishing',
  UV_POLISHING: 'UV Polishing',
  QUALITY_CHECK: 'Quality Check',
  GRADE_DECISION: 'Grade Decision',
};

/**
 * The six stages the slab passes through between in-time and out-time.
 * They are NOT recorded individually — the operator stamps the slab in on
 * entry and out once all six are finished. Kept here for display, for defect
 * classification and for the process documentation.
 */
export const PRODUCTION_STAGES: readonly ProcessStageType[] = [
  ProcessStage.BASE_PRIMER,
  ProcessStage.PRINTING,
  ProcessStage.MOULDING,
  ProcessStage.COOLING,
  ProcessStage.POLISHING,
  ProcessStage.UV_POLISHING,
];

export const PRODUCTION_STAGE_NAMES: readonly string[] = PRODUCTION_STAGES.map(
  (stage) => PROCESS_STAGE_LABELS[stage],
);

/** Indicative stage durations in minutes — see CHROMIA_PROCESS.md section 5. */
export const PROCESS_STAGE_EXPECTED_MINUTES: Record<ProcessStageType, number> = {
  INCOMING: 15,
  INCOMING_DETAILS: 20,
  BASE_PRIMER: 45,
  PRINTING: 40,
  MOULDING: 90,
  COOLING: 240,
  POLISHING: 60,
  UV_POLISHING: 40,
  QUALITY_CHECK: 30,
  GRADE_DECISION: 10,
};

/** 1-based position of a stage in the line. Returns 0 for an unknown stage. */
export function stageSequence(stage: ProcessStageType): number {
  return PROCESS_STAGE_ORDER.indexOf(stage) + 1;
}

/** The stage that follows `stage`, or null if it is the last one. */
export function nextStage(stage: ProcessStageType): ProcessStageType | null {
  const index = PROCESS_STAGE_ORDER.indexOf(stage);
  if (index < 0 || index === PROCESS_STAGE_ORDER.length - 1) return null;
  return PROCESS_STAGE_ORDER[index + 1] ?? null;
}

export const SLAB_GRADES = SlabGrade;
export const SLAB_DISPOSITIONS = Disposition;

export const SLAB_GRADE_LABELS: Record<SlabGradeType, string> = {
  A: 'Grade A — Premium',
  B: 'Grade B — Standard',
  C: 'Grade C — Rejected',
};

export const DISPOSITION_LABELS: Record<DispositionType, string> = {
  DISPATCH: 'Dispatch',
  STOCK: 'Stock',
  SAMPLE_CUTTING: 'Sample Cutting',
  RECALIBRATION: 'Recalibration',
  WASTE: 'Waste',
};

export const SLAB_STATUS_LABELS: Record<SlabStatusType, string> = {
  RECEIVED: 'Received',
  IN_PROCESS: 'In Processing',
  UNDER_INSPECTION: 'Awaiting QC',
  GRADED: 'Graded',
  OUT_FOR_RECALIBRATION: 'Out for Recalibration',
  RECEIVED_FROM_RECALIBRATION: 'Back from Recalibration',
  IN_STOCK: 'In Stock',
  SAMPLE_CUT: 'Sample Cut',
  DISPATCHED: 'Dispatched',
  WASTE: 'Waste',
  ON_HOLD: 'On Hold',
};

/** Dispositions allowed for each grade. See CHROMIA_PROCESS.md section 6. */
export const GRADE_ALLOWED_DISPOSITIONS: Record<SlabGradeType, readonly DispositionType[]> = {
  A: [Disposition.DISPATCH, Disposition.STOCK],
  B: [Disposition.STOCK, Disposition.SAMPLE_CUTTING],
  // Waste is not an outcome this line records: a failed slab goes back out for
  // recalibration, and only the fifth failure ends its life — that write-off is
  // handled in the Recalibration section, not offered at QC.
  C: [Disposition.RECALIBRATION],
};

/**
 * Hard business limit: a slab may be recalibrated at most five times.
 * On the sixth failure it is written off as waste.
 */
export const MAX_RECALIBRATION_ATTEMPTS = 5;

/** Days after which an outstanding recalibration is flagged overdue. */
export const RECALIBRATION_OVERDUE_DAYS = 10;
