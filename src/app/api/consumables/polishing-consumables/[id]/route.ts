import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request body." }, { status: 400 });

    const { name, unit, dailyConsumption, currentStock, minStock } = body;
    for (const [k, v] of Object.entries({ dailyConsumption, currentStock, minStock })) {
      if (v !== undefined && (!Number.isFinite(Number(v)) || Number(v) < 0))
        return Response.json({ error: k + " must be a non-negative number." }, { status: 400 });
    }

    const updated = await prisma.polishingConsumable.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name) }),
        ...(unit !== undefined && { unit: String(unit) }),
        ...(dailyConsumption !== undefined && { dailyConsumption: Number(dailyConsumption) }),
        ...(currentStock !== undefined && { currentStock: Number(currentStock) }),
        ...(minStock !== undefined && { minStock: Number(minStock) }),
      },
      include: { department: true },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Polishing consumable PATCH error:", error);
    return Response.json({ error: "Failed to update polishing consumable." }, { status: 500 });
  }
}
