import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { canManageRm } from "@/lib/rbac";
import { getRmStock } from "@/lib/rmStock";

export const dynamic = "force-dynamic";

/**
 * Store Incharge / Admin: current RM stock as a real workbook.
 *
 * WHY THIS IS NOT A CSV ANY MORE. Stock is three differently-shaped tables —
 * materials (7 columns), resin storage tanks (6), resin daily tanks (8) — and
 * the previous version stacked all three into one CSV separated by blank lines
 * and section titles. The file itself was well-formed: BOM, CRLF, quoted cells,
 * formula-injection neutralised. It just cannot survive the format. A CSV holds
 * ONE table, so Excel laid three sets of headings and three column widths over a
 * single grid and produced exactly the jumble it was reported as.
 *
 * One sheet per table fixes it at the cause rather than tidying the symptom.
 *
 * Numbers are written as NUMBERS, not strings. In the CSV a kilo figure arrived
 * as text the moment it carried a separator, so the column would not sum — which
 * is most of what anybody opens a stock file to do.
 */

/** Excel evaluates a string cell that opens with a formula character. Numbers are
 *  written as numbers and are unaffected; only free text needs the guard. */
function safeText(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** A finite number stays a number so the column adds up; anything else becomes "". */
function numCell(v: unknown): number | string {
  return typeof v === "number" && Number.isFinite(v) ? v : "";
}

function sheet(head: string[], rows: unknown[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  // Freeze the header so a long stock list stays readable while scrolling.
  ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  return ws;
}

export async function GET() {
  if (!(await canManageRm())) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const s = await getRmStock();
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, sheet(
      ["Type", "Size", "Grade", "Supplier", "Bags", "Kg", "Invoices (inv:bags)"],
      [...s.grit, ...s.filler, ...s.other].map((g) => [
        safeText(g.type), safeText(g.size), safeText(g.grade), safeText(g.supplier),
        numCell(g.bags), numCell(g.kg),
        safeText(g.invoices.map((i) => `${i.invNo}:${i.bags}`).join("; ")),
      ]),
      [16, 12, 14, 26, 8, 12, 40],
    ), "Materials");

    XLSX.utils.book_append_sheet(wb, sheet(
      ["Tank", "Supplier", "Invoice", "Remaining (kg)", "Quantity (kg)", "Active"],
      s.resin.map((r) => [
        safeText(r.tankNo), safeText(r.supplier), safeText(r.invNo),
        numCell(r.remaining), numCell(r.quantity), r.active ? "yes" : "no",
      ]),
      [10, 26, 18, 16, 16, 8],
    ), "Resin storage tanks");

    XLSX.utils.book_append_sheet(wb, sheet(
      ["Tank", "Remaining (kg)", "Quantity (kg)", "Silane", "Cobalt", "Incharge", "Status", "Deficit (kg)"],
      s.daily.map((d) => [
        safeText(d.tankNo), numCell(d.remaining), numCell(d.quantity),
        numCell(d.silane), numCell(d.cobalt),
        safeText(d.incharge ?? ""), safeText(d.status ?? ""), numCell(d.deficit),
      ]),
      [10, 16, 16, 10, 10, 18, 14, 14],
    ), "Resin daily tanks");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const fname = `rm-stock-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  } catch (e) {
    console.error("RM stock export error:", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
