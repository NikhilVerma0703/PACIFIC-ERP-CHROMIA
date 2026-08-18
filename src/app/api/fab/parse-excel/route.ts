// RETIRED 2026-08 -- superseded fabrication intake.
//
// The old Drawing Summary Excel parser: it read a drawing-per-row workbook and
// handed the result to the legacy project create at POST /api/fab/projects.
//
// Replaced mid-2026 by the manager PO intake: the manager creates the project and
// its POs by hand at /fab/manager, then uploads each PO document to
// /api/fab/manager/pos/parse (preview) and /api/fab/manager/pos/import (confirm),
// which read the PO's own piece table instead of a Drawing Summary.
//
// HOW THIS IS RETIRED. The file stays in the tree, so the URL stays routable;
// every handler it used to export now returns 410 Gone naming the replacement,
// rather than being deleted (which would 404) or left with no handler (which
// would 405 and read like a bug). The original implementation is preserved
// underneath, commented out line by line -- comment it out, do not delete it.

const GONE =
  "This endpoint has been retired. The Drawing Summary Excel intake was replaced by the manager purchase-order intake: create the project and its PO under /fab/manager, then upload the PO document there.";

export async function POST() {
  return Response.json({ error: GONE }, { status: 410 });
}

/* ---- original implementation, retired 2026-08 -------------------------- */
// // app/api/fab/parse-excel/route.ts
// //
// // POST /api/fab/parse-excel
// // Body: multipart/form-data  { file: File }
// // Returns: { rows, errors, warnings, preview }
//
// import { parseExcelBuffer } from "@/lib/fab/excelParser";
// import type { ExcelRow } from "@/lib/fab/excelParser";
// import { fabGate } from "@/lib/fab/access";
//
// export async function POST(req: Request) {
//   const g = await fabGate("SUPERVISOR");
//   if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
//
//   try {
//     const formData = await req.formData();
//     const file = formData.get("file") as File | null;
//
//     if (!file) {
//       return Response.json({ error: "No file uploaded" }, { status: 400 });
//     }
//
//     if (file.size > 10 * 1024 * 1024) return Response.json({ error: "File too large (max 10 MB)" }, { status: 413 });
//
//     const allowedTypes = [
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//       "application/vnd.ms-excel",
//       "application/octet-stream",
//     ];
//     if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
//       return Response.json(
//         { error: "Only .xlsx or .xls files are accepted" },
//         { status: 400 }
//       );
//     }
//
//     const buffer = Buffer.from(await file.arrayBuffer());
//     const { rows, errors, warnings } = parseExcelBuffer(buffer);
//
//     if (errors.length > 0) {
//       return Response.json({ errors, warnings, rows: [] }, { status: 422 });
//     }
//
//     // Build a summary preview for the UI
//     const totalPieces = rows.reduce((s, r) => s + r.quantity, 0);
//
//     const preview = {
//       rowCount: rows.length,
//       totalPieces,
//       drawings: new Set(rows.map((r) => r.drawingNumber)).size,
//       areas: new Set(rows.map((r) => r.areaName)).size,
//       sinkPieces: rows.filter((r) => (r.sinkCuts ?? 0) > 0).length,
//       warnings,
//     };
//
//     return Response.json({ rows, preview, errors: [], warnings });
//   } catch (err) {
//     console.error("fab/parse-excel error:", err);
//     return Response.json(
//       { error: "Failed to parse Excel file", detail: String(err) },
//       { status: 500 }
//     );
//   }
// }
