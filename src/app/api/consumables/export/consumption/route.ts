import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

// Escape a value for safe CSV: neutralise formula-injection triggers (=,+,-,@,tab,CR)
// and wrap every field in quotes with internal quotes doubled.
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const department = searchParams.get("department") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";

    const entries = await prisma.consumptionEntry.findMany({
      include: { department: true },
      orderBy: { date: "desc" },
      where: {
        ...(department && { department: { name: department } }),
        ...(search && { itemName: { contains: search, mode: "insensitive" } }),
        ...(dateFrom && { date: { gte: new Date(dateFrom + "T00:00:00.000Z") } }),
        ...(dateTo && { date: { lte: new Date(dateTo + "T23:59:59.999Z") } }),
      },
    });

    const header = "Date,Department,Item Name,Quantity,Unit";
    const rows = entries.map((e) => {
      const date = new Date(e.date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      return [csvCell(date), csvCell(e.department.name), csvCell(e.itemName), csvCell(e.quantity), csvCell(e.unit)].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const today = new Date().toISOString().split("T")[0];

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="consumption-report-${today}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export consumption error:", error);
    return Response.json({ error: "Failed to export consumption." }, { status: 500 });
  }
}
