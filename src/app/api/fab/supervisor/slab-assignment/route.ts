// The write side of the slab-first assignment board.
//
//   POST   { action: "add-slab", projectId, pacificQcId }   put a QC slab on the board
//   POST   { action: "assign", slabId, requirementId, allocatedQuantity }
//   PATCH  { allocationId, allocatedQuantity }              change one allocation
//   DELETE ?allocationId=...                                take a row off a slab
//   DELETE ?slabId=...                                      take an empty slab off the board
//
// THE LEDGER IS fab_requirement_allocation AND NOTHING ELSE. Every number the
// board shows is derived from those rows; there is no second tally to keep in
// step, and "how much of this row is still unassigned" is computed, never
// stored.
//
// WHY THIS IS NOT allocate-requirement. That route is the requirement-first
// board's: its POST defaults to REPLACING every allocation a requirement has,
// which is the right verb when you are standing on a requirement handing it a
// slab and the wrong one when you are standing on a slab collecting rows. It
// also has no over-allocation check at all. It is left exactly as it is.
//
// ─────────────────────────────────────────────────────────────────────────────
// OVER-ALLOCATION, AND WHERE THE TRANSACTION BOUNDARY SITS
//
// The rule: sum(allocated_quantity) across slabs must never exceed
// fab_requirement.quantity. Checking it in the browser is not enough — two
// supervisors on two tablets is a normal Tuesday here, and both would read
// "4 remaining", both would add 4, and both would be right at the moment they
// looked.
//
// So every write that can increase a requirement's allocated total runs inside
// prisma.$transaction, and the FIRST statement in that transaction is
//
//     SELECT id FROM fab_requirement WHERE id = ? FOR UPDATE
//
// which takes a row lock on the requirement. Postgres runs Prisma's interactive
// transactions at READ COMMITTED, where two concurrent transactions happily read
// the same allocation set and both insert: the count is not a constraint, so
// nothing stops them. The row lock is what serialises them — the second
// transaction blocks on the SELECT until the first commits, then re-reads the
// allocations and sees the row that was just written. It is the same shape as
// the import latch in /api/fab/manager/pos/import, for the same reason.
//
// The boundary is therefore: lock the requirement → re-read its allocations →
// decide → write → commit. Nothing between the read and the write can be
// observed by another writer, and the decision function (decideAllocation) is
// pure and shared with the screen, so the button and the server cannot drift.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { decideAllocation } from "@/lib/fab/slabAssignment";
import { describeRequirement } from "@/lib/fab/releasePlan";
import { STANDARD_SLAB_MM } from "@/lib/fab/slabLoss";
import { markQcSlabCts } from "@/lib/fab/markQcSlabCts";
import { parseThicknessMm } from "@/lib/fab/qcSlabQuery";

/** A slab in any of these states has left the board. Its rows are the cutter's
 *  instructions now, and changing them behind him is how a piece gets cut off
 *  the wrong stone. */
const SENT_STATUSES = ["READY", "IN_PROGRESS", "COMPLETED"] as const;

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}

/** How the requirement is named in a refusal the supervisor has to act on. */
type NameableRequirement = {
  pieceLabel: string | null;
  description: string | null;
  po: { poNumber: string } | null;
  drawing: { drawingNumber: string } | null;
};
function labelOf(r: NameableRequirement): string {
  return describeRequirement({
    drawingNumber: r.drawing?.drawingNumber,
    poNumber: r.po?.poNumber,
    pieceLabel: r.pieceLabel,
    description: r.description,
  });
}

const REQUIREMENT_SELECT = {
  id: true,
  projectId: true,
  quantity: true,
  pieceLabel: true,
  description: true,
  po: { select: { poNumber: true } },
  drawing: { select: { drawingNumber: true } },
} as const;

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return deny(g.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const action = String(body.action ?? "assign");
  if (action === "add-slab") return addSlab(body);
  if (action === "assign") return assign(body);
  return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
}

/* -- Putting a slab on the board ------------------------------------------- */

/**
 * Import the picked QC slab into this project as a fab_slab, or find the one
 * that is already there.
 *
 * SCOPED TO THE PROJECT, deliberately — the same lesson as
 * allocate-requirement: an unscoped lookup returns the fab_slab a DIFFERENT
 * project imported for this physical slab, and the board then writes its
 * allocations against another project's slab, where this project cannot see
 * them. That is indistinguishable from "my assignment did not save".
 *
 * DIMENSIONS. The standard Pacific slab, 137 x 79 inches, written in
 * millimetres — the same numbers /api/fab/assign-qc-slab stamps when it attaches
 * a QC slab, and the same ones /api/fab/slab-allocation measures wastage
 * against. They matter here because computeSlabLoss divides by them: a slab
 * carrying the 3200 x 1600 placeholder reads as 55.11 sqft instead of 75.16,
 * which turns a slab that is 80% used into one that is over-committed.
 */
