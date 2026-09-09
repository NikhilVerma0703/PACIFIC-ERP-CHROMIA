import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { buildReleasePlan, describeUnresolvedRequirements } from "@/lib/fab/releasePlan";
import { deriveRoutingFlags, resolveSinkQuantity } from "@/lib/fab/requirement-derive";
import { planPieceOperations } from "@/lib/fab/pieceOperations";
import { parseEdges } from "@/lib/fab/pricing";
import { rowHasHandPolish } from "@/lib/fab/shape";

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
      // A requirement from a PO PDF has drawing_id NULL — the PO number and the
      // PDF row number are the only handle the supervisor has on it. Pulled in
      // for the blocked-release message below, which would otherwise name four
      // indistinguishable "Row 7"s on a project holding four purchase orders.
      po: { select: { poNumber: true } },
      allocations: { include: { slab: true }, orderBy: { createdAt: "asc" } },
    },
    // Deterministic, so a retry numbers the pieces the same way it did before.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!requirements.length) {
    return Response.json({ error: "No requirements. Upload Excel first." }, { status: 400 });
  }

  // THE GUARD STANDS IN THE NEW FLOW TOO, and it now blocks more than it used
  // to. A PO project has no drawings, so the `drawing.defaultSlabId` escape
  // hatch is never available and every single requirement must carry its own
  // allocation. That is correct rather than unfortunate: a piece with no slab
  // cannot be cut, and releasing it would create a fab_piece with slab_id NULL
  // that appears in no cutter's queue and is found at the packing bench. What
  // changed is the message — it names the rows (with their PO) instead of
  // counting them.
  const unresolved = requirements.filter(r => !r.allocations[0]?.slabId && !r.drawing?.defaultSlabId);
  if (unresolved.length) {
    // Name them. A bare count on a 198-line project is a scavenger hunt.
    return Response.json(
      {
        error: describeUnresolvedRequirements(
          unresolved.map(r => ({
            drawingNumber: r.drawing?.drawingNumber,
            poNumber: r.po?.poNumber,
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
    /** Written to fab_piece.has_edge_polish after the insert — see the note at
     *  the createMany. Carried here rather than on `piece` so the typed insert
     *  cannot touch a column the database may not have yet. */
    hasEdgePolish: boolean;
    ops: ReturnType<typeof planPieceOperations>;
  }[] = [];

  for (const r of requirements) {
    const fallbackSlabId = r.allocations[0]?.slabId ?? r.drawing?.defaultSlabId ?? null;
    // polishRequired is now true for every piece — polish stopped being a
    // decision the upload makes. Still routed through deriveRoutingFlags so the
    // rule stays written down in exactly one place.
    const { polishRequired } = deriveRoutingFlags(r);

    // The sink is per PIECE now, not per requirement: the supervisor says "3 of
    // these 10 get a sink" and the FIRST 3 in cut order are the ones that do.
    // Clamped to the ordered quantity — a stale sink_quantity left over from a
    // larger order would otherwise mark pieces that no longer exist.
    const sinkQuantity = resolveSinkQuantity(r.sinkQuantity, r.quantity);

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

    // HAND EDGE POLISH — A ROW-LEVEL FACT, so it is resolved once here.
    //
    // The owner: "any pieces can be assigned the edge hand polish or not."
    // Under the group rule a row is homogeneous — a row where only some pieces
    // want it is SPLIT into two rows — so every piece of this row gets the same
    // answer.
    //
    // Not the same question as the sink, which really is per piece: sink_quantity
    // is a count and the first N pieces carry it.
    //
    // -- AND IT ASKED THE WRONG COLUMN -------------------------------------
    //
    // This read `finished_edges` ALONE, which is the pre-0067 selection. Every
    // row specified with the three-face controls leaves that column NULL and
    // writes edges_top / edges_bottom / edges_side instead, so hasEdgePolish
    // came back FALSE on exactly the rows somebody had just finished pricing.
    //
    // The consequence was not a wrong number, it was NO WORK ORDER: the piece
    // got `fabricationRequired: false`, took the plain route sheet (cut,
    // machine polish, pack) and never appeared in the hand bench queue at all.
    // On PO 1612104578 that is Rs3,58,497.92 of hand polish invoiced and never
    // scheduled -- the same failure the comment below says the old
    // `fabricationRequired = sinkRequired` rule caused, through another door.
    //
    // THE FALLBACK IS THE PRICING ENGINE'S, EXACTLY. faceEdgesUnset decides
    // which specification a row is on and faceEdgesFromLegacy reads the old
    // pair when there is no new one, so this asks the same question priceRow
    // answers -- and a row cannot be charged for work it is never sent to do.
    const hasEdgePolish = rowHasHandPolish(r);

    // THREE ROUTE SHEETS NOW, not two. The third is the row that goes to the
    // hand bench for its EDGES with no sink to cut — impossible under the old
    // `fabricationRequired = sinkRequired` rule, and ordinary since the owner
    // separated them. Cut, machine polish, hand polish, pack.
    const sinkOps  = planPieceOperations({ polishRequired, sinkRequired: true,  fabricationRequired: true });
    const plainOps = planPieceOperations({ polishRequired, sinkRequired: false, fabricationRequired: false });
    const edgeOps  = planPieceOperations({ polishRequired, sinkRequired: false, fabricationRequired: true });

    plan.slabIds.forEach((slabId, pieceIndex) => {
      const hasSink = pieceIndex < sinkQuantity;
      planned.push({
        slabId,
        hasEdgePolish,
        ops: hasSink ? sinkOps : hasEdgePolish ? edgeOps : plainOps,
        piece: {
          pieceCode: `${prefix}${String(counter++).padStart(4, "0")}`,
          projectId,
          drawingId: r.drawingId ?? undefined,
          requirementId: r.id,
          slabId,
          length: r.length,
          width: r.width,
          shapeType: r.shapeType ?? "RECTANGLE",
          hasSink,
          polishRequired,
          // A piece reaches the fabricator's bench for EITHER hand job now — the
          // sink cutout's polish, or the edges. It used to follow the sink alone,
          // and a plain row's edge work went to a station nobody had scheduled.
          //
          // has_edge_polish itself is stamped after the insert, not here: the
          // column arrives in scripts/0063 and a typed write would take the whole
          // release down on a deploy that runs ahead of the migration.
          fabricationRequired: hasSink || hasEdgePolish,
        },
      });
    });
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

          // ---- THE HAND EDGE POLISH STAMP --------------------------------
          //
          // Raw, and after the insert, on purpose. has_edge_polish arrives in
          // scripts/0063; putting it in the typed createMany above would throw
          // P2022 on a deploy running ahead of the migration and take the whole
          // release with it — and a release that half-happens is the worst
          // outcome on this route, which is why it is all inside one
          // transaction to begin with.
          //
          // INSIDE the transaction, so a failure here rolls the pieces back
          // too. A piece created without its stamp would sit in no hand-bench
          // queue and be found at packing — the same class of bug as the
          // slab_id NULL the guard above exists to prevent. Better to refuse
          // the release and be told to run the migration.
          const edgeCodes = batch.filter(p => p.hasEdgePolish).map(p => p.piece.pieceCode);
          if (edgeCodes.length) {
            await tx.$executeRaw`
              UPDATE fab_piece SET has_edge_polish = true
              WHERE  piece_code = ANY(${edgeCodes}::text[])
            `;
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
