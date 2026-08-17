"use server";

// Every write the Chromia line makes.
//
// ONE RULE HOLDS THIS FILE TOGETHER: a slab's denormalised position
// (status / currentStage / currentCycleNumber / location) and the append-only
// ChromiaSlabEvent that explains the change are written in the SAME
// transaction. The event log is the audit trail the Excel register could never
// provide, and a position that moved without an event — or an event describing
// a move that did not happen — makes it worthless. Nothing here updates a slab
// outside a transaction that also appends its event.
//
// Every action re-gates. Middleware stops the request at /chromia, the page
// gates its own render, and this gates the mutation; a server action is a POST
// endpoint anyone with a session can call, so the page's check is not this
// function's check.

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { chromiaGate, CHROMIA_MIN_TIER } from "./access";
import {
  canAdvance, dispositionAllowed, processingMinutes, recalibrationEligibility,
  STAGE_ORDER, stageSequence, thicknessRemoved,
  type Disposition, type ProcessStage, type SlabGrade,
} from "./process";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function done(message: string, paths: string[] = []): ActionResult {
  for (const p of paths) revalidatePath(p);
  return { ok: true, message };
}

const FLOOR_PATHS = ["/chromia", "/chromia/operator", "/chromia/slabs"];
const RECAL_PATHS = [...FLOOR_PATHS, "/chromia/recalibrations", "/chromia/recalibration-tracking"];

/** The acting user's id, or null when they may not do this. Tier is checked
 *  against the guard group the module used for that kind of work. */
async function actor(min: keyof typeof CHROMIA_MIN_TIER): Promise<
  { id: string } | null
> {
  const gate = await chromiaGate(CHROMIA_MIN_TIER[min]);
  if (!gate.ok) return null;
  const id = (gate.user as { id?: string } | null)?.id;
  return id ? { id } : null;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/**
 * Stamp a slab IN — the start of the processing window.
 *
 * The six production stages are not timed individually (CHROMIA_PROCESS.md,
 * "the in-time / out-time change"), so this is the only in-time the slab gets
 * for this cycle. Re-stamping one already in would silently move the start and
 * shorten every duration derived from it, so it is refused.
 */
export async function startProcessing(
  slabId: string,
  opts: { locationId?: string | null; designId?: string | null } = {},
): Promise<ActionResult> {
  const user = await actor("production");
  if (!user) return fail("You are not allowed to record Chromia production.");

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, status: true, currentStage: true, currentCycleNumber: true },
  });
  if (!slab) return fail("That slab does not exist.");
  if (slab.status === "OUT_FOR_RECALIBRATION") {
    return fail("This slab is out for recalibration — receive it back first.");
  }
  if (slab.status === "IN_PROCESS") return fail("This slab is already in processing.");

  const cycleNumber = slab.currentCycleNumber;

  await prisma.$transaction(async (tx) => {
    const cycle = await tx.chromiaProcessCycle.upsert({
      where: { slabId_cycleNumber: { slabId, cycleNumber } },
      create: {
        slabId, cycleNumber, status: "ACTIVE", inTime: new Date(),
        designId: opts.designId ?? null, createdById: user.id,
      },
      update: { inTime: new Date(), status: "ACTIVE", ...(opts.designId ? { designId: opts.designId } : {}) },
    });

    // The first production stage. Stage records are created as the slab reaches
    // them rather than all ten up front, so an unstarted stage is absent rather
    // than PENDING-and-indistinguishable-from-skipped.
    const firstStage: ProcessStage = "BASE_PRIMER";
    await tx.chromiaStageRecord.upsert({
      where: { cycleId_stage: { cycleId: cycle.id, stage: firstStage } },
      create: {
        cycleId: cycle.id, slabId, stage: firstStage, sequence: stageSequence(firstStage),
        status: "IN_PROGRESS", startedAt: new Date(), operatorId: user.id,
        locationId: opts.locationId ?? null,
      },
      update: { status: "IN_PROGRESS", startedAt: new Date(), operatorId: user.id },
    });

    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: {
        status: "IN_PROCESS", currentStage: firstStage, updatedById: user.id,
        ...(opts.locationId ? { currentLocationId: opts.locationId } : {}),
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId, cycleId: cycle.id, eventType: "STAGE_STARTED", stage: firstStage,
        fromStatus: slab.status, toStatus: "IN_PROCESS", toStage: firstStage,
        userId: user.id, locationId: opts.locationId ?? null,
        note: `Processing started (cycle ${cycleNumber})`,
      },
    });
  });

  return done("Slab stamped in.", FLOOR_PATHS);
}

