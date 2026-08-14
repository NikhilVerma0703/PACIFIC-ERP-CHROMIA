import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { machineLabel } from "@/lib/robo/utils";

export async function GET(req: NextRequest) {
  const shiftId = req.nextUrl.searchParams.get("shiftId");
  if (!shiftId) return NextResponse.json({ error: "shiftId required" }, { status: 400 });

  const shift = await prisma.roboShift.findUnique({
    where: { id: shiftId },
    include: {
      delayLogs: {
        include: { delayCode: true, machine: true, productionRecord: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  // Build rows
  const rows = shift.delayLogs.map((d, i) => ({
    "S.No": i + 1,
    "Delay Code": d.delayCode.code,
    "Description": d.delayCode.description,
    "Category": d.delayCode.category,
    // Shop-floor name, matching every screen — see the note in the production export.
    "Machine": machineLabel(d.machineName || d.machine?.name) || "—",
    "Slab No.": d.productionRecord?.slabNumber || "—",
    "Start Time": d.startTime || "—",
    "End Time": d.endTime || "—",
    "Duration (min)": d.durationMinutes,
    "Remarks": d.remarks || "",
  }));

  // Summary row
  const totalMins = shift.delayLogs.reduce((s, d) => s + d.durationMinutes, 0);
  rows.push({
    "S.No": null as unknown as number,
    "Delay Code": "",
    "Description": "",
    "Category": "",
    "Machine": "",
    "Slab No.": "",
    "Start Time": "",
    "End Time": "TOTAL",
    "Duration (min)": totalMins,
    "Remarks": "",
  });

  // Create workbook
  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  ws["!cols"] = [
    { wch: 6 },   // S.No
    { wch: 12 },  // Delay Code
    { wch: 35 },  // Description
    { wch: 16 },  // Category
    { wch: 14 },  // Machine
    { wch: 12 },  // Slab No.
    { wch: 12 },  // Start Time
    { wch: 12 },  // End Time
    { wch: 14 },  // Duration (min)
    { wch: 30 },  // Remarks
  ];

  const wb = XLSX.utils.book_new();
  const sheetName = `Shift ${shift.shiftNumber} - ${shift.date}`;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  // Generate buffer
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = `Delay_Report_Shift${shift.shiftNumber}_${shift.date}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
