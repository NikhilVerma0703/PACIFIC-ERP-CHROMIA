// GET /api/fab/slab-allocation?projectId=xxx
// Returns slabs with pieces, assigned QC slab info, thickness bucket, and wastage %.

import { NextRequest } from "next/server";
import { fabGate } from "@/lib/fab/access";
import { prisma } from "@/lib/prisma";

// Standard Pacific slab: 137 x 79 inches
const SLAB_L_MM = 137 * 25.4; // 3479.8 mm
const SLAB_W_MM = 79  * 25.4; // 2006.6 mm
const SLAB_AREA = SLAB_L_MM * SLAB_W_MM; // ~6,982,567 mm2

function thickBucket(t: number | null | undefined): 2 | 3 | null {
  if (!t) return null;
  const r = Math.round(t);
  if (r === 2) return 2;
  if (r === 3) return 3;
  // handle legacy mm storage (50.8 -> 2, 76.2 -> 3)
  const fromMm = Math.round(t / 25.4);
  if (fromMm === 2) return 2;
  if (fromMm === 3) return 3;
  return null;
}

export async function GET(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  const slabs = await prisma.fabSlab.findMany({
    where: { projectId },
    include: {
      slabJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      requirementAllocations: {
        include: { requirement: { include: { drawing: true } } },
      },
    },
    orderBy: { slabCode: "asc" },
  });

  // Fetch assigned QC slab info
  const qcIds = slabs.map(s => s.pacificQcId).filter(Boolean) as string[];
  const qcSlabs = qcIds.length
    ? await prisma.polishQc.findMany({
        where:  { id: { in: qcIds } },
        select: { id: true, slabNumber: true, design: true, slabThickness: true, qualityGrade: true },
      })
    : [];
  const qcById = new Map(qcSlabs.map(q => [q.id, q]));

  const result = slabs
    .filter(s => s.requirementAllocations.length > 0)
    .map(s => {
      const pieces = s.requirementAllocations.map(a => ({
        requirementId: a.requirement.id,
        drawingNumber: a.requirement.drawing?.drawingNumber ?? "?",
        pieceLabel:    a.requirement.pieceLabel ?? a.requirement.description ?? "?",
        description:   a.requirement.description ?? null,
        lengthIn:      a.requirement.length    ?? null,
        widthIn:       a.requirement.width     ?? null,
        thickness:     a.requirement.thickness ?? null,
        qty:           a.allocatedQuantity,
      }));

      const buckets = [...new Set(pieces.map(p => thickBucket(p.thickness)).filter(Boolean))];
      const thicknessBucket: 2 | 3 | null = buckets.length === 1 ? (buckets[0] as 2 | 3) : null;

      // Pieces stored in inches -> convert to mm for area
      const piecesAreaMm2 = pieces.reduce((sum, p) => {
        const l = (p.lengthIn ?? 0) * 25.4;
        const w = (p.widthIn  ?? 0) * 25.4;
        return sum + l * w * p.qty;
      }, 0);

      const qc = s.pacificQcId ? qcById.get(s.pacificQcId) : null;
      const wastagePct = qc
        ? Math.max(0, ((SLAB_AREA - piecesAreaMm2) / SLAB_AREA) * 100)
        : null;

      return {
        slabId:          s.id,
        slabCode:        s.slabCode,
        slabJobStatus:   s.slabJobs[0]?.status ?? null,
        slabJobId:       s.slabJobs[0]?.id     ?? null,
        pacificQcId:     s.pacificQcId ?? null,
        qcSlabCode:      qc ? String(qc.slabNumber) : null,
        qcSlabColour:    qc?.design ?? null,
        thicknessBucket,
        piecesAreaMm2:   Math.round(piecesAreaMm2),
        wastagePct:      wastagePct !== null ? Math.round(wastagePct * 10) / 10 : null,
        pieces,
      };
    });

  return Response.json(result);
}
