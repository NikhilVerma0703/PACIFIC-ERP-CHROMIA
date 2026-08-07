import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { buildReleasePlan } from "@/lib/fab/releasePlan";

const INCH_TO_MM = 25.4;

function deriveRoutingFlags(req: any) {
  const sinkRequired = (req.sinkCuts ?? 0) > 0 || !!(req.sinkModel?.trim());
  const polishRequired = (req.depLength ?? 0) > 0;
  return { sinkRequired, polishRequired, fabricationRequired: sinkRequired };
}

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { projectId } = await req.json();
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.fabProject.findUnique({ where: { id: projectId } });
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  if (project.status === "RELEASED_TO_PRODUCTION") return Response.json({ error: "Already released" }, { status: 400 });

  const requirements = await prisma.fabRequirement.findMany({
    where: { projectId },
    include: {
      drawing: { include: { defaultSlab: true } },
      allocations: { include: { slab: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!requirements.length) return Response.json({ error: "No requirements. Upload Excel first." }, { status: 400 });

  const unresolved = requirements.filter(r => !r.allocations[0]?.slabId && !r.drawing?.defaultSlabId);
  if (unresolved.length) return Response.json({ error: `${unresolved.length} requirement(s) have no slab`, unresolvedIds: unresolved.map(r => r.id) }, { status: 400 });

  let counter = 1;
  const warnings: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const req of requirements) {
      const fallbackSlabId = req.allocations[0]?.slabId ?? req.drawing?.defaultSlabId!;
      const { polishRequired, fabricationRequired, sinkRequired } = deriveRoutingFlags(req);

      // A piece belongs to the slab it will be cut FROM, and one requirement can
      // be split across several — see buildReleasePlan for the rule and its tests.
      const plan = buildReleasePlan({
        quantity:       req.quantity,
        allocations:    req.allocations.map(a => ({ slabId: a.slabId, allocatedQuantity: a.allocatedQuantity })),
        fallbackSlabId,
      });

      if (plan.overAllocatedBy > 0) {
        const label = `${req.drawing?.drawingNumber ?? "?"}-${req.pieceLabel ?? req.description ?? "?"}`;
        warnings.push(
          `${label}: slabs are allocated ${req.quantity + plan.overAllocatedBy} pieces but only ${req.quantity} are ordered — the extra allocation was not released.`
        );
      }

      for (const slabId of plan.slabIds) {
        const piece = await tx.fabPiece.create({
          data: {
            pieceCode: `${project.projectCode}-${String(counter++).padStart(4, "0")}`,
            projectId, drawingId: req.drawingId ?? undefined, requirementId: req.id, slabId,
            length: req.length, width: req.width, shapeType: req.shapeType ?? "RECTANGLE",
            hasSink: sinkRequired, polishRequired, fabricationRequired,
          },
        });
        await tx.fabSlabAllocation.create({ data: { pieceId: piece.id, slabId } });

        // PieceOperation sequence
        let seq = 1;
        await tx.fabPieceOperation.create({ data: { pieceId: piece.id, operationType: "CUTTING", sequence: seq++, isRequired: true } });
        if (polishRequired) await tx.fabPieceOperation.create({ data: { pieceId: piece.id, operationType: "POLISHING", sequence: seq, isRequired: true } });
        if (sinkRequired) await tx.fabPieceOperation.create({ data: { pieceId: piece.id, operationType: "SINK_CUTTING", sequence: seq, isRequired: true } });
        if (sinkRequired) seq++;
        if (fabricationRequired) await tx.fabPieceOperation.create({ data: { pieceId: piece.id, operationType: "FABRICATION", sequence: seq++, isRequired: true } });
        await tx.fabPieceOperation.create({ data: { pieceId: piece.id, operationType: "PACKAGING", sequence: seq, isRequired: true } });
      }
    }
    await tx.fabProject.update({ where: { id: projectId }, data: { status: "RELEASED_TO_PRODUCTION" } });
  });

  return Response.json({ success: true, piecesCreated: counter - 1, warnings });
}
