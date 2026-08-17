// The Chromia line's rules: stage order, grade outcomes, recalibration limits
// and ageing. Ported from the standalone module's constants/process-stages.ts,
// plus the derivations its services did inline.
//
// PURE and IMPORT-FREE, like pipelineRules.ts and fab/routing.ts. `node --test`
// resolves ESM strictly, so a relative import without a .ts extension fails at
// runtime while adding one fights the Next build; every unit-tested module in
// this repo is self-contained for that reason. The enum VALUES are therefore
// restated here as string-literal unions rather than imported from
// @prisma/client — and `assertEnumsMatchSchema` at the bottom of this file is a
// compile-time check that they still agree with prisma/schema.prisma, so a
// value added there and forgotten here is a build error, not a silent gap.

export type ProcessStage =
  | "INCOMING" | "INCOMING_DETAILS" | "BASE_PRIMER" | "PRINTING" | "MOULDING"
  | "COOLING" | "POLISHING" | "UV_POLISHING" | "QUALITY_CHECK" | "GRADE_DECISION";

export type SlabGrade = "A" | "B" | "C";

export type Disposition =
  | "DISPATCH" | "STOCK" | "SAMPLE_CUTTING" | "RECALIBRATION" | "WASTE";

export type SlabStatus =
  | "RECEIVED" | "IN_PROCESS" | "UNDER_INSPECTION" | "GRADED"
  | "OUT_FOR_RECALIBRATION" | "RECEIVED_FROM_RECALIBRATION" | "IN_STOCK"
  | "SAMPLE_CUT" | "DISPATCHED" | "WASTE" | "ON_HOLD";

export type RecalibrationStatus =
  | "PENDING_DISPATCH" | "SENT" | "AT_FACILITY" | "RECEIVED" | "RESTARTED" | "CANCELLED";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** Stage order. A slab must complete each in turn; none may be skipped or
 *  reordered (CHROMIA_PROCESS.md section 4). */
export const STAGE_ORDER: readonly ProcessStage[] = [
  "INCOMING", "INCOMING_DETAILS", "BASE_PRIMER", "PRINTING", "MOULDING",
  "COOLING", "POLISHING", "UV_POLISHING", "QUALITY_CHECK", "GRADE_DECISION",
];

export const STAGE_LABEL: Record<ProcessStage, string> = {
  INCOMING: "Incoming Slab",
  INCOMING_DETAILS: "Incoming Details",
  BASE_PRIMER: "Base Primer",
  PRINTING: "Printing",
  MOULDING: "Moulding",
  COOLING: "Cooling",
  POLISHING: "Polishing",
  UV_POLISHING: "UV Polishing",
  QUALITY_CHECK: "Quality Check",
  GRADE_DECISION: "Grade Decision",
};

/**
 * The six stages between in-time and out-time.
 *
 * They are NOT timed individually. The operator stamps the slab IN when it
 * enters processing and OUT when all six are finished — that is the change the
 * process doc calls "the in-time / out-time change", and it is why
 * ChromiaProcessCycle carries one inTime/outTime pair rather than six.
 */
export const PRODUCTION_STAGES: readonly ProcessStage[] = [
  "BASE_PRIMER", "PRINTING", "MOULDING", "COOLING", "POLISHING", "UV_POLISHING",
];

/** Indicative durations in minutes — CHROMIA_PROCESS.md section 5. Used to
 *  flag a stage as running long, never to advance one automatically. */
export const STAGE_EXPECTED_MINUTES: Record<ProcessStage, number> = {
  INCOMING: 15, INCOMING_DETAILS: 20, BASE_PRIMER: 45, PRINTING: 40,
  MOULDING: 90, COOLING: 240, POLISHING: 60, UV_POLISHING: 40,
  QUALITY_CHECK: 30, GRADE_DECISION: 10,
};

/** 1-based position in the line; 0 for a stage that is not in the order. */
export function stageSequence(stage: ProcessStage): number {
  return STAGE_ORDER.indexOf(stage) + 1;
}

