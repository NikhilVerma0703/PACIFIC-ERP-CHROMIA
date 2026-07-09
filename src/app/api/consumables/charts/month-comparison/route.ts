import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

const IST_MS = 330 * 60 * 1000;

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const nowIST = new Date(Date.now() + IST_MS);
    const y = nowIST.getUTCFullYear();
    const m = nowIST.getUTCMonth();

    // IST month boundaries expressed as the equivalent UTC instants.
    const thisMonthStart = new Date(Date.UTC(y, m, 1) - IST_MS);
    const lastMonthStart = new Date(Date.UTC(y, m - 1, 1) - IST_MS);
    const lastMonthEnd = new Date(thisMonthStart.getTime() - 1);

    const [thisMonth, lastMonth] = await Promise.all([
      prisma.$queryRaw<{ department: string; total: number }[]>`
        SELECT d.name as department, COUNT(*)::int as total
        FROM consumable_consumption_entry ce
        JOIN consumable_department d ON ce."departmentId" = d.id
        WHERE ce.date >= ${thisMonthStart}
        GROUP BY d.name
        ORDER BY total DESC
      `,
      prisma.$queryRaw<{ department: string; total: number }[]>`
        SELECT d.name as department, COUNT(*)::int as total
        FROM consumable_consumption_entry ce
        JOIN consumable_department d ON ce."departmentId" = d.id
        WHERE ce.date >= ${lastMonthStart} AND ce.date <= ${lastMonthEnd}
        GROUP BY d.name
        ORDER BY total DESC
      `,
    ]);

    const deptMap = new Map<string, { thisMonth: number; lastMonth: number }>();
    for (const r of thisMonth) deptMap.set(r.department, { thisMonth: Number(r.total), lastMonth: 0 });
    for (const r of lastMonth) {
      const existing = deptMap.get(r.department);
      if (existing) existing.lastMonth = Number(r.total);
      else deptMap.set(r.department, { thisMonth: 0, lastMonth: Number(r.total) });
    }

    const result = Array.from(deptMap.entries())
      .map(([department, vals]) => ({ department, thisMonth: vals.thisMonth, lastMonth: vals.lastMonth }))
      .sort((a, b) => b.thisMonth - a.thisMonth);

    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    const thisMonthName = fmt(new Date(Date.UTC(y, m, 1)));
    const lastMonthName = fmt(new Date(Date.UTC(y, m - 1, 1)));

    return Response.json({ data: result, thisMonthName, lastMonthName });
  } catch (error) {
    console.error("Month comparison error:", error);
    return Response.json({ data: [], thisMonthName: "", lastMonthName: "" }, { status: 500 });
  }
}
