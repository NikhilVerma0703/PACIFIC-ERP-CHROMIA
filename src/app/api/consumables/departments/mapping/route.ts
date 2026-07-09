import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const rows = await prisma.$queryRaw<{ department: string; item: string }[]>`
      SELECT DISTINCT d.name as department, ce."itemName" as item
      FROM consumable_consumption_entry ce
      JOIN consumable_department d ON ce."departmentId" = d.id
      ORDER BY d.name, ce."itemName"
    `;

    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!map.has(row.department)) map.set(row.department, []);
      map.get(row.department)!.push(row.item);
    }

    const result = Array.from(map.entries()).map(([department, items]) => ({ department, items }));
    return Response.json(result);
  } catch (error) {
    console.error("Department mapping error:", error);
    return Response.json([], { status: 500 });
  }
}