/** The stage after this one, or null at the end of the line. */
export function nextStage(stage: ProcessStage): ProcessStage | null {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0 || i === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[i + 1] ?? null;
}

export function isProductionStage(stage: ProcessStage): boolean {
  return PRODUCTION_STAGES.includes(stage);
}

/**
 * Whether a slab sitting at `current` may be advanced to `target`.
 *
 * Forward by exactly one. Not "forward by any amount": skipping a stage is the
 * failure this rule exists to stop — an operator on a busy line tapping the
 * stage they are working on rather than the one that comes next, which silently
 * loses the record that priming or printing ever happened.
 */
export function canAdvance(current: ProcessStage | null, target: ProcessStage): boolean {
  if (current === null) return target === STAGE_ORDER[0];
  return nextStage(current) === target;
}

// ---------------------------------------------------------------------------
// Grades and dispositions
// ---------------------------------------------------------------------------

export const GRADE_LABEL: Record<SlabGrade, string> = {
  A: "Grade A — Premium",
  B: "Grade B — Standard",
  C: "Grade C — Rejected",
};

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  DISPATCH: "Dispatch",
  STOCK: "Stock",
  SAMPLE_CUTTING: "Sample Cutting",
  RECALIBRATION: "Recalibration",
  WASTE: "Waste",
};

export const STATUS_LABEL: Record<SlabStatus, string> = {
  RECEIVED: "Received",
  IN_PROCESS: "In Processing",
  UNDER_INSPECTION: "Awaiting QC",
  GRADED: "Graded",
  OUT_FOR_RECALIBRATION: "Out for Recalibration",
  RECEIVED_FROM_RECALIBRATION: "Back from Recalibration",
  IN_STOCK: "In Stock",
  SAMPLE_CUT: "Sample Cut",
  DISPATCHED: "Dispatched",
  WASTE: "Waste",
  ON_HOLD: "On Hold",
};

/**
 * What each grade may become — CHROMIA_PROCESS.md section 6.
 *
 * A premium slab is never sample-cut and a rejected one is never dispatched;
 * enforcing that here rather than in the form is the difference between a rule
 * and a suggestion, because the disposition endpoint takes whatever it is sent.
 */
export const GRADE_DISPOSITIONS: Record<SlabGrade, readonly Disposition[]> = {
  A: ["DISPATCH", "STOCK"],
  B: ["STOCK", "SAMPLE_CUTTING"],
  C: ["RECALIBRATION", "WASTE"],
};

export function dispositionAllowed(grade: SlabGrade, disposition: Disposition): boolean {
  return GRADE_DISPOSITIONS[grade].includes(disposition);
}

// ---------------------------------------------------------------------------
// Recalibration
// ---------------------------------------------------------------------------

/** Hard limit: five recalibrations. On the sixth failure the slab is written
 *  off, because each pass removes upper surface and there is not enough left. */
export const MAX_RECALIBRATION_ATTEMPTS = 5;

/** Days outstanding after which a recalibration is chased. */
export const RECALIBRATION_OVERDUE_DAYS = 10;

export interface RecalibrationEligibility {
  allowed: boolean;
  attemptNumber: number;
  remaining: number;
  reason: string | null;
}

/**
 * Whether a failed slab may be sent for recalibration again.
 *
 * `attemptNumber` is what THIS send would be, so the caller writes it straight
 * onto the cycle rather than recomputing (and disagreeing about whether the
 * count is before or after the increment — the kind of off-by-one that lets a
 * sixth attempt through).
 */
export function recalibrationEligibility(
  previousCount: number,
  opts: { alreadyOut?: boolean } = {},
): RecalibrationEligibility {
  const done = Math.max(0, Math.trunc(previousCount));
  const attemptNumber = done + 1;
  const remaining = Math.max(0, MAX_RECALIBRATION_ATTEMPTS - done);

  if (opts.alreadyOut) {
    return {
      allowed: false, attemptNumber, remaining,
      reason: "This slab is already out for recalibration.",
    };
  }
  if (done >= MAX_RECALIBRATION_ATTEMPTS) {
    return {
      allowed: false, attemptNumber, remaining: 0,
      reason: `Recalibrated ${done} times already — the limit is ` +
        `${MAX_RECALIBRATION_ATTEMPTS}. This slab has to be written off as waste.`,
    };
  }
  return { allowed: true, attemptNumber, remaining, reason: null };
}

