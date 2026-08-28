// POST /api/fab/approve-slab
// Body: { slabId: string }
// Supervisor sends a slab to the cutter. This is the moment planning becomes
// physical work, and it does three things in one transaction: create the
// fab_piece rows for the slab's allocations with their route sheets, create the
// FabSlabJob (status READY) that puts the slab in the cutting queue, and freeze
// the slab's loss figures onto that job.
//
// WHY THE PIECES ARE CREATED HERE. They used to be created by
// /api/fab/supervisor/release-project, whose only caller was the requirement-first
// PlanningBoard — retired 2026-08. Nothing replaced it, so a slab reached the cut
// queue with no pieces on it and the cutting queue's complete-job handler minted
// them itself, under a SECOND piece-code format
// (`{projectCode}-{label}-{NNN}-{slabSuffix}` against release's
// `{projectCode}-{NNNN}`). That branch is gone; this is now the only place a
// fab_piece is born in the PO flow, and it uses release's format.
//
// It is SLAB-SCOPED, and that is the whole difference from release-project.
// release-project is project-scoped: it flips fab_project.status and refuses
// unless every requirement in the project already has an allocation. On slab 1
// of 5 most requirements legitimately have none yet, so that guard blocks the
// normal case. Here only the rows on THIS slab are released, and the project's
// status moves only when the last of them has gone (see below). release-project
// is left in place and untouched; nothing calls it any more.
//
// THE LOSS FIGURES. fab_slab_job.used_area_sqft, .total_wastage_pct and
// .true_scrap_pct are written here and nowhere else. Sending a slab is the
// moment its contents stop changing — after this the rows are the cutter's
// instructions and the board refuses to change them — so it is the moment the
// figure becomes a fact worth keeping. It is recomputed from the database
// rather than taken from the request, because the number stored must describe
// what is actually allocated, not what a tablet believed a minute ago.
//
// AN OVER-COMMITTED SLAB IS REFUSED, NOT CLAMPED. See decideSendToCutting.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE TRANSACTION BOUNDARY SITS, AND WHAT THE LATCH IS
//
// Everything that reads state and acts on it happens inside one
// prisma.$transaction, whose FIRST statement is
//
//     SELECT id FROM fab_project WHERE id = ? FOR UPDATE
//
// Prisma's interactive transactions run at READ COMMITTED, where a bare
// `count()` is not a guard: two concurrent sends both read "no pieces yet", both
// pass, and both insert. The row lock is what serialises them — the second
// blocks on the SELECT until the first commits, then re-reads and sees the job
// and the pieces that were just written. Same shape as the latch in
// /api/fab/supervisor/slab-assignment.
//
// THE PROJECT ROW, NOT THE SLAB ROW, for two reasons. The piece-code counter is
// per project and shared by every slab under it, so two different slabs of one
// project released at the same moment would both resume from the same number
// and one would die on fab_piece.piece_code's @unique. And a FOR UPDATE on
// fab_slab would deadlock against slab-assignment: that route holds FOR UPDATE
// on a fab_requirement while its allocation insert takes FOR KEY SHARE on
// fab_slab, and this one would hold fab_slab while its fab_piece insert takes
// FOR KEY SHARE on fab_requirement. Locking the project has no such crossing —
// nothing holding a requirement lock ever waits on fab_project.
//
// Order inside the transaction is: latch → is it already sent? → re-read the
// allocations → decide → create the PIECES → create the JOB. Pieces before job,
// deliberately: a slab job with no pieces is the exact state the retired
// auto-create branch existed to paper over, and it must not be reachable even
// for the instant between two statements.

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { fabGate } from "@/lib/fab/access";
import { prisma } from "@/lib/prisma";
import { sampledAreaForSlab } from "@/lib/fab/sampledArea";
import { computeSlabLoss } from "@/lib/fab/slabLoss";
import { assignedPieceCount, decideSendToCutting, slabLossPieces } from "@/lib/fab/slabAssignment";
import {
  describeAlreadyReleasedRows,
  describeRequirement,
  planSlabRelease,
  type PlannedSlabPiece,
  type SlabReleaseRow,
} from "@/lib/fab/releasePlan";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import { planPieceOperations } from "@/lib/fab/pieceOperations";
import { assignRowLetters, formatPieceCode, nextPieceNumberInRow } from "@/lib/fab/pieceNaming";

