import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { buildReleasePlan, describeUnresolvedRequirements } from "@/lib/fab/releasePlan";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import { planPieceOperations } from "@/lib/fab/pieceOperations";

// Release turns a planned project into physical work: one fab_piece per ordered
// piece, the slab it comes off, and its route sheet.
//
// WHY THIS IS BATCHED. It used to await, inside one interactive transaction and
// once PER PIECE: fabPiece.create, fabSlabAllocation.create, and 2-5
// fabPieceOperation.create. The live project `Testing` is 198 requirements /
// 902 pieces / 896 polished / 180 with sinks = 4,864 per-piece writes plus the
// project update: 4,865 sequential round-trips to Neon. Prisma's interactive
// transaction defaults to a 5,000 ms timeout, and a measured Neon round-trip
// from the office is 44-70 ms, so between 55 and 110 of those 4,865 fit. The
// transaction was killed with P2028 ("Transaction not found... refers to an old
// closed transaction") roughly 2% of the way in, every single attempt, and the
// whole thing rolled back — so the supervisor saw an error AND nothing happened.
//
// The whole plan is now computed in memory with no database in the loop, then
// written with createManyAndReturn / createMany in chunks: ~4 round-trips per
// chunk of 500 pieces, so 902 pieces cost 7 round-trips instead of 4,865. The
// raised timeout below is a safety margin for a genuinely huge project, not the
// fix — a bigger timeout on its own would only move the cliff, and 4,865
// round-trips (~3.5 minutes) would then hit the Vercel function limit instead.

/** Pieces per write chunk. Keeps each INSERT well inside Postgres' 65,535
 *  bind-parameter ceiling (500 pieces ~ 7k params, their operations ~ 14k). */
const PIECE_CHUNK = 500;

/** Generous, because a very large project is legitimate; unreachable in practice
 *  at ~4 round-trips per 500 pieces. */
const TX_TIMEOUT_MS = 120_000;
const TX_MAX_WAIT_MS = 15_000;

