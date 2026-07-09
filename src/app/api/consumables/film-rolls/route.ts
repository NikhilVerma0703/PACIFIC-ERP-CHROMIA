import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

const balance = (initial: number, layers: number, perLayer: number) =>
  Math.max(0, initial - layers * perLayer);

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const rolls = await prisma.filmRoll.findMany({ orderBy: { rollNumber: "asc" } });
    const withCalculated = rolls.map((roll) => ({
      ...roll,
      consumedWeight: roll.layersUsed * roll.weightPerLayer,
      balanceWeight: balance(roll.initialWeight, roll.layersUsed, roll.weightPerLayer),
    }));
    return Response.json(withCalculated);
  } catch (error) {
    console.error("Film rolls GET error:", error);
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

    const { rollNumber, filmType, machine, initialWeight, layersUsed, weightPerLayer, isActive } = body;
    if (!rollNumber || typeof rollNumber !== "string")
      return Response.json({ error: "rollNumber is required." }, { status: 400 });
    if (!filmType || typeof filmType !== "string")
      return Response.json({ error: "filmType is required." }, { status: 400 });
    if (!machine || typeof machine !== "string")
      return Response.json({ error: "machine is required." }, { status: 400 });

    const init = Number(initialWeight);
    const perLayer = Number(weightPerLayer);
    const layers = layersUsed === undefined ? 0 : Number(layersUsed);
    if (!Number.isFinite(init) || init <= 0)
      return Response.json({ error: "initialWeight must be a positive number." }, { status: 400 });
    if (!Number.isFinite(perLayer) || perLayer <= 0)
      return Response.json({ error: "weightPerLayer must be a positive number." }, { status: 400 });
    if (!Number.isFinite(layers) || layers < 0)
      return Response.json({ error: "layersUsed must be a non-negative number." }, { status: 400 });

    const roll = await prisma.filmRoll.create({
      data: {
        rollNumber,
        filmType,
        machine,
        initialWeight: init,
        layersUsed: Math.trunc(layers),
        weightPerLayer: perLayer,
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });
    return Response.json(
      {
        ...roll,
        consumedWeight: roll.layersUsed * roll.weightPerLayer,
        balanceWeight: balance(roll.initialWeight, roll.layersUsed, roll.weightPerLayer),
      },
      { status: 201 }
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return Response.json({ error: "A film roll with that roll number already exists." }, { status: 409 });
    }
    console.error("Film rolls POST error:", error);
    return Response.json({ error: "Failed to create film roll." }, { status: 500 });
  }
}
