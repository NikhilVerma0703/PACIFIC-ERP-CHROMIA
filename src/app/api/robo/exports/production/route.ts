import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { fmtDurationLong, slabStatusLabel, machineLabel } from "@/lib/robo/utils";
import { productionDateOf, productionDateWhere, setupProductionDate, setupProductionDateWhere } from "@/lib/robo/productionDate";
import {
  PRODUCTION_RECORD_COLUMNS,
  PRODUCTION_RECORD_WIDTHS,
  productionRecordRow,
  type ProductionRecordRow,
} from "@/lib/robo/productionExport";

const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];

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

  const fetched = await prisma.roboProductionRecord.findMany({
    // Filtered on the date the operator entered, matching what the sheet
    // prints and what Slabs Records searches — see productionDate.ts.
    where: productionDateWhere(date) ?? {},
    include: {
      shift: true,
      batchRecipe: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  /* Sorted by the Production Date the sheet PRINTS, not by the shift's own
     date. It used to be `orderBy: [{ shift: { date } }, ...]`, which was the
     same thing back when the column read off the shift — and became a sheet
     whose first column jumps about the moment it stopped. Sorted here rather
     than in the query because the value is a fallback across two relations and
     Postgres cannot order by it; every row is already in memory to be shaped.
     yyyy-mm-dd sorts as text exactly as it sorts as a date. */
  const records = [...fetched].sort(
    (a, b) =>
      productionDateOf(a).localeCompare(productionDateOf(b)) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  /* Columns and row shaping live in lib/robo/productionExport.ts, together and
     under test: json_to_sheet appends any row key its header does not mention,
     so the two drifting apart is a silent blank column plus a stray one past
     the end — which is what this sheet used to do with the Robo2 pair. */
  const rows: ProductionRecordRow[] = records.map((r, i) =>
    productionRecordRow(
      {
        serialNumber:     r.serialNumber,
        productionDate:   productionDateOf(r),
        shiftNumber:      r.shift?.shiftNumber ?? null,
        thickness:        r.batchRecipe?.thickness ?? null,
        slabNumber:       r.slabNumber,
        roymixBodyWeight: r.roymixBodyWeight,
        roymixCycleTime:  r.roymixCycleTime,
        inTime:           r.inTime,
        outTime:          r.outTime,
        status:           r.status,
        delayCodes:       r.delayLogs.map(d => d.delayCode.code),
        delayMinutes:     r.delayLogs.reduce((s, d) => s + d.durationMinutes, 0),
        remarks:          r.remarks,
      },
      i + 1,
      slabStatusLabel,
      fmtDurationLong,
    ),
  );

  const totalSlabDelay = records.reduce(
    (s, r) => s + r.delayLogs.reduce((x, d) => x + d.durationMinutes, 0), 0
  );

  rows.push({});
  rows.push({
    "Slab Number": "TOTAL",
    "Status": `${records.length} records`,
    "Total Delay": fmtDurationLong(totalSlabDelay),
  });

  const wsRecords = XLSX.utils.json_to_sheet(rows, { header: [...PRODUCTION_RECORD_COLUMNS] });
  wsRecords["!cols"] = PRODUCTION_RECORD_WIDTHS.map((wch) => ({ wch }));

  /* Second sheet: the production setup each slab was produced under. */
  const fetchedSetups = await prisma.roboBatchRecipe.findMany({
    // Through the same module as everything else, rather than a second
    // hand-written copy of the fallback that could drift from it.
    where: setupProductionDateWhere(date) ?? {},
    include: { shift: true, entries: { include: { machine: true } } },
    orderBy: { createdAt: "asc" },
  });
  const setups = [...fetchedSetups].sort(
    (a, b) =>
      setupProductionDate(a).localeCompare(setupProductionDate(b)) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const setupRows: Record<string, string | number>[] = [];
  for (const s of setups) {
    const entries = [...s.entries].sort(
      (a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name)
    );
    for (const e of entries) {
      const isRoycut3 = e.machine.name === "Roycut-3";
      setupRows.push({
        "Production Date":          String(dash(setupProductionDate(s))),
        "Shift":                    String(dash(s.shift?.shiftNumber)),
        "Design Name":              String(dash(s.designName)),
        "Thickness (cm)":           String(dash(s.thickness)),
        "Target Slabs":             String(dash(s.targetSlabs)),
        // machineLabel, not the stored name: every screen says Robo1..Robo4,
        // so an export that says Roycut-1 forces the reader to translate.
        "Machine":                  machineLabel(e.machine.name),
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
