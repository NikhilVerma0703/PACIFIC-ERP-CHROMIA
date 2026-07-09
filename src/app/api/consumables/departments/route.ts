import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const departments = await prisma.consumableDepartment.findMany({ orderBy: { name: "asc" } });
    return Response.json(departments);
  } catch (error) {
    console.error("Departments GET error:", error);
    return Response.json([], { status: 500 });
  }
}