async function addSlab(body: Record<string, unknown>) {
  const projectId = String(body.projectId ?? "").trim();
  const pacificQcId = String(body.pacificQcId ?? "").trim();
  if (!projectId || !pacificQcId) {
    return Response.json({ error: "projectId and pacificQcId are both required." }, { status: 400 });
  }

  const project = await prisma.fabProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) {
    return Response.json({ error: "That project no longer exists — refresh and look again." }, { status: 404 });
  }

  const existing = await prisma.fabSlab.findFirst({
    where: { projectId, pacificQcId },
    select: { id: true, slabCode: true },
  });
  if (existing) {
    await markQcSlabCts(pacificQcId);
    return Response.json({ success: true, slabId: existing.id, slabCode: existing.slabCode, created: false });
  }

  const qc = await prisma.polishQc.findUnique({
    where: { id: pacificQcId },
    select: { id: true, slabNumber: true, design: true, slabThickness: true },
  });
  if (!qc) {
    // A slab picked from a list this tab loaded ten minutes ago. A sentence,
    // not a framework 500 the board can only report as "error 500".
    return Response.json(
      { error: "That QC slab could not be found any more — search for it again." },
      { status: 422 },
    );
  }

  const totalArea = STANDARD_SLAB_MM.lengthMm * STANDARD_SLAB_MM.widthMm;
  const slab = await prisma.fabSlab.create({
    data: {
      projectId,
      slabCode: String(qc.slabNumber),
      colour: qc.design,
      pacificQcId: qc.id,
      // slab_thickness is free text typed by the QC inspector ("3 cm", "12mm",
      // "2cm to 8mm"), and ONE function in this codebase knows how to read it:
      // parseThicknessMm, which the QC slab search already uses to find the
      // slab the supervisor is standing on.
      //
      // This used to be `parseFloat(x) * 10`, which is right only if the text
      // is in centimetres. The slab entry screen offers "3cm", "2cm", "12mm"
      // and "7mm" (app/entry/slab/[model]), so a 12 mm slab was stored as
      // 120 mm and a 7 mm one as 70 — a tenfold error on the column the rate
      // card is keyed on (2 cm ₹230 a sink, 3 cm ₹300) and the one the loss
      // maths measures against. It read as a plausible number, which is why it
      // survived: nothing about 120 looks like a bad parse.
      thickness: parseThicknessMm(qc.slabThickness),
      length: STANDARD_SLAB_MM.lengthMm,
      width: STANDARD_SLAB_MM.widthMm,
      totalArea,
      availableArea: totalArea,
    },
    select: { id: true, slabCode: true },
  });
  await markQcSlabCts(qc.id);

  return Response.json({ success: true, slabId: slab.id, slabCode: slab.slabCode, created: true });
}

/* -- Adding a row to a slab ------------------------------------------------ */

