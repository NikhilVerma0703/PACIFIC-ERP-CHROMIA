import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

const IST_MS = 330 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    // IST start-of-today expressed as the equivalent UTC instant.
    const nowIST = new Date(Date.now() + IST_MS);
    const todayStart = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate()) - IST_MS);
    const yesterdayStart = new Date(todayStart.getTime() - DAY);
    const yesterdayEnd = new Date(todayStart.getTime() - 1);

    const [
      inventoryItems,
      directMaterials,
      productionConsumables,
      polishingConsumables,
      activeFilmRolls,
      todayConsumptions,
      yesterdayConsumptions,
    ] = await Promise.all([
      prisma.inventoryStock.findMany(),
      prisma.directMaterial.count(),
      prisma.productionConsumable.count(),
      prisma.polishingConsumable.count(),
      prisma.filmRoll.count({ where: { isActive: true } }),
      prisma.consumptionEntry.findMany({ where: { date: { gte: todayStart } } }),
      prisma.consumptionEntry.findMany({ where: { date: { gte: yesterdayStart, lte: yesterdayEnd } } }),
    ]);

    const totalItems = directMaterials + productionConsumables + polishingConsumables;
    const lowStockItems = inventoryItems.filter((item) => item.currentStock <= item.minStock).length;

    const todayTotal = todayConsumptions.reduce((s, e) => s + e.quantity, 0);
    const yesterdayTotal = yesterdayConsumptions.reduce((s, e) => s + e.quantity, 0);

    const countTrend = yesterdayConsumptions.length > 0 ? todayConsumptions.length - yesterdayConsumptions.length : null;
    const totalTrend = yesterdayTotal > 0 ? todayTotal - yesterdayTotal : null;

    return Response.json({
      totalItems,
      directMaterials,
      productionConsumables,
      polishingConsumables,
      activeFilmRolls,
      lowStockItems,
      todayConsumptions: todayConsumptions.length,
      todayTotal: Math.round(todayTotal * 100) / 100,
      yesterdayConsumptions: yesterdayConsumptions.length,
      yesterdayTotal: Math.round(yesterdayTotal * 100) / 100,
      countTrend,
      totalTrend,
    });
  } catch (error) {
    console.error("KPI API Error:", error);
    return Response.json({ totalItems: 0, directMaterials: 0, productionConsumables: 0, polishingConsumables: 0, activeFilmRolls: 0, lowStockItems: 0, todayConsumptions: 0, todayTotal: 0, yesterdayConsumptions: 0, yesterdayTotal: 0, countTrend: null, totalTrend: null }, { status: 500 });
  }
}