/**
 * Move a slab to the next stage.
 *
 * `canAdvance` allows exactly one step forward. That is the rule the Excel
 * register could not enforce: an operator tapping the stage they are standing
 * at rather than the one that follows loses the record that the stages between
 * ever happened, and a slab that never recorded Printing cannot be traced to
 * the design that was printed on it.
 */
export async function advanceStage(
  slabId: string,
  target: ProcessStage,
  opts: { machineId?: string | null; locationId?: string | null; notes?: string } = {},
): Promise<ActionResult> {
  const user = await actor("production");
  if (!user) return fail("You are not allowed to record Chromia production.");
  if (!STAGE_ORDER.includes(target)) return fail("That is not a Chromia stage.");

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, status: true, currentStage: true, currentCycleNumber: true },
  });
  if (!slab) return fail("That slab does not exist.");
  if (slab.status !== "IN_PROCESS") {
    return fail("This slab is not in processing — stamp it in first.");
  }
  const current = slab.currentStage as ProcessStage | null;
  if (!canAdvance(current, target)) {
    const expected = current ? STAGE_ORDER[STAGE_ORDER.indexOf(current) + 1] : STAGE_ORDER[0];
    return fail(
      expected
        ? `A slab at ${current ?? "the start"} goes to ${expected} next, not ${target}.`
        : "This slab has finished the line.",
    );
  }

  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { slabId_cycleNumber: { slabId, cycleNumber: slab.currentCycleNumber } },
    select: { id: true },
  });
  if (!cycle) return fail("This slab has no open cycle — stamp it in first.");

  const at = new Date();

  await prisma.$transaction(async (tx) => {
    // Close the stage being left, so its true duration is known.
    if (current) {
      const open = await tx.chromiaStageRecord.findUnique({
        where: { cycleId_stage: { cycleId: cycle.id, stage: current } },
        select: { id: true, startedAt: true },
      });
      if (open) {
        await tx.chromiaStageRecord.update({
          where: { id: open.id },
          data: {
            status: "COMPLETED", endedAt: at,
            durationMinutes: open.startedAt
              ? Math.max(0, Math.round((at.getTime() - open.startedAt.getTime()) / 60_000))
              : null,
          },
        });
        await tx.chromiaSlabEvent.create({
          data: {
            slabId, cycleId: cycle.id, eventType: "STAGE_COMPLETED", stage: current,
            userId: user.id, occurredAt: at,
          },
        });
      }
    }

    await tx.chromiaStageRecord.upsert({
      where: { cycleId_stage: { cycleId: cycle.id, stage: target } },
      create: {
        cycleId: cycle.id, slabId, stage: target, sequence: stageSequence(target),
        status: "IN_PROGRESS", startedAt: at, operatorId: user.id,
        machineId: opts.machineId ?? null, locationId: opts.locationId ?? null,
        notes: opts.notes ?? null,
      },
      update: { status: "IN_PROGRESS", startedAt: at, operatorId: user.id },
    });

    // QUALITY_CHECK is where the slab leaves the operator's hands, so the
    // status changes with it rather than waiting for a separate action nobody
    // would remember to perform.
    const toStatus = target === "QUALITY_CHECK" ? "UNDER_INSPECTION" : "IN_PROCESS";

    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: {
        currentStage: target, status: toStatus, updatedById: user.id,
        ...(opts.locationId ? { currentLocationId: opts.locationId } : {}),
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId, cycleId: cycle.id, eventType: "STAGE_STARTED", stage: target,
        fromStage: current, toStage: target,
        fromStatus: slab.status, toStatus,
        userId: user.id, locationId: opts.locationId ?? null,
        note: opts.notes || null, occurredAt: at,
      },
    });
  });

  return done(`Moved to ${target.replace(/_/g, " ").toLowerCase()}.`, FLOOR_PATHS);
}

/**
 * Stamp a slab OUT — the end of the processing window — and send it to QC.
 *
 * `processingMinutes` returns null rather than a negative when the out-time
 * precedes the in-time, so a mistyped stamp leaves the duration blank instead
 * of poisoning every average on the Summary screen.
 */
