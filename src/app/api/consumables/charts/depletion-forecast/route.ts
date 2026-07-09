import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const items = await prisma.inventoryStock.findMany({
      include: { consumptionEntries: { select: { quantity: true, date: true } } },
    });

    const DAY = 24 * 60 * 60 * 1000;

    const results = items
      .map((item) => {
        const entries = item.consumptionEntries;
        if (entries.length === 0) return null;

        const totalQty = entries.reduce((sum, e) => sum + e.quantity, 0);

        // Average over the ELAPSED window (first -> last entry, inclusive),
        // not just the days that happened to have a consumption record.
        const times = entries.map((e) => new Date(e.date).getTime());
        const spanDays = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / DAY) + 1);
        const avgDailyConsumption = totalQty / spanDays;

        if (item.currentStock <= 0) {
          return {
            itemName: item.itemName,
            unit: item.unit,
            currentStock: item.currentStock,
            avgDailyConsumption: Math.round(avgDailyConsumption * 100) / 100,
            daysRemaining: 0,
            forecastDate: "Out of stock",
            status: "out" as const,
          };
        }

        if (avgDailyConsumption <= 0) return null;

        const daysRemaining = item.currentStock / avgDailyConsumption;
        const forecastDate = new Date(Date.now() + daysRemaining * DAY).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        });

        const status: "critical" | "warning" | "ok" =
          daysRemaining <= 7 ? "critical" : daysRemaining <= 14 ? "warning" : "ok";

        return {
          itemName: item.itemName,
          unit: item.unit,
          currentStock: Math.round(item.currentStock * 100) / 100,
          avgDailyConsumption: Math.round(avgDailyConsumption * 100) / 100,
          daysRemaining: Math.min(90, Math.round(daysRemaining * 10) / 10),
          forecastDate,
          status,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a!.daysRemaining - b!.daysRemaining)
      .slice(0, 12);

    return Response.json(results);
  } catch (error) {
    console.error("Depletion forecast error:", error);
    return Response.json([], { status: 500 });
  }
}
