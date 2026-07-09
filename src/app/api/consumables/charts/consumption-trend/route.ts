import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { searchParams } = new URL(request.url);
    const parsed = parseInt(searchParams.get("days") || "30", 10);
    const days = Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 30;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Count consumption events per IST calendar day. Quantities can't be summed
    // across different units, so the trend tracks consumption activity (entries).
    const results = await prisma.$queryRaw<{ day: Date; total: number }[]>`
      SELECT DATE("date" + interval '330 minutes') as day, COUNT(*)::int as total
      FROM consumable_consumption_entry
      WHERE "date" >= ${cutoff}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const formatted = results.map((r) => ({
      date: new Date(r.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }),
      total: Number(r.total),
    }));

    return Response.json(formatted);
  } catch (error) {
    console.error("Consumption trend API error:", error);
    return Response.json([], { status: 500 });
  }
}
