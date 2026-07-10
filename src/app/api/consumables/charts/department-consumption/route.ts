import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    // Entries per department. Quantities of different units aren't summable,
    // so this measures consumption activity (number of entries).
    const results = await prisma.$queryRaw<{ department: string; total: number }[]>`
      SELECT d.name as department, COUNT(*)::int as total
      FROM consumable_consumption_entry ce
      JOIN consumable_department d ON ce."departmentId" = d.id
      GROUP BY d.name
      ORDER BY total DESC
    `;

    return Response.json(results.map((r) => ({ department: r.department, total: Number(r.total) })));
  } catch (error) {
    console.error("Department consumption API error:", error);
    return Response.json([], { status: 500 });
  }
}