export async function finishProcessing(
  slabId: string,
  opts: {
    printResult?: "FULLY_PRINTED" | "HALF_PRINT" | "BYPASSED" | null;
    fullyPrintedDate?: Date | null;
    locationId?: string | null;
  } = {},
): Promise<ActionResult> {
  const user = await actor("production");
  if (!user) return fail("You are not allowed to record Chromia production.");

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, status: true, currentStage: true, currentCycleNumber: true },
  });
  if (!slab) return fail("That slab does not exist.");
  if (slab.status !== "IN_PROCESS") return fail("This slab is not in processing.");

  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { slabId_cycleNumber: { slabId, cycleNumber: slab.currentCycleNumber } },
    select: { id: true, inTime: true },
  });
  if (!cycle) return fail("This slab has no open cycle.");

  const at = new Date();
  const mins = processingMinutes(cycle.inTime, at);

  await prisma.$transaction(async (tx) => {
    if (slab.currentStage) {
      await tx.chromiaStageRecord.updateMany({
        where: { cycleId: cycle.id, stage: slab.currentStage, status: "IN_PROGRESS" },
        data: { status: "COMPLETED", endedAt: at },
      });
    }

    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id },
      data: {
        outTime: at, processingMinutes: mins,
        printResult: opts.printResult ?? undefined,
        fullyPrintedDate: opts.fullyPrintedDate ?? undefined,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: {
        status: "UNDER_INSPECTION", currentStage: "QUALITY_CHECK", updatedById: user.id,
        ...(opts.locationId ? { currentLocationId: opts.locationId } : {}),
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId, cycleId: cycle.id, eventType: "STAGE_COMPLETED",
        fromStage: slab.currentStage, toStage: "QUALITY_CHECK",
        fromStatus: "IN_PROCESS", toStatus: "UNDER_INSPECTION",
        userId: user.id, occurredAt: at,
        note: mins == null
          ? "Stamped out (duration not derivable — check the in-time)"
          : `Stamped out after ${mins} min`,
      },
    });
  });

  return done("Slab stamped out and sent to QC.", FLOOR_PATHS);
}

// ---------------------------------------------------------------------------
// Quality and grading
// ---------------------------------------------------------------------------

/**
 * Record the QC verdict and the grade in one step.
 *
 * They are one decision on the floor — an inspector who has decided a slab is
 * grade C has already decided it failed — and splitting them into two screens
 * produced slabs sitting graded-but-unverdicted in the module's own testing.
 */
export async function recordQc(
  slabId: string,
  input: { verdict: "PASS" | "CONDITIONAL_PASS" | "FAIL"; grade: SlabGrade; notes?: string },
): Promise<ActionResult> {
  const user = await actor("quality");
  if (!user) return fail("You are not allowed to sign Chromia quality checks.");

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, status: true, currentCycleNumber: true },
  });
  if (!slab) return fail("That slab does not exist.");
  if (slab.status !== "UNDER_INSPECTION") {
    return fail("This slab is not waiting for QC.");
  }

  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { slabId_cycleNumber: { slabId, cycleNumber: slab.currentCycleNumber } },
    select: { id: true },
  });
  if (!cycle) return fail("This slab has no cycle to record against.");

  const at = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.chromiaQcRecord.upsert({
      where: { cycleId: cycle.id },
      create: {
        cycleId: cycle.id, slabId, verdict: input.verdict,
        inspectedAt: at, inspectorId: user.id, remarks: input.notes ?? null,
      },
      update: { verdict: input.verdict, inspectedAt: at, inspectorId: user.id, remarks: input.notes ?? null },
    });

    // No ChromiaGradeDecision row yet, deliberately. That model requires a
    // disposition — it is the record of "grade X, therefore do Y" — and the
    // therefore is not known until someone decides it. Writing one here with a
    // placeholder disposition would put a decision in the audit trail that
    // nobody made. It is created by recordDisposition and by
    // sendForRecalibration, each of which knows both halves.
    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id }, data: { finalGrade: input.grade },
    });

    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: {
        status: "GRADED", currentStage: "GRADE_DECISION",
        currentGrade: input.grade, updatedById: user.id,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId, cycleId: cycle.id, eventType: "GRADE_ASSIGNED",
        fromStatus: "UNDER_INSPECTION", toStatus: "GRADED",
        userId: user.id, occurredAt: at,
        note: `QC ${input.verdict}, grade ${input.grade}` + (input.notes ? ` — ${input.notes}` : ""),
        payload: { verdict: input.verdict, grade: input.grade },
      },
    });
  });

  return done(`Graded ${input.grade}.`, FLOOR_PATHS);
}

