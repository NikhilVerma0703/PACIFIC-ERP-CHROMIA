import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request body." }, { status: 400 });

    const { currentStock, minStock, maxStock } = body;
    const bad = (v: unknown) => !Number.isFinite(Number(v)) || Number(v) < 0;
    if (currentStock !== undefined && bad(currentStock))
      return Response.json({ error: "currentStock must be a non-negative number." }, { status: 400 });
    if (minStock !== undefined && bad(minStock))
      return Response.json({ error: "minStock must be a non-negative number." }, { status: 400 });
    if (maxStock !== undefined && bad(maxStock))
      return Response.json({ error: "maxStock must be a non-negative number." }, { status: 400 });

    const updated = await prisma.inventoryStock.update({
      where: { id },
      data: {
        ...(currentStock !== undefined && { currentStock: Number(currentStock) }),
        ...(minStock !== undefined && { minStock: Number(minStock) }),
        ...(maxStock !== undefined && { maxStock: Number(maxStock) }),
      },
    });

    const status = updated.currentStock <= updated.minStock ? "Low" : "Healthy";
    return Response.json({ ...updated, status });
  } catch (error) {
    console.error("Inventory PATCH error:", error);
    return Response.json({ error: "Failed to update inventory item." }, { status: 500 });
  }
}
