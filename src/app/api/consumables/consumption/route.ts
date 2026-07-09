import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const entries = await prisma.consumptionEntry.findMany({
      include: { department: true },
      orderBy: { date: "desc" },
      take: 1000,
      where: {
        ...(dateFrom && { date: { gte: new Date(dateFrom + "T00:00:00.000Z") } }),
        ...(dateTo && { date: { lte: new Date(dateTo + "T23:59:59.999Z") } }),
      },
    });

    return Response.json(entries);
  } catch (error) {
    console.error("Consumption GET error:", error);
    return Response.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { departmentId, itemName, quantity, unit, remarks, inventoryStockId } = body;
    const qty = Number(quantity);

    if (!departmentId || typeof departmentId !== "string")
      return Response.json({ error: "departmentId is required." }, { status: 400 });
    if (!itemName || typeof itemName !== "string")
      return Response.json({ error: "itemName is required." }, { status: 400 });
    if (!unit || typeof unit !== "string")
      return Response.json({ error: "unit is required." }, { status: 400 });
    if (!Number.isFinite(qty) || qty <= 0)
      return Response.json({ error: "quantity must be a positive number." }, { status: 400 });

    // Create the entry and decrement linked stock atomically.
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.consumptionEntry.create({
        data: {
          departmentId,
          itemName,
          quantity: qty,
          unit,
          remarks: remarks || null,
          inventoryStockId: inventoryStockId || null,
        },
        include: { department: true },
      });

      if (inventoryStockId) {
        // Atomic decrement with a floor at 0 — stock can't go negative.
        await tx.$executeRaw`UPDATE consumable_inventory_stock SET "currentStock" = GREATEST(0, "currentStock" - ${qty}) WHERE "id" = ${inventoryStockId}`;
      }

      return created;
    });

    return Response.json(entry, { status: 201 });
  } catch (error) {
    console.error("Consumption POST error:", error);
    return Response.json({ error: "Failed to save consumption entry." }, { status: 500 });
  }
}