/**
 * Record what happens to a graded slab.
 *
 * The grade decides the options (CHROMIA_PROCESS.md section 6) and that is
 * enforced HERE, not in the form: a server action is a POST endpoint, so a
 * disabled option in the browser is a hint, not a rule. A grade C slab reaching
 * DISPATCH would put a rejected surface in front of a customer.
 */
export async function recordDisposition(
  slabId: string,
  disposition: Disposition,
  opts: { notes?: string; locationId?: string | null } = {},
): Promise<ActionResult> {
  const user = await actor("store");
  if (!user) return fail("You are not allowed to record Chromia dispositions.");

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, status: true, currentGrade: true, currentCycleNumber: true },
  });
  if (!slab) return fail("That slab does not exist.");
  if (slab.status !== "GRADED") return fail("Grade the slab before deciding what happens to it.");
  if (!slab.currentGrade) return fail("This slab has no grade recorded.");

  const grade = slab.currentGrade as SlabGrade;
  if (!dispositionAllowed(grade, disposition)) {
    return fail(`A grade ${grade} slab cannot go to ${disposition.replace(/_/g, " ").toLowerCase()}.`);
  }
  // RECALIBRATION is a disposition, but it is raised through
  // sendForRecalibration so the attempt ceiling and the outward paperwork are
  // never bypassed by choosing it here.
  if (disposition === "RECALIBRATION") {
    return fail("Send the slab for recalibration from the Recalibration screen.");
  }

  const nextStatus = {
    DISPATCH: "DISPATCHED", STOCK: "IN_STOCK", SAMPLE_CUTTING: "SAMPLE_CUT",
    WASTE: "WASTE", RECALIBRATION: "OUT_FOR_RECALIBRATION",
  }[disposition] as "DISPATCHED" | "IN_STOCK" | "SAMPLE_CUT" | "WASTE";

  const eventType = {
    DISPATCH: "DISPATCHED", STOCK: "STOCKED", SAMPLE_CUTTING: "SAMPLE_CUT",
    WASTE: "DECLARED_WASTE", RECALIBRATION: "RECALIBRATION_SENT",
  }[disposition] as "DISPATCHED" | "STOCKED" | "SAMPLE_CUT" | "DECLARED_WASTE";

  const at = new Date();

  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { slabId_cycleNumber: { slabId, cycleNumber: slab.currentCycleNumber } },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    if (cycle) {
      // The grade decision proper: grade AND what follows from it, which is
      // what makes the row meaningful and why it is written here rather than at
      // QC time. attemptNumberAtDecision records which pass this verdict
      // belongs to, so a slab graded C then A reads correctly in history.
      await tx.chromiaGradeDecision.upsert({
        where: { cycleId: cycle.id },
        create: {
          cycleId: cycle.id, slabId, grade, disposition, decidedAt: at,
          decidedById: user.id, remarks: opts.notes ?? null,
          attemptNumberAtDecision: slab.currentCycleNumber,
          targetLocationId: opts.locationId ?? null,
        },
        update: {
          grade, disposition, decidedAt: at, decidedById: user.id,
          remarks: opts.notes ?? null,
        },
      });
    }

    await tx.chromiaProcessCycle.updateMany({
      where: { slabId, cycleNumber: slab.currentCycleNumber },
      data: { disposition, status: "COMPLETED", completedAt: at },
    });

    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: {
        status: nextStatus, currentDisposition: disposition, updatedById: user.id,
        ...(opts.locationId ? { currentLocationId: opts.locationId } : {}),
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId, eventType, fromStatus: "GRADED", toStatus: nextStatus,
        userId: user.id, occurredAt: at, note: opts.notes || null,
        locationId: opts.locationId ?? null,
      },
    });
  });

  return done("Recorded.", FLOOR_PATHS);
}

// ---------------------------------------------------------------------------
// Recalibration — send, receive, restart
// ---------------------------------------------------------------------------

/**
 * Send a failed slab out for recalibration.
 *
 * The attempt ceiling is checked against the slab's own counter rather than a
 * count of rows, and the counter is incremented inside the same transaction, so
 * two supervisors raising a send at once cannot both read "four so far" and
 * produce a sixth attempt between them.
 */
