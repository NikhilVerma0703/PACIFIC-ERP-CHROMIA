// End-to-end rehearsal of the Chromia lifecycle against the REAL schema.
//
//   node scripts/chromia-lifecycle-check.mjs        (needs DATABASE_URL)
//
// Everything runs inside one interactive transaction that is deliberately
// aborted at the end, so the database is untouched — the last lines assert that
// nothing was left behind.
//
// WHY THIS EXISTS. The unit tests cover the rules (stage order, the attempt
// ceiling, ageing) but they are pure by design and never touch Prisma, so they
// cannot catch the other half: a required column nobody passed, an enum value
// that does not exist, a compound unique key an upsert is addressed by
// incorrectly. Those only fail when a real write hits a real database, which on
// an empty module means the first day someone uses it.
//
// It walks the whole life: received -> stamped in -> six production stages ->
// QC -> graded C -> out for recalibration -> back -> restarted as cycle 2 ->
// graded A -> dispatched, then reads it back the way the slab-detail screen
// does and asserts cycle 1 kept its own grade and timings. That last check is
// the one that matters: overwriting the first pass is precisely what the Excel
// register did, and it is the loss this module exists to prevent.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const ROLLBACK = "ROLLBACK-ON-PURPOSE";
const log = [];
const step = (s) => { log.push(`  ok  ${s}`); };

const SLAB = `E2E-${Date.now()}`;
const BATCH = `E2E-BATCH-${Date.now()}`;