export const maxDuration = 60;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let projectId: string | undefined;
  try {
    ({ projectId } = await req.json());
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.fabProject.findUnique({ where: { id: projectId } });
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  if (project.status === "RELEASED_TO_PRODUCTION") {
    return Response.json({ error: "Already released" }, { status: 400 });
  }

  const requirements = await prisma.fabRequirement.findMany({
    where: { projectId },
    include: {
      drawing: { include: { defaultSlab: true } },
      allocations: { include: { slab: true }, orderBy: { createdAt: "asc" } },
    },
    // Deterministic, so a retry numbers the pieces the same way it did before.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!requirements.length) {
    return Response.json({ error: "No requirements. Upload Excel first." }, { status: 400 });
  }

  const unresolved = requirements.filter(r => !r.allocations[0]?.slabId && !r.drawing?.defaultSlabId);
  if (unresolved.length) {
    // Name them. A bare count on a 198-line project is a scavenger hunt.
    return Response.json(
      {
        error: describeUnresolvedRequirements(
          unresolved.map(r => ({
            drawingNumber: r.drawing?.drawingNumber,
            pieceLabel: r.pieceLabel,
            description: r.description,
          })),
        ),
        unresolvedIds: unresolved.map(r => r.id),
      },
      { status: 400 },
    );
  }

  /* -- Plan, entirely in memory --------------------------------------------- */

  // pieceCode is @unique globally (schema.prisma:2264). Numbering always from 1
  // would collide with anything this project already released, so start past the
  // highest number already used in this project's release format.
  const existing = await prisma.fabPiece.findMany({
    where: { projectId, pieceCode: { startsWith: `${project.projectCode}-` } },
    select: { pieceCode: true },
  });
  const prefix = `${project.projectCode}-`;
  let counter = 1;
  for (const { pieceCode } of existing) {
    const tail = pieceCode.slice(prefix.length);
    if (/^\d+$/.test(tail)) counter = Math.max(counter, Number(tail) + 1);
  }

  const warnings: string[] = [];
  const planned: {
    piece: Prisma.FabPieceCreateManyInput;
    slabId: string;
    ops: ReturnType<typeof planPieceOperations>;
  }[] = [];

  for (const r of requirements) {
    const fallbackSlabId = r.allocations[0]?.slabId ?? r.drawing?.defaultSlabId ?? null;
    const { polishRequired, fabricationRequired, sinkRequired } = deriveRoutingFlags(r);

    // A piece belongs to the slab it will be cut FROM, and one requirement can
    // be split across several — see buildReleasePlan for the rule and its tests.
    const plan = buildReleasePlan({
      quantity: r.quantity,
      allocations: r.allocations.map(a => ({ slabId: a.slabId, allocatedQuantity: a.allocatedQuantity })),
      fallbackSlabId,
    });

    if (plan.overAllocatedBy > 0) {
      const label = `${r.drawing?.drawingNumber ?? "?"}-${r.pieceLabel ?? r.description ?? "?"}`;
      warnings.push(
        `${label}: slabs are allocated ${r.quantity + plan.overAllocatedBy} pieces but only ${r.quantity} are ordered — the extra allocation was not released.`,
      );
    }

    const ops = planPieceOperations({ polishRequired, sinkRequired, fabricationRequired });

    for (const slabId of plan.slabIds) {
      planned.push({
        slabId,
        ops,
        piece: {
          pieceCode: `${prefix}${String(counter++).padStart(4, "0")}`,
          projectId,
          drawingId: r.drawingId ?? undefined,
          requirementId: r.id,
          slabId,
          length: r.length,
          width: r.width,
          shapeType: r.shapeType ?? "RECTANGLE",
          hasSink: sinkRequired,
          polishRequired,
          fabricationRequired,
        },
      });
    }
  }

  /* -- Write ----------------------------------------------------------------- */

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const batch of chunk(planned, PIECE_CHUNK)) {
          // createManyAndReturn is a single INSERT ... RETURNING on Postgres, so
          // one round-trip gives us every generated id. Match rows back by
          // pieceCode (unique) rather than trusting the returned order.
          const created = await tx.fabPiece.createManyAndReturn({
            data: batch.map(p => p.piece),
            select: { id: true, pieceCode: true },
          });
          const idByCode = new Map(created.map(c => [c.pieceCode, c.id]));

          const allocations: Prisma.FabSlabAllocationCreateManyInput[] = [];
          const operations: Prisma.FabPieceOperationCreateManyInput[] = [];
          for (const p of batch) {
            const pieceId = idByCode.get(p.piece.pieceCode);
            if (!pieceId) throw new Error(`Piece ${p.piece.pieceCode} was not returned by the insert`);
            allocations.push({ pieceId, slabId: p.slabId });
            for (const op of p.ops) {
              operations.push({ pieceId, operationType: op.operationType, sequence: op.sequence, isRequired: true });
            }
          }

          await tx.fabSlabAllocation.createMany({ data: allocations });
          for (const opBatch of chunk(operations, 2000)) {
            await tx.fabPieceOperation.createMany({ data: opBatch });
          }
        }

        await tx.fabProject.update({
          where: { id: projectId },
          data: { status: "RELEASED_TO_PRODUCTION" },
        });
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );
  } catch (e) {
    // The route had no try/catch at all, so a P2028 escaped as an unhandled
    // throw, Next returned a bare HTML 500, and the board could only say
    // "Could not save (error 500)." Nothing was written either way — the
    // transaction rolls back — so say that, plainly, and log the detail.
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null;
    console.error("[release-project] failed", { projectId, pieces: planned.length, code, error: e });

    const detail =
      code === "P2028"
        ? "the database transaction timed out"
        : code === "P2002"
          ? "some of these pieces already exist"
          : code === "P2003"
            ? "a slab or drawing referenced by this project no longer exists"
            : e instanceof Error
              ? e.message
              : "unknown error";

    return Response.json(
      {
        error: `Release failed — ${detail}. Nothing was created; the project is still unreleased. (${planned.length} piece(s) were being created${code ? `, ${code}` : ""}.)`,
        code,
      },
      { status: 500 },
    );
  }

  return Response.json({ success: true, piecesCreated: planned.length, warnings });
}
