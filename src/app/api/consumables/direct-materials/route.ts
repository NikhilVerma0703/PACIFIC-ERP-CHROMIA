import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const materials = await prisma.directMaterial.findMany({
      orderBy: [{ name: "asc" }, { variant: "asc" }],
    });
    return Response.json(materials);
  } catch (error) {
    console.error("Direct materials GET error:", error);
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

    const { name, variant, unit, dailyConsumption, status } = body;
    if (!name || typeof name !== "string")
      return Response.json({ error: "name is required." }, { status: 400 });
    if (!unit || typeof unit !== "string")
      return Response.json({ error: "unit is required." }, { status: 400 });

    const daily = dailyConsumption === undefined ? 0 : Number(dailyConsumption);
    if (!Number.isFinite(daily) || daily < 0)
      return Response.json({ error: "dailyConsumption must be a non-negative number." }, { status: 400 });
    if (status !== undefined && status !== "ACTIVE" && status !== "INACTIVE")
      return Response.json({ error: "status must be ACTIVE or INACTIVE." }, { status: 400 });

    const material = await prisma.directMaterial.create({
      data: {
        name,
        variant: variant ? String(variant) : null,
        unit,
        dailyConsumption: daily,
        ...(status !== undefined && { status }),
      },
    });
    return Response.json(material, { status: 201 });
  } catch (error) {
    console.error("Direct materials POST error:", error);
    return Response.json({ error: "Failed to create direct material." }, { status: 500 });
  }
}
