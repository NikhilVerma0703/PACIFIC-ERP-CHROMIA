import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const consumables = await prisma.productionConsumable.findMany({
      include: { department: true },
      orderBy: { name: "asc" },
    });
    return Response.json(consumables);
  } catch (error) {
    console.error("Production consumables GET error:", error);
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

    const { name, unit, dailyConsumption, currentStock, minStock, departmentId } = body;
    if (!name || typeof name !== "string")
      return Response.json({ error: "name is required." }, { status: 400 });
    if (!unit || typeof unit !== "string")
      return Response.json({ error: "unit is required." }, { status: 400 });
    if (!departmentId || typeof departmentId !== "string")
      return Response.json({ error: "departmentId is required." }, { status: 400 });

    const daily = dailyConsumption === undefined ? 0 : Number(dailyConsumption);
    const cur = currentStock === undefined ? 0 : Number(currentStock);
    const min = minStock === undefined ? 0 : Number(minStock);
    if (![daily, cur, min].every((n) => Number.isFinite(n) && n >= 0))
      return Response.json({ error: "dailyConsumption, currentStock and minStock must be non-negative numbers." }, { status: 400 });

    const consumable = await prisma.productionConsumable.create({
      data: { name, unit, dailyConsumption: daily, currentStock: cur, minStock: min, departmentId },
      include: { department: true },
    });
    return Response.json(consumable, { status: 201 });
  } catch (error) {
    console.error("Production consumables POST error:", error);
    return Response.json({ error: "Failed to create production consumable." }, { status: 500 });
  }
}
