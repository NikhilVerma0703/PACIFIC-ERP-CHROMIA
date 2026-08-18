import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request body." }, { status: 400 });

    const { name, variant, unit, dailyConsumption, status } = body;

    if (dailyConsumption !== undefined && (!Number.isFinite(Number(dailyConsumption)) || Number(dailyConsumption) < 0))
      return Response.json({ error: "dailyConsumption must be a non-negative number." }, { status: 400 });
    if (status !== undefined && status !== "ACTIVE" && status !== "INACTIVE")
      return Response.json({ error: "status must be ACTIVE or INACTIVE." }, { status: 400 });

    const updated = await prisma.directMaterial.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name) }),
        ...(variant !== undefined && { variant: variant || null }),
        ...(unit !== undefined && { unit: String(unit) }),
        ...(dailyConsumption !== undefined && { dailyConsumption: Number(dailyConsumption) }),
        ...(status !== undefined && { status }),
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Direct material PATCH error:", error);
    return Response.json({ error: "Failed to update direct material." }, { status: 500 });
  }
}