/** Pieces per write chunk — the same ceiling release-project writes under, so a
 *  freak slab carrying hundreds of rows cannot overrun Postgres' 65,535
 *  bind-parameter limit. One slab is normally a few dozen pieces. */
const PIECE_CHUNK = 500;
const OPERATION_CHUNK = 2000;

const TX_TIMEOUT_MS = 60_000;
const TX_MAX_WAIT_MS = 15_000;

/** Job states that mean this slab has already gone to the cutting floor.
 *
 *  ALL THREE OF THEM. FabSlabProductionStatus has exactly READY, IN_PROGRESS
 *  and COMPLETED, so this is "any job at all" — spelt out rather than dropping
 *  the filter, because the list is what says why the question is being asked.
 *
 *  COMPLETED used to be missing, and the hole it left is not obvious: a slab
 *  whose cutting had FINISHED read as having no job, so a second send sailed
 *  past the idempotency check. It could not double the pieces — piecesAlreadyPresent
 *  stops that — but it created a SECOND fab_slab_job on the same stone, and the
 *  CEO dashboard counts cutting by job. One slab, cut once, counted twice, with
 *  the duplicate carrying no operator and no end time to give it away.
 *
 *  A finished slab that genuinely has to go back to the saw is reverted first
 *  (queues/cutting/revert-job), which returns its job to READY — still caught
 *  here, and by then it is the same job rather than a new one. */
const ACTIVE_JOB_STATUSES = ["READY", "IN_PROGRESS", "COMPLETED"] as const;

