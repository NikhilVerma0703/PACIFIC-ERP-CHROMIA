import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

// Escape a value for safe CSV: neutralise formula-injection triggers (=,+,-,@,tab,CR)
// and wrap every field in quotes with internal quotes doubled.
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

// Same 3-state rule the tables use.
const statusOf = (cur: number, min: number) =>
  cur <= 0 ? "Out of Stock" : min > 0 && cur <= min ? "Low" : "Healthy";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const items = await prisma.inventoryStock.findMany({ orderBy: { itemName: "asc" } });

    const formatCategory = (cat: string) =>
      cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

    const header = "Item Name,Category,Unit,Current Stock,Min Stock,Max Stock,Status";
    const rows = items.map((item) => {
      return [
        csvCell(item.itemName),
        csvCell(formatCategory(item.category)),
        csvCell(item.unit),
        csvCell(item.currentStock),
        csvCell(item.minStock),
        csvCell(item.maxStock ?? 0),
        csvCell(statusOf(item.currentStock, item.minStock)),
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const today = new Date().toISOString().split("T")[0];

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="inventory-report-${today}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export inventory error:", error);
    return Response.json({ error: "Failed to export inventory." }, { status: 500 });
  }
}
