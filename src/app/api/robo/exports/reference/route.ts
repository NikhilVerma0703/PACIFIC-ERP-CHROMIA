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

  // Each information item on its own row: label in column A, value in column B.
  // Single-value items first; Robo Program Names and Robot Delays then get ONE ROW
  // PER program / per robot-delay code.
  const rows: [string, string][] = [
    ["Production Date", summary.productionDate ? formatDate(summary.productionDate) : "-"],
    ["Batch Number", dash(summary.batchNo)],
    ["Design Name", dash(summary.designName)],
    ["Thickness of Slabs", summary.thickness != null ? `${summary.thickness} cm` : "-"],
    ["Total Slabs Produced", String(summary.totalSlabs)],
    ["Total Production Time", summary.productionTimeMinutes != null ? fmtDurationLong(summary.productionTimeMinutes) : "-"],
    ["Total Delays", fmtDurationLong(summary.totalDelayMins)],
    ["Avg Slabs/hour", summary.avgSlabsPerHour != null ? String(summary.avgSlabsPerHour) : "-"],
  ];

  // Robo Program Names — one row per program (Robo1: <program>), only the Robos
  // actually used in this run. The label sits on the first program's row.
  if (summary.programs.length) {
    summary.programs.forEach((p, i) =>
      rows.push([i === 0 ? "Robo Program Names" : "", `${p.robo}: ${p.program}`]),
    );
  } else {
    rows.push(["Robo Program Names", "-"]);
  }

  // Robot Delays — one row per robot-delay code: its description, the Robos
  // responsible, and the combined duration of every entry of that code.
  if (summary.robotDelays.length) {
    summary.robotDelays.forEach((d, i) =>
      rows.push([
        i === 0 ? "Robot Delays" : "",
        `${d.code} — ${d.description}${d.robos.length ? ` (${d.robos.join(", ")})` : ""} → ${fmtDurationLong(d.minutes)}`,
      ]),
    );
  } else {
    rows.push(["Robot Delays", "-"]);
  }

  const title = `Reference Sheet — ${summary.designName}`;
  const aoa: (string | number)[][] = [[title], [], ...rows];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 70 }];

  // Styling: bold title; bold each label in column A (skip the blank continuation
  // rows of the multi-row sections); value cells wrap.
  const titleCell = ws["A1"];
  if (titleCell) titleCell.s = { font: { bold: true, sz: 14 } };

  const firstRow = 2; // 0-based row index of the first item (after title + blank)
  rows.forEach((r, i) => {
    const labelCell = ws[XLSX.utils.encode_cell({ r: firstRow + i, c: 0 })];
    if (labelCell && r[0]) labelCell.s = { font: { bold: true }, alignment: { vertical: "top" } };
    const valCell = ws[XLSX.utils.encode_cell({ r: firstRow + i, c: 1 })];
    if (valCell) valCell.s = { alignment: { vertical: "top", wrapText: true } };
  });

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
