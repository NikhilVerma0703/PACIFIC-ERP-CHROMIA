import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    // Only show items with stock configured (either has stock or has a min threshold)
    const items = await prisma.inventoryStock.findMany({
      where: {
        OR: [{ currentStock: { gt: 0 } }, { minStock: { gt: 0 } }],
      },
      select: {
        itemName: true,
        currentStock: true,
        minStock: true,
      },
      orderBy: { currentStock: "asc" },
      take: 10,
    });

    return Response.json(items);
  } catch (error) {
    console.error("Inventory health API error:", error);
    return Response.json([], { status: 500 });
  }
}
