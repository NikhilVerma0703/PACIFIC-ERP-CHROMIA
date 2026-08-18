import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { fmtDurationLong, machineLabel } from "@/lib/robo/utils";

const COLUMNS = [
  "S.No.", "Production Date", "Shift", "Delay Code", "Description", "Category",
  "Machine", "Slab No.", "Start Time", "End Time", "Duration (min)", "Remarks",
];

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : v;

/** GET /api/robo/exports/delays?date=YYYY-MM-DD — omit date for every delay to date. */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date")?.trim() || "";

  const delays = await prisma.roboDelayLog.findMany({
    where: date ? { shift: { date } } : {},
    include: {
      shift: true,
      delayCode: true,
      machine: true,
      productionRecord: true,
    },
    orderBy: [{ shift: { date: "asc" } }, { createdAt: "asc" }],
  });

  const rows: Record<string, string | number>[] = delays.map((d, i) => ({
    "S.No.":            i + 1,
    "Production Date":  String(dash(d.shift?.date)),
    "Shift":            String(dash(d.shift?.shiftNumber)),
    "Delay Code":       d.delayCode.code,
    "Description":      d.delayCode.description,
    "Category":         d.delayCode.category,
    // Shop-floor name, matching every screen — see the note in the production export.
    "Machine":          String(dash(machineLabel(d.machineName || d.machine?.name))),
    "Slab No.":         String(dash(d.productionRecord?.slabNumber)),
    "Start Time":       String(dash(d.startTime)),
    "End Time":         String(dash(d.endTime)),
    "Duration (min)":   d.durationMinutes,
    "Remarks":          String(dash(d.remarks)),
  }));

  const totalMins = delays.reduce((s, d) => s + d.durationMinutes, 0);

  // Total delay duration at the end of the sheet — numeric sum plus a readable form.
  rows.push({});
  rows.push({
    "Description":     "TOTAL DELAY DURATION",
    "Duration (min)":  totalMins,
    "Remarks":         fmtDurationLong(totalMins),
  });
  rows.push({
    "Description":     "Delay Events",
    "Duration (min)":  delays.length,
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  ws["!cols"] = [
    { wch: 7 }, { wch: 15 }, { wch: 7 }, { wch: 12 }, { wch: 38 }, { wch: 15 },
    { wch: 13 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 15 }, { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Delay List`.slice(0, 31));

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Delay_List_${date || "All"}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
