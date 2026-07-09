import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request body." }, { status: 400 });

    const { layersUsed, isActive } = body;
    if (layersUsed !== undefined && (!Number.isFinite(Number(layersUsed)) || Number(layersUsed) < 0))
      return Response.json({ error: "layersUsed must be a non-negative number." }, { status: 400 });

    const updated = await prisma.filmRoll.update({
      where: { id },
      data: {
        ...(layersUsed !== undefined && { layersUsed: Math.trunc(Number(layersUsed)) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return Response.json({
      ...updated,
      consumedWeight: updated.layersUsed * updated.weightPerLayer,
      balanceWeight: Math.max(0, updated.initialWeight - updated.layersUsed * updated.weightPerLayer),
    });
  } catch (error) {
    console.error("Film roll PATCH error:", error);
    return Response.json({ error: "Failed to update film roll." }, { status: 500 });
  }
}