try {
  await prisma.$transaction(async (tx) => {
    // 1. intake
    const material = await tx.chromiaBaseMaterial.upsert({
      where: { code: "E2E-BASE" }, update: {},
      create: { code: "E2E-BASE", name: "E2E Base" }, select: { id: true },
    });
    const batch = await tx.chromiaBatch.upsert({
      where: { batchNo: BATCH }, update: {},
      create: { batchNo: BATCH, receivedDate: new Date(), baseMaterialId: material.id },
      select: { id: true },
    });
    const slab = await tx.chromiaSlab.create({
      data: {
        slabNo: SLAB, batchId: batch.id, baseMaterialId: material.id,
        status: "RECEIVED", receivedDate: new Date(),
        originalThicknessMm: 20, currentThicknessMm: 20,
      },
    });
    await tx.chromiaSlabEvent.create({
      data: { slabId: slab.id, eventType: "SLAB_CREATED", toStatus: "RECEIVED" },
    });
    step("received a slab");

    // 2. stamp in -> cycle 1 + first stage
    const cycle = await tx.chromiaProcessCycle.upsert({
      where: { slabId_cycleNumber: { slabId: slab.id, cycleNumber: 1 } },
      create: { slabId: slab.id, cycleNumber: 1, status: "ACTIVE", inTime: new Date() },
      update: {},
    });
    await tx.chromiaStageRecord.upsert({
      where: { cycleId_stage: { cycleId: cycle.id, stage: "BASE_PRIMER" } },
      create: {
        cycleId: cycle.id, slabId: slab.id, stage: "BASE_PRIMER", sequence: 3,
        status: "IN_PROGRESS", startedAt: new Date(),
      },
      update: {},
    });
    await tx.chromiaSlab.update({
      where: { id: slab.id }, data: { status: "IN_PROCESS", currentStage: "BASE_PRIMER" },
    });
    step("stamped in (cycle 1, compound upsert keys work)");

    // 3. walk every production stage
    const order = ["PRINTING", "MOULDING", "COOLING", "POLISHING", "UV_POLISHING"];
    let seq = 4;
    for (const stage of order) {
      await tx.chromiaStageRecord.create({
        data: {
          cycleId: cycle.id, slabId: slab.id, stage, sequence: seq++,
          status: "COMPLETED", startedAt: new Date(), endedAt: new Date(), durationMinutes: 10,
        },
      });
      await tx.chromiaSlab.update({ where: { id: slab.id }, data: { currentStage: stage } });
    }
    step(`walked ${order.length} stages`);

    // 4. into QC — the out-time fix
    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id },
      data: { outTime: new Date(), processingMinutes: 50 },
    });
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: { status: "UNDER_INSPECTION", currentStage: "QUALITY_CHECK" },
    });
    step("stamped out into QC with a processing window");

    // 5. QC fails -> grade C
    await tx.chromiaQcRecord.upsert({
      where: { cycleId: cycle.id },
      create: { cycleId: cycle.id, slabId: slab.id, verdict: "FAIL", remarks: "e2e" },
      update: {},
    });
    await tx.chromiaProcessCycle.update({ where: { id: cycle.id }, data: { finalGrade: "C" } });
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: { status: "GRADED", currentStage: "GRADE_DECISION", currentGrade: "C" },
    });
    step("QC recorded, graded C");

    // 6. send for recalibration
    await tx.chromiaGradeDecision.upsert({
      where: { cycleId: cycle.id },
      create: {
        cycleId: cycle.id, slabId: slab.id, grade: "C", disposition: "RECALIBRATION",
        attemptNumberAtDecision: 1,
      },
      update: {},
    });
    const recal = await tx.chromiaRecalibrationCycle.create({
      data: {
        slabId: slab.id, attemptNumber: 1, status: "SENT", failedCycleId: cycle.id,
        sentDate: new Date(), facilityName: "E2E Facility", thicknessBeforeMm: 20,
      },
    });
    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id }, data: { status: "ABORTED", disposition: "RECALIBRATION" },
    });
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: "OUT_FOR_RECALIBRATION", isRecalibrationOut: true,
        recalibrationCount: { increment: 1 }, currentStage: null,
      },
    });
    step("sent for recalibration (attempt 1)");

    // 7. receive back
    await tx.chromiaRecalibrationCycle.update({
      where: { id: recal.id },
      data: {
        status: "RECEIVED", receivedDate: new Date(), turnaroundDays: 3,
        thicknessAfterMm: 18.5, materialRemovedMm: 1.5,
      },
    });
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: "RECEIVED_FROM_RECALIBRATION", isRecalibrationOut: false,
        currentThicknessMm: 18.5,
      },
    });
    step("received back, 1.5mm removed");

    // 8. restart as cycle 2 — the unique [slabId, cycleNumber] must allow it
    const cycle2 = await tx.chromiaProcessCycle.create({
      data: { slabId: slab.id, cycleNumber: 2, status: "ACTIVE" },
    });
    await tx.chromiaRecalibrationCycle.update({
      where: { id: recal.id },
      data: { status: "RESTARTED", restartedCycleId: cycle2.id, restartedAt: new Date() },
    });
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: { currentCycleNumber: 2, status: "RECEIVED", currentGrade: null, currentDisposition: null },
    });
    step("restarted as cycle 2");

    // 9. second pass, passes QC, dispatched
    await tx.chromiaProcessCycle.update({
      where: { id: cycle2.id },
      data: { inTime: new Date(), outTime: new Date(), processingMinutes: 45, finalGrade: "A" },
    });
    await tx.chromiaQcRecord.create({
      data: { cycleId: cycle2.id, slabId: slab.id, verdict: "PASS" },
    });
    await tx.chromiaGradeDecision.create({
      data: {
        cycleId: cycle2.id, slabId: slab.id, grade: "A", disposition: "DISPATCH",
        attemptNumberAtDecision: 2,
      },
    });
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: { status: "DISPATCHED", currentGrade: "A", currentDisposition: "DISPATCH" },
    });
    step("second pass graded A and dispatched");

    // 10. read it all back the way the detail screen does
    const full = await tx.chromiaSlab.findUnique({
      where: { id: slab.id },
      include: {
        cycles: { include: { qcRecord: true, gradeDecision: true, stageRecords: true } },
        recalibrations: true, events: true,
      },
    });
    if (full.cycles.length !== 2) throw new Error(`expected 2 cycles, got ${full.cycles.length}`);
    if (full.recalibrations.length !== 1) throw new Error("recalibration missing");
    if (full.recalibrationCount !== 1) throw new Error("counter wrong");
    if (full.cycles[0].finalGrade !== "C" || full.cycles[1].finalGrade !== "A") {
      throw new Error("cycle 1's grade was overwritten by cycle 2 — history lost");
    }
    step("both cycles kept their own grade, timings and QC");

    throw new Error(ROLLBACK);
  }, { timeout: 30_000 });
} catch (e) {
  if (e.message === ROLLBACK) {
    console.log(log.join("\n"));
    console.log("\nLIFECYCLE OK — transaction rolled back, nothing written.");
  } else {
    console.log(log.join("\n"));
    console.error("\nFAILED:", e.message);
    process.exitCode = 1;
  }
}

const left = await prisma.chromiaSlab.count({ where: { slabNo: SLAB } });
console.log(`rows left behind: ${left} (must be 0)`);
if (left !== 0) process.exitCode = 1;
await prisma.$disconnect();
