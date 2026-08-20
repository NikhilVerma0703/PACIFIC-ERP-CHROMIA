import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { fmtDurationLong, slabStatusLabel, machineLabel } from "@/lib/robo/utils";
import { productionDateOf, productionDateWhere, setupProductionDate } from "@/lib/robo/productionDate";
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

  const records = await prisma.roboProductionRecord.findMany({
    // Filtered on the date the operator entered, matching what the sheet
    // prints and what Slabs Records searches — see productionDate.ts.
    where: productionDateWhere(date) ?? {},
    include: {
      shift: true,
      batchRecipe: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ shift: { date: "asc" } }, { createdAt: "asc" }],
  });

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
  const setups = await prisma.roboBatchRecipe.findMany({
    where: date ? { OR: [{ productionDate: date }, { productionDate: null, shift: { date } }] } : {},
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
