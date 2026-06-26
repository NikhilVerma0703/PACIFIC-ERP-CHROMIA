// POST /api/fab/approve-slab
// Body: { slabId: string }
// Supervisor approves a slab — creates a FabSlabJob (status READY) so it
// appears in the cutting queue. Idempotent: if a READY/IN_PROGRESS job
// already exists it returns it unchanged.

import { NextRequest } from "next/server";
import { fabGate } from "@/lib/fab/access";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { slabId } = await req.json() as { slabId?: string };
  if (!slabId) return Response.json({ error: "slabId required" }, { status: 400 });

  const slab = await prisma.fabSlab.findUnique({ where: { id: slabId } });
  if (!slab) return Response.json({ error: "Slab not found" }, { status: 404 });

  // Idempotent: return existing active job if present
  const existing = await prisma.fabSlabJob.findFirst({
    where: { slabId, status: { in: ["READY", "IN_PROGRESS"] } },
  });
  if (existing) return Response.json({ slabJobId: existing.id, status: existing.status, created: false });

  const job = await prisma.fabSlabJob.create({
    data: { slabId, status: "READY" },
  });

  return Response.json({ slabJobId: job.id, status: job.status, created: true });
}