export async function sendForRecalibration(
  slabId: string,
  input: {
    reasonId?: string | null;
    reasonNotes?: string;
    facilityName?: string;
    expectedReturnDate?: Date | null;
    gatePassNo?: string;
    transporter?: string;
    vehicleNo?: string;
    thicknessBeforeMm?: number | null;
  },
): Promise<ActionResult> {
  const user = await actor("management");
  if (!user) return fail("Only a supervisor or above can send a slab for recalibration.");

  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true, status: true, currentGrade: true, currentCycleNumber: true,
      recalibrationCount: true, isRecalibrationOut: true, currentThicknessMm: true,
    },
  });
  if (!slab) return fail("That slab does not exist.");

  const eligibility = recalibrationEligibility(slab.recalibrationCount, {
    alreadyOut: slab.isRecalibrationOut,
  });
  if (!eligibility.allowed) return fail(eligibility.reason ?? "Not eligible.");

  if (slab.currentGrade && !dispositionAllowed(slab.currentGrade as SlabGrade, "RECALIBRATION")) {
    return fail(`A grade ${slab.currentGrade} slab is not recalibrated.`);
  }

  const cycle = await prisma.chromiaProcessCycle.findUnique({
    where: { slabId_cycleNumber: { slabId, cycleNumber: slab.currentCycleNumber } },
    select: { id: true },
  });

  const at = new Date();

  await prisma.$transaction(async (tx) => {
    const recal = await tx.chromiaRecalibrationCycle.create({
      data: {
        slabId, attemptNumber: eligibility.attemptNumber, status: "SENT",
        failedCycleId: cycle?.id ?? null,
        reasonId: input.reasonId ?? null,
        reasonNotes: input.reasonNotes ?? null,
        sentDate: at,
        expectedReturnDate: input.expectedReturnDate ?? null,
        facilityName: input.facilityName ?? null,
        gatePassNo: input.gatePassNo ?? null,
        transporter: input.transporter ?? null,
        vehicleNo: input.vehicleNo ?? null,
        thicknessBeforeMm: input.thicknessBeforeMm ?? slab.currentThicknessMm ?? null,
        issuedById: user.id, createdById: user.id,
      },
    });

    if (cycle) {
      await tx.chromiaProcessCycle.update({
        where: { id: cycle.id },
        data: { status: "ABORTED", disposition: "RECALIBRATION", completedAt: at },
      });
      // The same grade-decision record the other outcomes write, so a
      // recalibrated slab is not the one disposition missing from the grade
      // analysis that explains WHY the line recalibrates.
      if (slab.currentGrade) {
        await tx.chromiaGradeDecision.upsert({
          where: { cycleId: cycle.id },
          create: {
            cycleId: cycle.id, slabId, grade: slab.currentGrade,
            disposition: "RECALIBRATION", decidedAt: at, decidedById: user.id,
            reason: input.reasonNotes ?? null,
            attemptNumberAtDecision: slab.currentCycleNumber,
          },
          update: {
            disposition: "RECALIBRATION", decidedAt: at, decidedById: user.id,
            reason: input.reasonNotes ?? null,
          },
        });
      }
    }

    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: {
        status: "OUT_FOR_RECALIBRATION", isRecalibrationOut: true,
        recalibrationCount: { increment: 1 },
        currentDisposition: "RECALIBRATION", currentStage: null,
        updatedById: user.id,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId, cycleId: cycle?.id ?? null, eventType: "RECALIBRATION_SENT",
        fromStatus: slab.status, toStatus: "OUT_FOR_RECALIBRATION",
        userId: user.id, occurredAt: at,
        note: `Attempt ${eligibility.attemptNumber} of ${eligibility.attemptNumber + eligibility.remaining - 1}`
          + (input.facilityName ? ` — ${input.facilityName}` : ""),
        payload: { recalibrationId: recal.id, attemptNumber: eligibility.attemptNumber },
      },
    });
  });

  const left = eligibility.remaining - 1;
  return done(
    left > 0
      ? `Sent. ${left} recalibration${left === 1 ? "" : "s"} left on this slab.`
      : "Sent — this was the last recalibration this slab can have.",
    RECAL_PATHS,
  );
}

/** Record a slab coming back. Status becomes RECEIVED_FROM_RECALIBRATION, not
 *  IN_PROCESS: it is physically back but has not re-entered the line, and
 *  conflating the two is how the register lost track of slabs in the yard. */
