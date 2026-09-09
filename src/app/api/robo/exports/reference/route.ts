import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { buildReferenceSummary } from "@/lib/robo/referenceData";
import { formatDate, fmtDurationLong } from "@/lib/robo/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Filesystem-safe design name for the download file name. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Design";
}

/**
 * GET /api/robo/exports/reference?design=<Design Name>
 *
 * The one-page Reference Sheet for a design's LATEST production run, as an Excel
 * summary — one information item per row, not slab-by-slab. Values come from
 * buildReferenceSummary (the same source the on-screen preview uses), so the file
 * and the preview always agree, and Total Slabs / Total Production Time / Total
 * Delays match Reports. 404 when the design has no production on record.
 */
export async function GET(req: NextRequest) {
  const design = req.nextUrl.searchParams.get("design")?.trim() || "";
  const summary = design ? await buildReferenceSummary(design) : null;
  if (!summary) {
    return NextResponse.json({ error: "No previous production record found" }, { status: 404 });
  }

  const dash = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? "-" : String(v);

  const programsText = summary.programs.length
    ? summary.programs.map((p) => `${p.robo}: ${p.program}`).join(", ")
    : "-";

  // Robot Delays: applicable G-category delays, else BLANK (the operator's rule —
  // an empty field, not a dash).
  const robotDelaysText = summary.robotDelays.length
    ? summary.robotDelays
        .map((d) => `${d.code} — ${d.description}${d.events > 1 ? ` (${d.events}×)` : ""}`)
        .join("; ")
    : "";

  // The ten items, each on its own row: label in column A, value in column B.
  const items: [string, string][] = [
    ["Production Date", summary.productionDate ? formatDate(summary.productionDate) : "-"],
    ["Batch Number", dash(summary.batchNo)],
    ["Design Name", dash(summary.designName)],
    ["Thickness of Slabs", summary.thickness != null ? `${summary.thickness} cm` : "-"],
    ["Total Slabs Produced", String(summary.totalSlabs)],
    ["Total Production Time", summary.productionTimeMinutes != null ? fmtDurationLong(summary.productionTimeMinutes) : "-"],
    ["Total Delays", fmtDurationLong(summary.totalDelayMins)],
    ["Avg Slabs/hour", summary.avgSlabsPerHour != null ? String(summary.avgSlabsPerHour) : "-"],
    ["Robo Program Names", programsText],
    ["Robot Delays", robotDelaysText],
  ];

  const title = `Reference Sheet — ${summary.designName}`;
  const note =
    "Avg Slabs/hour = Total Slabs ÷ (Total Production Time − actual delay time, overlapping delays counted once). Total Delays above is the Reports total (overlaps included).";

  const aoa: (string | number)[][] = [
    [title],
    [],
    ...items,
    [],
    ["Note", note],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 70 }];

  // Styling: bold title, bold labels down column A, wrapped note.
  const titleCell = ws["A1"];
  if (titleCell) titleCell.s = { font: { bold: true, sz: 14 } };

  const firstItemRow = 2; // 0-based row index of the first item (after title + blank)
  for (let i = 0; i < items.length; i++) {
    const addr = XLSX.utils.encode_cell({ r: firstItemRow + i, c: 0 });
    const cell = ws[addr];
    if (cell) cell.s = { font: { bold: true }, alignment: { vertical: "top" } };
    const valAddr = XLSX.utils.encode_cell({ r: firstItemRow + i, c: 1 });
    const valCell = ws[valAddr];
    if (valCell) valCell.s = { alignment: { vertical: "top", wrapText: true } };
  }
  // Note row: label bold, text wrapped and greyed.
  const noteRow = firstItemRow + items.length + 1;
  const noteLabel = ws[XLSX.utils.encode_cell({ r: noteRow, c: 0 })];
  if (noteLabel) noteLabel.s = { font: { bold: true, italic: true, color: { rgb: "6B7280" } }, alignment: { vertical: "top" } };
  const noteText = ws[XLSX.utils.encode_cell({ r: noteRow, c: 1 })];
  if (noteText) noteText.s = { font: { italic: true, color: { rgb: "6B7280" } }, alignment: { vertical: "top", wrapText: true } };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reference Sheet");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Reference Sheet - ${safeName(summary.designName)}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
