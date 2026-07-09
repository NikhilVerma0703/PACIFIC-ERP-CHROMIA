import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    // Group by item AND unit so quantities of different units are never summed.
    const results = await prisma.$queryRaw<{ itemName: string; total: number; unit: string }[]>`
      SELECT "itemName", "unit", CAST(SUM(quantity) AS FLOAT) as total
      FROM consumable_consumption_entry
      GROUP BY "itemName", "unit"
      ORDER BY total DESC
      LIMIT 10
    `;

    return Response.json(
      results.map((r) => ({
        itemName: r.itemName,
        total: Math.round(Number(r.total) * 100) / 100,
        unit: r.unit,
      }))
    );
  } catch (error) {
    console.error("Top items error:", error);
    return Response.json([], { status: 500 });
  }
}