export async function receiveFromRecalibration(
  recalibrationId: string,
  input: {
    conditionOnReturn?: string;
    workAccepted?: boolean;
    thicknessAfterMm?: number | null;
    notes?: string;
  } = {},
): Promise<ActionResult> {
  const user = await actor("management");
  if (!user) return fail("Only a supervisor or above can receive a recalibration.");

  const recal = await prisma.chromiaRecalibrationCycle.findUnique({
    where: { id: recalibrationId },
    select: {
      id: true, slabId: true, sentDate: true, receivedDate: true, status: true,
      thicknessBeforeMm: true, attemptNumber: true,
    },
  });
  if (!recal) return fail("That recalibration does not exist.");
  if (recal.receivedDate) return fail("This one is already recorded as received.");

  const at = new Date();
  const before = recal.thicknessBeforeMm == null ? null : Number(recal.thicknessBeforeMm);
  const after = input.thicknessAfterMm ?? null;
  const removed = thicknessRemoved(before, after);
  const turnaround = recal.sentDate
    ? Math.max(0, Math.floor((at.getTime() - recal.sentDate.getTime()) / 86_400_000))
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaRecalibrationCycle.update({
      where: { id: recal.id },
      data: {
        status: "RECEIVED", receivedDate: at, turnaroundDays: turnaround,
        conditionOnReturn: input.conditionOnReturn ?? null,
        workAccepted: input.workAccepted ?? null,
        thicknessAfterMm: after, materialRemovedMm: removed,
        notes: input.notes ?? null, receivedById: user.id,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: recal.slabId },
      data: {
        status: "RECEIVED_FROM_RECALIBRATION", isRecalibrationOut: false,
        updatedById: user.id,
        ...(after == null ? {} : { currentThicknessMm: after }),
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: recal.slabId, eventType: "RECALIBRATION_RECEIVED",
        fromStatus: "OUT_FOR_RECALIBRATION", toStatus: "RECEIVED_FROM_RECALIBRATION",
        userId: user.id, occurredAt: at,
        note: `Back after ${turnaround ?? "?"} day(s)`
          + (removed == null ? "" : `, ${removed}mm removed`),
        payload: { recalibrationId: recal.id, turnaroundDays: turnaround },
      },
    });
  });

  return done("Recorded as received.", RECAL_PATHS);
}

/**
 * Put a returned slab back on the line as a new cycle.
 *
 * A new ChromiaProcessCycle rather than reopening the old one: cycle 1's
 * timings, design, QC verdict and grade are the record of what happened the
 * first time, and overwriting them is exactly the loss the Excel register
 * suffered when a second recalibration went into the same row.
 */
export async function restartAfterRecalibration(
  recalibrationId: string,
  opts: { designId?: string | null } = {},
): Promise<ActionResult> {
  const user = await actor("management");
  if (!user) return fail("Only a supervisor or above can restart a slab.");

  const recal = await prisma.chromiaRecalibrationCycle.findUnique({
    where: { id: recalibrationId },
    select: { id: true, slabId: true, receivedDate: true, restartedCycleId: true },
  });
  if (!recal) return fail("That recalibration does not exist.");
  if (!recal.receivedDate) return fail("Receive the slab back before restarting it.");
  if (recal.restartedCycleId) return fail("This slab has already been restarted.");

  const slab = await prisma.chromiaSlab.findUnique({
    where: { id: recal.slabId },
    select: { id: true, status: true, currentCycleNumber: true },
  });
  if (!slab) return fail("That slab does not exist.");

  const nextCycle = slab.currentCycleNumber + 1;
  const at = new Date();

  await prisma.$transaction(async (tx) => {
    const cycle = await tx.chromiaProcessCycle.create({
      data: {
        slabId: slab.id, cycleNumber: nextCycle, status: "ACTIVE",
        designId: opts.designId ?? null, createdById: user.id,
      },
    });

    await tx.chromiaRecalibrationCycle.update({
      where: { id: recal.id },
      data: { status: "RESTARTED", restartedCycleId: cycle.id, restartedAt: at },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        currentCycleNumber: nextCycle, status: "RECEIVED",
        currentStage: null, currentGrade: null, currentDisposition: null,
        updatedById: user.id,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id, cycleId: cycle.id, eventType: "RECALIBRATION_RESTARTED",
        fromStatus: "RECEIVED_FROM_RECALIBRATION", toStatus: "RECEIVED",
        userId: user.id, occurredAt: at,
        note: `Restarted as cycle ${nextCycle}`,
        payload: { recalibrationId: recal.id, cycleNumber: nextCycle },
      },
    });
  });

  return done(`Back on the line as cycle ${nextCycle}.`, RECAL_PATHS);
}
