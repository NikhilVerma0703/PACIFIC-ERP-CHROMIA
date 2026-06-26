import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

interface LabelEntry { label: string; qty: number; }
interface SlabPlan   { stockSheet: string; page: number; labels: LabelEntry[]; }

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { projectId, plan }: { projectId: string; plan: SlabPlan[] } = await req.json();
  if (!projectId || !plan?.length) return Response.json({ error: "projectId and plan required" }, { status: 400 });

  const project = await prisma.fabProject.findUnique({
    where: { id: projectId },
    include: { drawings: { include: { requirements: true } } },
  });
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  // Build two lookup maps:
  //   1. serialNumber (pieceLabel) -> requirement  [new flow: labels are plain integers]
  //   2. "drawingNumber-pieceLabel" -> requirement  [legacy flow]
  type ReqInfo = { id: string; label: string; quantity: number; allocated: boolean };
  const bySerial = new Map<string, ReqInfo>();
  const byComposite = new Map<string, ReqInfo>();
  for (const d of project.drawings) {
    for (const r of d.requirements) {
      const composite = `${d.drawingNumber}-${r.pieceLabel}`;
      const info: ReqInfo = { id: r.id, label: composite, quantity: r.quantity, allocated: false };
      if (r.pieceLabel) bySerial.set(r.pieceLabel, info);
      byComposite.set(composite, info);
    }
  }

  const applied: { reqId: string; label: string; slabCode: string; page: number; qty: number }[] = [];
  const unmatchedLabels: string[] = [];

  for (const slabPlan of plan) {
    // Find or create placeholder slab (keyed by stockSheet + page)
    const slabCode = `${slabPlan.stockSheet}_p${slabPlan.page}`;
    let slab = await prisma.fabSlab.findFirst({ where: { projectId, slabCode } });
    if (!slab) {
      slab = await prisma.fabSlab.create({
        data: { projectId, slabCode, colour: "", totalArea: 0, availableArea: 0 },
      });
    }

    for (const entry of slabPlan.labels) {
      // Try serial number lookup first, then legacy composite
      const req = bySerial.get(entry.label) ?? byComposite.get(entry.label);
      if (!req) { unmatchedLabels.push(entry.label); continue; }
      if (req.allocated) continue;
      req.allocated = true;

      await prisma.fabRequirementAllocation.deleteMany({ where: { requirementId: req.id } });
      await prisma.fabRequirementAllocation.create({
        data: { requirementId: req.id, slabId: slab.id, allocatedQuantity: entry.qty },
      });
      await prisma.fabRequirement.update({
        where: { id: req.id }, data: { status: "ALLOCATED" },
      });

      applied.push({ reqId: req.id, label: req.label, slabCode, page: slabPlan.page, qty: entry.qty });
    }
  }

  const unmatched = [...bySerial.values()].filter(r => !r.allocated).map(r => r.label);

  return Response.json({
    success: true,
    applied: applied.length,
    appliedList: applied,
    unmatched,
    unmatchedLabels,
  });
}
