import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { fmtDurationLong, slabStatusLabel } from "@/lib/robo/utils";

const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];

const RECORD_COLUMNS = [
  "S.No.", "Production Date", "Shift", "Operator", "Design Name", "Thickness (cm)",
  "Slab Number", "In Time", "Out Time",
  "RoyMix Body Weight (kg)", "RoyMix Cycle Time (sec)",
  "Status", "Delay Codes", "Total Delay", "Remarks",
];

const SETUP_COLUMNS = [
  "Production Date", "Shift", "Design Name", "Thickness (cm)", "Target Slabs",
  "Machine", "Program Name", "Tool Name", "Target Cycle Time (sec)",
  "Liquid Name", "Powder Name", "Roller Height (mm)", "Notes",
];

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : v;

/** GET /api/robo/exports/production?date=YYYY-MM-DD — omit date for every record to date. */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date")?.trim() || "";

  const records = await prisma.roboProductionRecord.findMany({
    where: date ? { shift: { date } } : {},
    include: {
      shift: true,
      batchRecipe: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ shift: { date: "asc" } }, { createdAt: "asc" }],
  });

  const rows = records.map((r, i) => {
    const delayMins = r.delayLogs.reduce((s, d) => s + d.durationMinutes, 0);
    return {
      "S.No.":                    r.serialNumber ?? i + 1,
      "Production Date":          dash(r.shift?.date),
      "Shift":                    dash(r.shift?.shiftNumber),
      "Operator":                 dash(r.shift?.operatorName),
      "Design Name":              dash(r.batchRecipe?.designName),
      "Thickness (cm)":           dash(r.batchRecipe?.thickness),
      "Slab Number":              dash(r.slabNumber),
      "In Time":                  dash(r.inTime),
      "Out Time":                 dash(r.outTime),
      "RoyMix Body Weight (kg)":  dash(r.roymixBodyWeight),
      "RoyMix Cycle Time (sec)":  dash(r.roymixCycleTime),
      "Status":                   slabStatusLabel(r.status),
      "Delay Codes":              r.delayLogs.length ? r.delayLogs.map(d => d.delayCode.code).join(", ") : "-",
      "Total Delay":              delayMins > 0 ? fmtDurationLong(delayMins) : "-",
      "Remarks":                  dash(r.remarks),
    };
  });

  const totalSlabDelay = records.reduce(
    (s, r) => s + r.delayLogs.reduce((x, d) => x + d.durationMinutes, 0), 0
  );

  rows.push({} as (typeof rows)[number]);
  rows.push({
    "Slab Number": "TOTAL",
    "Status": `${records.length} records`,
    "Total Delay": fmtDurationLong(totalSlabDelay),
  } as (typeof rows)[number]);

  const wsRecords = XLSX.utils.json_to_sheet(rows, { header: RECORD_COLUMNS });
  wsRecords["!cols"] = [
    { wch: 7 }, { wch: 15 }, { wch: 7 }, { wch: 16 }, { wch: 22 }, { wch: 13 },
    { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 21 }, { wch: 21 },
    { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 30 },
  ];

  /* Second sheet: the production setup each slab was produced under. */
  const setups = await prisma.roboBatchRecipe.findMany({
    where: date ? { shift: { date } } : {},
    include: { shift: true, entries: { include: { machine: true } } },
    orderBy: { createdAt: "asc" },
  });

  const setupRows: Record<string, string | number>[] = [];
  for (const s of setups) {
    const entries = [...s.entries].sort(
      (a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name)
    );
    for (const e of entries) {
      const isRoycut3 = e.machine.name === "Roycut-3";
      setupRows.push({
        "Production Date":          String(dash(s.shift?.date)),
        "Shift":                    String(dash(s.shift?.shiftNumber)),
        "Design Name":              String(dash(s.designName)),
        "Thickness (cm)":           String(dash(s.thickness)),
        "Target Slabs":             String(dash(s.targetSlabs)),
        "Machine":                  e.machine.name,
        "Program Name":             String(dash(e.programName)),
        "Tool Name":                String(dash(e.toolName)),
        "Target Cycle Time (sec)":  String(dash(e.targetCycleTime)),
        "Liquid Name":              String(dash(e.liquidName)),
        "Powder Name":              String(dash(e.powderName)),
        "Roller Height (mm)":       isRoycut3 ? "-" : String(dash(e.rollerHeight)),
        "Notes":                    String(dash(s.notes)),
      });
    }
  }

  const wsSetup = XLSX.utils.json_to_sheet(setupRows, { header: SETUP_COLUMNS });
  wsSetup["!cols"] = [
    { wch: 15 }, { wch: 7 }, { wch: 22 }, { wch: 13 }, { wch: 12 }, { wch: 12 },
    { wch: 26 }, { wch: 16 }, { wch: 21 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 24 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsRecords, "Production Records");
  XLSX.utils.book_append_sheet(wb, wsSetup, "Production Setup");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Complete_Production_${date || "All"}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