export const maxDuration = 60;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { slabId } = await req.json() as { slabId?: string };
  if (!slabId) return Response.json({ error: "slabId required" }, { status: 400 });

  // Read once outside the transaction for the 404 and for the slab's own
  // dimensions, which never change after it is put on the board. Everything
  // that CAN change under another tablet — the allocations, the job, the pieces
  // — is re-read inside, under the latch.
  const slab = await prisma.fabSlab.findUnique({
    where: { id: slabId },
    select: {
      id: true,
      slabCode: true,
      length: true,
      width: true,
      project: { select: { id: true, projectCode: true, status: true } },
    },
  });
  if (!slab) return Response.json({ error: "Slab not found" }, { status: 404 });

  const slabLabel = `Slab ${slab.slabCode}`;
  const project = slab.project;

  type Outcome =
    | { kind: "existing"; slabJobId: string; status: string }
    | { kind: "refused"; error: string }
    | {
        kind: "created";
        slabJobId: string;
        status: string;
        piecesCreated: number;
        piecesAlreadyPresent: number;
        warnings: string[];
        loss: ReturnType<typeof computeSlabLoss>;
      };

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(
      async (tx): Promise<Outcome> => {
        /* -- The latch ------------------------------------------------------ */
        await tx.$queryRaw`SELECT id FROM fab_project WHERE id = ${project.id} FOR UPDATE`;

        // Idempotent, and checked BEFORE anything is computed — deliberately.
        // A slab already on the cutting floor must come back unchanged even if
        // its stored figures would now be judged differently: re-running this is
        // a retry, not a second decision, and it must not start failing for a
        // job that already exists.
        const existing = await tx.fabSlabJob.findFirst({
          where: { slabId, status: { in: [...ACTIVE_JOB_STATUSES] } },
          select: { id: true, status: true },
        });
        if (existing) return { kind: "existing", slabJobId: existing.id, status: existing.status };

        /* -- What is on the slab, as of now --------------------------------- */
        const allocations = await tx.fabRequirementAllocation.findMany({
          where: { slabId },
          orderBy: { createdAt: "asc" },
          select: {
            allocatedQuantity: true,
            requirement: {
              select: {
                id: true, projectId: true, drawingId: true,
                quantity: true, sinkQuantity: true,
                length: true, width: true, shapeType: true,
                pieceLabel: true, description: true,
                // The piece code's letter, and the tie-break the pre-0054
                // fallback orders by. See letterFor().
                rowLetter: true, createdAt: true,
                po: { select: { poNumber: true } },
                drawing: { select: { drawingNumber: true } },
              },
            },
          },
        });

        // One card per requirement. An allocation is unique per (requirement,
        // slab) on the write path, but the board folds duplicates rather than
        // trusting that, and so does this: two rows for one requirement are one
        // row with their shares summed, or the second would restart the sink
        // top-up from zero.
        const rows = new Map<string, {
          requirement: (typeof allocations)[number]["requirement"];
          allocatedOnThisSlab: number;
        }>();
        for (const a of allocations) {
          const seen = rows.get(a.requirement.id);
          if (seen) { seen.allocatedOnThisSlab += a.allocatedQuantity; continue; }
          rows.set(a.requirement.id, { requirement: a.requirement, allocatedOnThisSlab: a.allocatedQuantity });
        }

        /* -- May it go at all? ---------------------------------------------- */
        const lossRows = [...rows.values()].map(r => ({
          // INCHES. The slab's own length/width are MILLIMETRES; computeSlabLoss
          // is the only thing allowed to put the two in one sum, and it names
          // the unit in every parameter for exactly that reason.
          lengthIn: r.requirement.length,
          widthIn: r.requirement.width,
          allocatedQuantity: r.allocatedOnThisSlab,
        }));
        // Stone already cut off this slab for sampling. It is spent — it is not
        // available to the purchase order and it is not scrap — so it counts
        // toward capacity here exactly as an assigned piece does. Read inside
        // the same transaction as the allocations so a sample recorded while
        // this runs cannot slip past the check.
        const sampledAreaSqft = await sampledAreaForSlab(slab.id);
        const loss = computeSlabLoss({
          slabLengthMm: slab.length,
          slabWidthMm: slab.width,
          pieces: slabLossPieces(lossRows),
          sampledAreaSqft,
        });

        // The same pure rule the board greys the button with, so the screen
        // cannot offer something this will reject.
        const decision = decideSendToCutting({
          slabLabel,
          assignedPieceCount: assignedPieceCount(lossRows),
          overCommitted: loss.overCommitted,
          usedAreaSqft: loss.usedAreaSqft,
          slabAreaSqft: loss.slabAreaSqft,
          // So the refusal names the sample take-off instead of accusing the
          // supervisor of rows he did not put there.
          sampledAreaSqft: loss.sampledAreaSqft,
        });
        if (!decision.ok) return { kind: "refused", error: decision.error };

        /* -- Plan the pieces ------------------------------------------------ */
        // HAS THIS SLAB ALREADY BEEN RELEASED? Any fab_piece carrying this
        // slab_id means yes — by an earlier send, or by release-project on a
        // legacy project. Re-releasing would double the work on the floor, so
        // the pieces are left exactly as they are and only the cutting job is
        // created. Read under the latch, which is what makes it a guard rather
        // than a guess; a bare count outside one proves nothing at READ
        // COMMITTED.
        const piecesAlreadyPresent = await tx.fabPiece.count({ where: { slabId } });

        let planned: PlannedSlabPiece[] = [];
        let warnings: string[] = [];

        if (piecesAlreadyPresent === 0) {
          const requirementIds = [...rows.keys()];

          // What each row has already had made, anywhere. sink_quantity is per
          // ORDER ROW, not per slab, so the sinks this slab owes are the
          // balance — see planSlabRelease.
          //
          // A REJECTED PIECE DOES NOT COUNT AS MADE. It is broken stone: the
          // customer ordered ten and still has nine, so the row owes one more
          // and a replacement slab must be able to cut it.
          //
          // Counting them was a quiet trap. planSlabRelease computes headroom as
          // ordered − created, so one rejection took a ten-piece row to zero
          // headroom, and the supervisor sending the replacement slab was told
          // "all 10 already released" — a sentence that is true of the pieces
          // and false of the order, and gives him nothing to do about it.
          //
          // The piece NUMBER is a different question and is answered
          // differently: existingCodes below deliberately does NOT filter, so a
          // rejected piece's number stays spent. Its code may be written on
          // stone in a skip; nothing may ever carry it again.
          const madeAlready = await tx.fabPiece.findMany({
            where: { requirementId: { in: requirementIds }, status: { not: "REJECTED" } },
            select: { requirementId: true, hasSink: true },
          });
          const tally = new Map<string, { pieces: number; sinks: number }>();
          for (const p of madeAlready) {
            if (!p.requirementId) continue;
            const t = tally.get(p.requirementId) ?? { pieces: 0, sinks: 0 };
            t.pieces += 1;
            if (p.hasSink) t.sinks += 1;
            tally.set(p.requirementId, t);
          }

          // piece_code is @unique GLOBALLY, so the counter resumes past the
          // highest number this project has already used rather than starting
          // at 1 on every slab.
          //
          // Filtered on the CODE PREFIX alone, not on project_id as well.
          // fab_project.project_code is itself @unique, so the prefix already
          // names one project's number space, and matching on it catches a piece
          // stamped with this code even if its project_id says otherwise. The
          // filter that looks tighter is the one that can miss a live code and
          // hand the same number out twice. Codes whose tail is not a plain
          // number — the cutting queue's retired format — are ignored by
          // nextPieceNumber.
          const existingCodes = await tx.fabPiece.findMany({
            where: { pieceCode: { startsWith: `${project.projectCode}-` } },
            select: { pieceCode: true },
          });

          // A ROW'S LETTER, with a fallback that CANNOT COLLIDE.
          //
          // Every row should carry one: the importer assigns them and so does
          // the manager's add-row. A row from before scripts/0054 does not, and
          // refusing the whole send over a missing migration would stop the
          // floor — so those are lettered here instead.
          //
          // The fallback CONTINUES PAST the highest letter any row on this slab
          // already stores, rather than counting from A. Counting from A hands
          // an unlettered row the letter a lettered one already owns, and two
          // rows sharing a letter is not a cosmetic problem: the piece codes
          // collide on a UNIQUE column and the send fails outright.
          const stored = [...rows.values()]
            .map(r => String(r.requirement.rowLetter ?? "").trim().toUpperCase())
            .filter(l => /^[A-Z]+$/.test(l));
          const needLetters = [...rows.values()]
            .map(r => r.requirement)
            .filter(r => !/^[A-Z]+$/.test(String(r.rowLetter ?? "").trim().toUpperCase()))
            .sort((a, b) => {
              const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return ta !== tb ? ta - tb : String(a.id).localeCompare(String(b.id));
            });
          const fallback = new Map<string, string>();
          assignRowLetters(stored, needLetters.length)
            .forEach((letter, i) => fallback.set(needLetters[i].id, letter));

          const letterFor = (req: { id: string; rowLetter?: string | null }): string => {
            const l = String(req.rowLetter ?? "").trim().toUpperCase();
            if (/^[A-Z]+$/.test(l)) return l;
            return fallback.get(req.id) ?? "A";
          };

          const planRows: SlabReleaseRow[] = [...rows.values()].map(r => ({
            requirementId: r.requirement.id,
            name: describeRequirement({
              drawingNumber: r.requirement.drawing?.drawingNumber,
              poNumber: r.requirement.po?.poNumber,
              rowLetter: letterFor(r.requirement),
              pieceLabel: r.requirement.pieceLabel,
              description: r.requirement.description,
            }),
            orderedQuantity: r.requirement.quantity,
            allocatedOnThisSlab: r.allocatedOnThisSlab,
            piecesAlreadyCreated: tally.get(r.requirement.id)?.pieces ?? 0,
            sinksAlreadyCreated: tally.get(r.requirement.id)?.sinks ?? 0,
            sinkQuantity: r.requirement.sinkQuantity,
            // {projectCode}-{LETTER}-{n}. A row with no letter yet (imported
            // before scripts/0054) falls back to a letter derived from its
            // position among this project's rows, so a send never fails for
            // want of a migration — but a lettered row always wins.
            rowLetter: letterFor(r.requirement),
            // Each row resumes ITS OWN numbering: 28 ordered pieces can be 12
            // on this slab and 16 on the next, and piece_code is unique
            // globally, so restarting at 1 fails to insert rather than merely
            // mislabelling.
            nextNumberInRow: nextPieceNumberInRow(
              project.projectCode,
              letterFor(r.requirement),
              existingCodes.map(c => c.pieceCode),
            ),
          }));

          const plan = planSlabRelease({ rows: planRows });

          // Every row on the slab was already released somewhere else, so this
          // send would create a job with nothing in it. Name them and refuse —
          // that empty job is precisely what the retired auto-create branch in
          // the cutting queue existed to paper over.
          if (plan.pieces.length === 0) {
            return {
              kind: "refused",
              error: plan.blocked.length
                ? describeAlreadyReleasedRows(slabLabel, plan.blocked)
                : `${slabLabel} has no piece rows on it any more — someone took them off while this was being sent. Nothing was sent.`,
            };
          }

          planned = plan.pieces;
          warnings = plan.warnings;

          /* -- Write the pieces --------------------------------------------- */
          // Two route sheets cover a whole row — with a sink and without — so
          // they are planned once per requirement, not once per piece.
          // polishRequired is true for every piece now, polish having stopped
          // being a decision the upload makes; it still goes through
          // deriveRoutingFlags so the rule stays written down in one place.
          const routing = new Map<string, {
            polishRequired: boolean;
            sinkOps: ReturnType<typeof planPieceOperations>;
            plainOps: ReturnType<typeof planPieceOperations>;
          }>();
          for (const [requirementId, r] of rows) {
            const { polishRequired } = deriveRoutingFlags(r.requirement);
            routing.set(requirementId, {
              polishRequired,
              sinkOps: planPieceOperations({ polishRequired, sinkRequired: true, fabricationRequired: true }),
              plainOps: planPieceOperations({ polishRequired, sinkRequired: false, fabricationRequired: false }),
            });
          }

          for (const batch of chunk(planned, PIECE_CHUNK)) {
            const data: Prisma.FabPieceCreateManyInput[] = batch.map(p => {
              const r = rows.get(p.requirementId)!.requirement;
              return {
                pieceCode: formatPieceCode(project.projectCode, p.rowLetter, p.n),
                projectId: r.projectId,
                drawingId: r.drawingId ?? undefined,
                requirementId: r.id,
                slabId,
                length: r.length,
                width: r.width,
                shapeType: r.shapeType ?? "RECTANGLE",
                hasSink: p.hasSink,
                polishRequired: routing.get(p.requirementId)!.polishRequired,
                // Fabrication is the hand-polish of the sink cutout, so it
                // follows the sink piece by piece.
                fabricationRequired: p.hasSink,
              };
            });

            // createManyAndReturn is a single INSERT ... RETURNING on Postgres,
            // so one round-trip gives us every generated id. Match rows back by
            // pieceCode (unique) rather than trusting the returned order.
            const created = await tx.fabPiece.createManyAndReturn({
              data,
              select: { id: true, pieceCode: true },
            });
            const idByCode = new Map(created.map(c => [c.pieceCode, c.id]));

            const slabAllocations: Prisma.FabSlabAllocationCreateManyInput[] = [];
            const operations: Prisma.FabPieceOperationCreateManyInput[] = [];
            for (const p of batch) {
              // The same formatter the insert used, so the lookup key cannot
              // drift from the key that was written.
              const code = formatPieceCode(project.projectCode, p.rowLetter, p.n);
              const pieceId = idByCode.get(code);
              if (!pieceId) throw new Error(`Piece ${code} was not returned by the insert`);
              // fab_slab_allocation as well as fab_piece.slab_id. A piece
              // created without one is invisible to the legacy cutting queue
              // for good — it joins through this table, not through the column.
              slabAllocations.push({ pieceId, slabId });
              const sheet = routing.get(p.requirementId)!;
              for (const op of p.hasSink ? sheet.sinkOps : sheet.plainOps) {
                operations.push({
                  pieceId, operationType: op.operationType, sequence: op.sequence, isRequired: true,
                });
              }
            }

            await tx.fabSlabAllocation.createMany({ data: slabAllocations });
            for (const opBatch of chunk(operations, OPERATION_CHUNK)) {
              await tx.fabPieceOperation.createMany({ data: opBatch });
            }
          }
        }

        /* -- Then the job --------------------------------------------------- */
        const job = await tx.fabSlabJob.create({
          data: {
            slabId,
            status: "READY",
            // Nulls are a real answer here: a slab with no usable dimensions
            // gets null percentages, because "0% wasted" and "we do not know"
            // are different facts and the columns are nullable so they can hold
            // the difference. usedAreaSqft is known either way.
            usedAreaSqft: loss.usedAreaSqft,
            totalWastagePct: loss.totalWastagePct,
            trueScrapPct: loss.trueScrapPct,
          },
          select: { id: true, status: true },
        });

        /* -- And only then, maybe, the project ------------------------------ */
        // NOT on the first slab. /api/fab/supervisor/board?view=projects lists
        // PLANNING and ALLOCATED only, so flipping the project on slab 1 of 5
        // would take it off the supervisor's board and leave him no way to send
        // slabs 2 to 5 — the project would be "in production" with four fifths
        // of the order never cut. It moves when every requirement in the project
        // has all of its pieces made, which is the first moment the old
        // project-scoped release would also have been legal.
        const requirements = await tx.fabRequirement.findMany({
          where: { projectId: project.id },
          select: { id: true, quantity: true },
        });
        const made = await tx.fabPiece.groupBy({
          by: ["requirementId"],
          where: { projectId: project.id },
          _count: { _all: true },
        });
        const madeByRequirement = new Map(
          made.map(m => [m.requirementId, m._count._all] as const),
        );
        const everythingReleased =
          requirements.length > 0 &&
          requirements.every(r => (madeByRequirement.get(r.id) ?? 0) >= r.quantity);
        if (everythingReleased && project.status !== "RELEASED_TO_PRODUCTION") {
          await tx.fabProject.update({
            where: { id: project.id },
            data: { status: "RELEASED_TO_PRODUCTION" },
          });
        }

        return {
          kind: "created",
          slabJobId: job.id,
          status: job.status,
          piecesCreated: planned.length,
          piecesAlreadyPresent,
          warnings,
          loss,
        };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );
  } catch (e) {
    // Nothing was written either way — the transaction rolls back — so say
    // that plainly and log the detail. Without this a P2028 escaped as an
    // unhandled throw and the board could only say "Could not save (error 500)".
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null;
    console.error("[approve-slab] failed", { slabId, projectId: project.id, code, error: e });

    const detail =
      code === "P2028" ? "the database transaction timed out"
        : code === "P2002" ? "some of these pieces already exist"
        : code === "P2003" ? "a slab or piece row referenced here no longer exists"
        : e instanceof Error ? e.message
        : "unknown error";

    return Response.json(
      {
        error: `${slabLabel} was not sent — ${detail}. Nothing was created; the slab is still on the board.${code ? ` (${code})` : ""}`,
        code,
      },
      { status: 500 },
    );
  }

  if (outcome.kind === "refused") {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  if (outcome.kind === "existing") {
    return Response.json({ slabJobId: outcome.slabJobId, status: outcome.status, created: false });
  }

  return Response.json({
    slabJobId: outcome.slabJobId,
    status: outcome.status,
    created: true,
    piecesCreated: outcome.piecesCreated,
    // Non-zero means the pieces were already there — an earlier send, or a
    // legacy project released project-wide — and this call only created the
    // cutting job.
    piecesAlreadyPresent: outcome.piecesAlreadyPresent,
    warnings: outcome.warnings,
    usedAreaSqft: outcome.loss.usedAreaSqft,
    remainingAreaSqft: outcome.loss.remainingAreaSqft,
    totalWastagePct: outcome.loss.totalWastagePct,
    trueScrapPct: outcome.loss.trueScrapPct,
  });
}
