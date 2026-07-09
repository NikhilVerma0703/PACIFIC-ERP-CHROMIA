import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const consumables = await prisma.polishingConsumable.findMany({
      include: { department: true },
      orderBy: { name: "asc" },
    });
    return Response.json(consumables);
  } catch (error) {
    console.error("Polishing consumables GET error:", error);
    return Response.json([], { status: 500 });
  }
}