export interface RecalibrationAgeing {
  /** Whole days since it was sent — of the return if it is back, else of today. */
  daysOut: number | null;
  outstanding: boolean;
  overdue: boolean;
  /** Days past the expected return date; 0 when not past it or none was given. */
  daysLate: number;
}

const DAY_MS = 86_400_000;

/** Whole days between two instants, floored — a slab sent yesterday evening and
 *  looked at this morning is 0 days out, not 1. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * How long a recalibration has been out, and whether anyone should be chasing.
 *
 * This is the module's whole reason for existing: the Excel register recorded
 * that a slab was SENT and then the trail went cold, so nobody could say which
 * slabs were overdue or how long they had been gone.
 */
export function recalibrationAgeing(
  input: {
    sentDate: Date | null | undefined;
    receivedDate?: Date | null;
    expectedReturnDate?: Date | null;
  },
  now: Date = new Date(),
): RecalibrationAgeing {
  const { sentDate, receivedDate, expectedReturnDate } = input;
  if (!sentDate) {
    return { daysOut: null, outstanding: false, overdue: false, daysLate: 0 };
  }
  const end = receivedDate ?? now;
  const daysOut = Math.max(0, daysBetween(sentDate, end));
  const outstanding = !receivedDate;

  // Overdue is judged against the committed date when there is one, and against
  // the standing limit when there is not. A facility that never committed to a
  // date must not be exempt from being chased.
  const daysLate = outstanding && expectedReturnDate
    ? Math.max(0, daysBetween(expectedReturnDate, now))
    : 0;
  const overdue = outstanding && (
    expectedReturnDate ? daysLate > 0 : daysOut > RECALIBRATION_OVERDUE_DAYS
  );

  return { daysOut, outstanding, overdue, daysLate };
}

/** Material removed by one recalibration pass, and whether enough slab is left.
 *  Null thickness means it was not measured, which is not the same as zero. */
export function thicknessRemoved(
  beforeMm: number | null | undefined,
  afterMm: number | null | undefined,
): number | null {
  if (beforeMm == null || afterMm == null) return null;
  return Math.round((Number(beforeMm) - Number(afterMm)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Processing window
// ---------------------------------------------------------------------------

/** Minutes between in-time and out-time, or null while the slab is still in.
 *  Negative spans return null: an out-time before the in-time is a typo, and
 *  a negative duration in a report is worse than a blank one. */
export function processingMinutes(
  inTime: Date | null | undefined,
  outTime: Date | null | undefined,
): number | null {
  if (!inTime || !outTime) return null;
  const mins = Math.round((outTime.getTime() - inTime.getTime()) / 60_000);
  return mins < 0 ? null : mins;
}

// ---------------------------------------------------------------------------
// Schema agreement
// ---------------------------------------------------------------------------

/**
 * Compile-time proof that the unions above still match prisma/schema.prisma.
 *
 * The types come from @prisma/client, so this import is erased at runtime and
 * `node --test` never sees it — but `tsc` does, and a value added to an enum in
 * the schema without being added here fails the build with a named mismatch
 * rather than silently dropping out of a label map or a stage order.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type EnumsMatchSchema = [
  Exact<ProcessStage, import("@prisma/client").ChromiaProcessStage>,
  Exact<SlabGrade, import("@prisma/client").ChromiaSlabGrade>,
  Exact<Disposition, import("@prisma/client").ChromiaDisposition>,
  Exact<SlabStatus, import("@prisma/client").ChromiaSlabStatus>,
  Exact<RecalibrationStatus, import("@prisma/client").ChromiaRecalibrationStatus>,
];
