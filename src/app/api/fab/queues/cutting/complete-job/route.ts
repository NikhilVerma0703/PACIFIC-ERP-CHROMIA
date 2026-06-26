// POST /api/fab/queues/cutting/complete-job
// Body: { slabJobId: string }
// Marks a CLO FabSlabJob as COMPLETED and cascades.
// AUTO-CREATE: If no FabPiece records exist (CLO project that skipped release-project),
// creates them from FabRequirementAllocation data and marks CUTTING as completed.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId = g.user.id as string;

  const { slabJobId } = await req.json();
  if (!slabJobId) return Response.json({ error: "slabJobId required" }, { status: 400 });

  const now = new Date();

  const slabJob = await prisma.fabSlabJob.findUnique({
    where: { id: slabJobId },
    include: {
      slab: {
        include: {
          pieces: { select: { id: true } },
          requirementAllocations: {
            include: {
              requirement: {
                include: {
                  // select slabId so we can filter to THIS slab only
                  pieces: { select: { id: true, slabId: true } },
                  project: { select: { projectCode: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!slabJob) return Response.json({ error: "Slab job not found" }, { status: 404 });

  const machineSession = await prisma.fabMachineSession.findFirst({
    where: { userId, isActive: true },
    select: { machineId: true },
  });

  // Discover pieces that belong specifically to THIS slab.
  // After the multi-slab fix, requirement.pieces can include pieces from OTHER slabs
  // (same requirement allocated to multiple CLO slabs). Filter to this slab only.
  const pieceIdSet = new Set<string>();
  for (const p of slabJob.slab.pieces) pieceIdSet.add(p.id);
  for (const alloc of slabJob.slab.requirementAllocations) {
    for (const p of alloc.requirement.pieces) {
      if (p.slabId === slabJob.slabId) pieceIdSet.add(p.id);
    }
  }
  let pieceIds = [...pieceIdSet];
  let piecesCreated = 0;

  await prisma.$transaction(async (tx) => {
    // 1. Mark the slab job complete
    await tx.fabSlabJob.update({
      where: { id: slabJobId },
      data: {
        status:     "COMPLETED",
        endTime:    now,
        operatorId: userId,
        machineId:  machineSession?.machineId ?? undefined,
      },
    });

    if (pieceIds.length === 0 && slabJob.slab.requirementAllocations.length > 0) {
      // AUTO-CREATE pieces for CLO projects that skipped release-project
      const newPieceIds: string[] = [];
      const slabSuffix = slabJob.slabId.slice(-4);
      let reqIdx = 0;

      for (const alloc of slabJob.slab.requirementAllocations) {
        const req         = alloc.requirement;
        const projectCode = req.project?.projectCode ?? "CLO";
        const labelBase   = req.pieceLabel ?? String(reqIdx + 1).padStart(3, "0");
        reqIdx++;

        for (let i = 0; i < alloc.allocatedQuantity; i++) {
          const pieceCode = `${projectCode}-${labelBase}-${String(i + 1).padStart(3, "0")}-${slabSuffix}`;

          // upsert: idempotent on retry — if pieceCode already exists just return it
          const piece = await tx.fabPiece.upsert({
            where: { pieceCode },
            create: {
              pieceCode,
              projectId:           req.projectId,
              requirementId:       req.id,
              slabId:              slabJob.slabId,
              drawingId:           req.drawingId ?? undefined,
              length:              req.length,
              width:               req.width,
              shapeType:           req.shapeType ?? "RECTANGLE",
              hasSink:             req.sinkRequired,
              polishRequired:      req.polishRequired,
              fabricationRequired: req.fabricationRequired,
              status:              "CUT",
            },
            // Only reset status if still PENDING — don't regress an already-advanced piece
            update: {},
          });
          newPieceIds.push(piece.id);

          let seq = 1;
          await tx.fabPieceOperation.create({
            data: { pieceId: piece.id, operationType: "CUTTING", sequence: seq++, isRequired: true, isCompleted: true, completedAt: now },
          });
          if (req.polishRequired) {
            await tx.fabPieceOperation.create({
              data: { pieceId: piece.id, operationType: "POLISHING", sequence: seq++, isRequired: true },
            });
          }
          if (req.sinkRequired) {
            await tx.fabPieceOperation.create({
              data: { pieceId: piece.id, operationType: "SINK_CUTTING", sequence: seq++, isRequired: true },
            });
          }
          if (req.fabricationRequired) {
            await tx.fabPieceOperation.create({
              data: { pieceId: piece.id, operationType: "FABRICATION", sequence: seq++, isRequired: true },
            });
          }
          await tx.fabPieceOperation.create({
            data: { pieceId: piece.id, operationType: "PACKAGING", sequence: seq, isRequired: true },
          });
        }
      }

      pieceIds      = newPieceIds;
      piecesCreated = newPieceIds.length;
    } else if (pieceIds.length > 0) {
      // Update existing pieces
      await tx.fabPieceOperation.updateMany({
        where: { pieceId: { in: pieceIds }, operationType: "CUTTING", isCompleted: false },
        data:  { isCompleted: true, completedAt: now },
      });
      // Guard: only advance PENDING pieces — never regress a piece that already moved forward
      await tx.fabPiece.updateMany({
        where: { id: { in: pieceIds }, status: "PENDING" },
        data:  { status: "CUT" },
      });
    }
  });

  return Response.json({ success: true, piecesUpdated: pieceIds.length, piecesCreated });
}