async function assign(body: Record<string, unknown>) {
  const slabId = String(body.slabId ?? "").trim();
  const requirementId = String(body.requirementId ?? "").trim();
  const allocatedQuantity = Number(body.allocatedQuantity);
  if (!slabId || !requirementId) {
    return Response.json({ error: "slabId and requirementId are both required." }, { status: 400 });
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // THE LOCK. Everything below re-reads under it; see the header.
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM fab_requirement WHERE id = ${requirementId} FOR UPDATE`;
      if (!locked.length) return { kind: "no-requirement" as const };

      const requirement = await tx.fabRequirement.findUnique({
        where: { id: requirementId },
        select: REQUIREMENT_SELECT,
      });
      if (!requirement) return { kind: "no-requirement" as const };

      const slab = await tx.fabSlab.findUnique({
        where: { id: slabId },
        select: { id: true, slabCode: true, projectId: true },
      });
      if (!slab) return { kind: "no-slab" as const };
      if (slab.projectId !== requirement.projectId) return { kind: "wrong-project" as const };

      const job = await tx.fabSlabJob.findFirst({
        where: { slabId, status: { in: [...SENT_STATUSES] } },
        select: { status: true },
      });
      if (job) return { kind: "sent" as const, slabCode: slab.slabCode, status: job.status };

      const existing = await tx.fabRequirementAllocation.findMany({
        where: { requirementId },
        select: { id: true, allocatedQuantity: true },
      });

      const decision = decideAllocation({
        orderedQuantity: requirement.quantity,
        existing,
        allocationId: null,
        requestedQuantity: allocatedQuantity,
        label: labelOf(requirement),
      });
      if (!decision.ok) return { kind: "refused" as const, error: decision.error, remaining: decision.remaining };

      // The same row twice on one slab is a second allocation, not an error —
      // but it reads as a duplicate on the board, so it is folded into the one
      // that is already there and held to the same total.
      const onThisSlab = await tx.fabRequirementAllocation.findFirst({
        where: { requirementId, slabId },
        select: { id: true, allocatedQuantity: true },
      });

      const allocation = onThisSlab
        ? await tx.fabRequirementAllocation.update({
            where: { id: onThisSlab.id },
            data: { allocatedQuantity: onThisSlab.allocatedQuantity + decision.allocatedQuantity },
            select: { id: true, allocatedQuantity: true },
          })
        : await tx.fabRequirementAllocation.create({
            data: { requirementId, slabId, allocatedQuantity: decision.allocatedQuantity },
            select: { id: true, allocatedQuantity: true },
          });

      await tx.fabRequirement.update({ where: { id: requirementId }, data: { status: "ALLOCATED" } });

      return { kind: "ok" as const, allocation, remaining: decision.remainingAfter };
    });

    return respond(outcome);
  } catch (e) {
    console.error("[slab-assignment] assign failed", { slabId, requirementId, error: e });
    return Response.json(
      { error: "Could not add that row to the slab. Nothing was changed — try again." },
      { status: 500 },
    );
  }
}

/* -- Changing an existing allocation --------------------------------------- */

export async function PATCH(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return deny(g.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const allocationId = String(body.allocationId ?? "").trim();
  const allocatedQuantity = Number(body.allocatedQuantity);
  if (!allocationId) return Response.json({ error: "allocationId required" }, { status: 400 });

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.fabRequirementAllocation.findUnique({
        where: { id: allocationId },
        select: { id: true, requirementId: true, slabId: true },
      });
      if (!row) return { kind: "no-allocation" as const };

      // Lock the REQUIREMENT, not the allocation: the invariant is about the
      // requirement's total across every slab, so that is the row two writers
      // have to queue behind.
      await tx.$queryRaw`SELECT id FROM fab_requirement WHERE id = ${row.requirementId} FOR UPDATE`;

      const requirement = await tx.fabRequirement.findUnique({
        where: { id: row.requirementId },
        select: REQUIREMENT_SELECT,
      });
      if (!requirement) return { kind: "no-requirement" as const };

      const slab = await tx.fabSlab.findUnique({ where: { id: row.slabId }, select: { slabCode: true } });
      const job = await tx.fabSlabJob.findFirst({
        where: { slabId: row.slabId, status: { in: [...SENT_STATUSES] } },
        select: { status: true },
      });
      if (job) return { kind: "sent" as const, slabCode: slab?.slabCode ?? "That slab", status: job.status };

      const existing = await tx.fabRequirementAllocation.findMany({
        where: { requirementId: row.requirementId },
        select: { id: true, allocatedQuantity: true },
      });

      const decision = decideAllocation({
        orderedQuantity: requirement.quantity,
        existing,
        // Excluded from the total: the row being edited must not be counted
        // against itself, or raising 3 to 4 on a full row looks like asking
        // for 7.
        allocationId,
        requestedQuantity: allocatedQuantity,
        label: labelOf(requirement),
      });
      if (!decision.ok) return { kind: "refused" as const, error: decision.error, remaining: decision.remaining };

      const allocation = await tx.fabRequirementAllocation.update({
        where: { id: allocationId },
        data: { allocatedQuantity: decision.allocatedQuantity },
        select: { id: true, allocatedQuantity: true },
      });

      return { kind: "ok" as const, allocation, remaining: decision.remainingAfter };
    });

    return respond(outcome);
  } catch (e) {
    console.error("[slab-assignment] adjust failed", { allocationId, error: e });
    return Response.json(
      { error: "Could not change that quantity. Nothing was saved — try again." },
      { status: 500 },
    );
  }
}

/* -- Taking a row, or an empty slab, off the board -------------------------- */

export async function DELETE(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return deny(g.status);

  const params = req.nextUrl.searchParams;
  const allocationId = params.get("allocationId");
  const slabId = params.get("slabId");

  if (allocationId) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const row = await tx.fabRequirementAllocation.findUnique({
          where: { id: allocationId },
          select: { id: true, requirementId: true, slabId: true },
        });
        // Already gone. Two taps on a slow tablet must not produce an error the
        // supervisor has to think about — the row is off the slab either way.
        if (!row) return { kind: "ok" as const, allocation: null, remaining: null };

        const slab = await tx.fabSlab.findUnique({ where: { id: row.slabId }, select: { slabCode: true } });
        const job = await tx.fabSlabJob.findFirst({
          where: { slabId: row.slabId, status: { in: [...SENT_STATUSES] } },
          select: { status: true },
        });
        if (job) return { kind: "sent" as const, slabCode: slab?.slabCode ?? "That slab", status: job.status };

        await tx.fabRequirementAllocation.delete({ where: { id: allocationId } });

        // Back to PENDING when the last slab is taken off it, so the row shows
        // as outstanding again rather than claiming to be allocated to nothing.
        const left = await tx.fabRequirementAllocation.count({ where: { requirementId: row.requirementId } });
        if (left === 0) {
          await tx.fabRequirement.update({ where: { id: row.requirementId }, data: { status: "PENDING" } });
        }
        return { kind: "ok" as const, allocation: null, remaining: null };
      });

      return respond(outcome);
    } catch (e) {
      console.error("[slab-assignment] remove failed", { allocationId, error: e });
      return Response.json(
        { error: "Could not take that row off the slab. Nothing was changed — try again." },
        { status: 500 },
      );
    }
  }

  if (slabId) {
    // Only an empty, unsent slab leaves the board — this is the undo for
    // picking the wrong slab, not a way to delete work. Anything that already
    // references it (rows, a cut job, released pieces) makes it real.
    const slab = await prisma.fabSlab.findUnique({
      where: { id: slabId },
      select: {
        id: true,
        slabCode: true,
        _count: { select: { requirementAllocations: true, slabJobs: true, pieces: true, allocations: true } },
      },
    });
    if (!slab) return Response.json({ success: true });

    const c = slab._count;
    if (c.requirementAllocations > 0) {
      return Response.json(
        { error: `Slab ${slab.slabCode} still has piece rows on it. Take those off first.` },
        { status: 409 },
      );
    }
    if (c.slabJobs > 0 || c.pieces > 0 || c.allocations > 0) {
      return Response.json(
        { error: `Slab ${slab.slabCode} has already been sent to the cutter, so it cannot be taken off the board.` },
        { status: 409 },
      );
    }

    await prisma.fabSlab.delete({ where: { id: slabId } });
    return Response.json({ success: true });
  }

  return Response.json({ error: "allocationId or slabId required" }, { status: 400 });
}

/* -- One reply shape for every outcome ------------------------------------- */

type Outcome =
  | { kind: "ok"; allocation: { id: string; allocatedQuantity: number } | null; remaining: number | null }
  | { kind: "refused"; error: string; remaining: number }
  | { kind: "sent"; slabCode: string; status: string }
  | { kind: "no-requirement" }
  | { kind: "no-allocation" }
  | { kind: "no-slab" }
  | { kind: "wrong-project" };

function respond(outcome: Outcome): Response {
  switch (outcome.kind) {
    case "ok":
      return Response.json({ success: true, allocation: outcome.allocation, remaining: outcome.remaining });
    case "refused":
      // 409, not 400: the request was well formed and was true when the tablet
      // sent it. Something else got there first, which is exactly what postJson
      // renders as "someone else changed this first" — except here the server
      // says which row and how many are actually left.
      return Response.json({ error: outcome.error, remaining: outcome.remaining }, { status: 409 });
    case "sent":
      return Response.json(
        {
          error:
            `Slab ${outcome.slabCode} has already gone to the cutter (${outcome.status.replace(/_/g, " ").toLowerCase()}), ` +
            `so its rows can no longer be changed. Nothing was saved.`,
        },
        { status: 409 },
      );
    case "no-requirement":
      return Response.json(
        { error: "That piece row no longer exists — refresh the board and look again." },
        { status: 404 },
      );
    case "no-allocation":
      return Response.json(
        { error: "That allocation no longer exists — refresh the board and look again." },
        { status: 404 },
      );
    case "no-slab":
      return Response.json(
        { error: "That slab is no longer on the board — refresh and pick it again." },
        { status: 404 },
      );
    case "wrong-project":
      return Response.json(
        { error: "That slab belongs to a different project. Nothing was saved." },
        { status: 409 },
      );
  }
}
