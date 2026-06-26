// app/api/fab/parse-excel/route.ts
//
// POST /api/fab/parse-excel
// Body: multipart/form-data  { file: File }
// Returns: { rows, errors, warnings, preview }

import { parseExcelBuffer } from "@/lib/fab/excelParser";
import type { ExcelRow } from "@/lib/fab/excelParser";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) return Response.json({ error: "File too large (max 10 MB)" }, { status: 413 });

    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
      return Response.json(
        { error: "Only .xlsx or .xls files are accepted" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, errors, warnings } = parseExcelBuffer(buffer);

    if (errors.length > 0) {
      return Response.json({ errors, warnings, rows: [] }, { status: 422 });
    }

    // Build a summary preview for the UI
    const totalPieces = rows.reduce((s, r) => s + r.quantity, 0);

    const preview = {
      rowCount: rows.length,
      totalPieces,
      drawings: new Set(rows.map((r) => r.drawingNumber)).size,
      areas: new Set(rows.map((r) => r.areaName)).size,
      sinkPieces: rows.filter((r) => (r.sinkCuts ?? 0) > 0).length,
      warnings,
    };

    return Response.json({ rows, preview, errors: [], warnings });
  } catch (err) {
    console.error("fab/parse-excel error:", err);
    return Response.json(
      { error: "Failed to parse Excel file", detail: String(err) },
      { status: 500 }
    );
  }
}
