import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

const CATEGORIES = ["DIRECT_MATERIAL", "PRODUCTION_CONSUMABLE", "POLISHING_CONSUMABLE"];

// Same 3-state rule the tables use, so API / export / UI all agree.
const statusOf = (cur: number, min: number) =>
  cur <= 0 ? "Out of Stock" : min > 0 && cur <= min ? "Low" : "Healthy";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const items = await prisma.inventoryStock.findMany({ orderBy: { itemName: "asc" } });
    const withStatus = items.map((item) => ({
      ...item,
      status: statusOf(item.currentStock, item.minStock),
    }));
    return Response.json(withStatus);
  } catch (error) {
    console.error("Inventory GET error:", error);
    return Response.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request body." }, { status: 400 });

    const { itemName, category, unit, currentStock, minStock } = body;
    if (!itemName || typeof itemName !== "string")
      return Response.json({ error: "itemName is required." }, { status: 400 });
    if (!unit || typeof unit !== "string")
      return Response.json({ error: "unit is required." }, { status: 400 });

    const cur = Number(currentStock);
    const min = minStock === undefined ? 0 : Number(minStock);
    if (!Number.isFinite(cur) || cur < 0)
      return Response.json({ error: "currentStock must be a non-negative number." }, { status: 400 });
    if (!Number.isFinite(min) || min < 0)
      return Response.json({ error: "minStock must be a non-negative number." }, { status: 400 });

    // Case-insensitive match (aligns with the data importer) -> top up + log, atomically.
    const existing = await prisma.inventoryStock.findFirst({
      where: { itemName: { equals: itemName, mode: "insensitive" } },
    });
    if (existing) {
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.inventoryStock.update({
          where: { id: existing.id },
          data: { currentStock: existing.currentStock + cur },
        });
        // Log the receipt in the item's own (existing) unit to avoid unit drift.
        await tx.inventoryEntry.create({ data: { quantity: cur, unit: existing.unit, inventoryStockId: u.id } });
        return u;
      });
      return Response.json({ ...updated, status: statusOf(updated.currentStock, updated.minStock) });
    }

    if (!category || !CATEGORIES.includes(category))
      return Response.json({ error: "category must be one of " + CATEGORIES.join(", ") + "." }, { status: 400 });

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryStock.create({
        data: { itemName, category, unit, currentStock: cur, minStock: min },
      });
      await tx.inventoryEntry.create({ data: { quantity: cur, unit, inventoryStockId: created.id } });
      return created;
    });

    return Response.json({ ...item, status: statusOf(item.currentStock, item.minStock) }, { status: 201 });
  } catch (error) {
    console.error("Inventory POST error:", error);
    return Response.json({ error: "Failed to save inventory item." }, { status: 500 });
  }
}
