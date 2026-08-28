import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { formatSlabRemarks, machineLabel } from "@/lib/robo/utils";
import { productionDateOf, productionDateWhere, setupProductionDate, setupProductionDateWhere } from "@/lib/robo/productionDate";
import { roboGate } from "@/lib/rbac";
import {
  PRODUCTION_RECORD_COLUMNS,
  PRODUCTION_RECORD_WIDTHS,
  productionRecordRow,
  type ProductionRecordRow,
} from "@/lib/robo/productionExport";

const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];

// Shift is gone from this sheet — it is an internal grouping the register does
// not show. Design Name and the rest ride on each row now.
const SETUP_COLUMNS = [
  "Production Date", "Design Name", "Thickness (cm)", "Target Slabs",
  "Machine", "Program Name", "Tool Name", "Target Cycle Time (sec)",
  "Liquid Name", "Powder Name", "Roller Height (mm)", "Notes",
];

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : v;

/** Two blank spacer rows between one production date and the next. */
const SPACER: ProductionRecordRow[] = [{}, {}];

/** The "Total → X records" line that closes a date group and the whole sheet. */
const recordsTotalRow = (label: string, count: number): ProductionRecordRow => ({
  "Slab No.": label,
  "Remarks": `${count} record${count === 1 ? "" : "s"}`,
});

/** GET /api/robo/exports/production?date=YYYY-MM-DD — omit date for every record to date. */
export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const date = req.nextUrl.searchParams.get("date")?.trim() || "";
  // "All" (no date) is the scope that groups the sheets date-wise. A single
  // chosen date is one group, so it is left as a flat list with one total.
  const grouped = date === "";

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
     the end — which is what this sheet used to do with the Robo2 pair.

     Each record is shaped once, carrying the production date it belongs to so
     the grouping below never has to resolve it a second time. The S.No.
     fallback is the row's position across the WHOLE sheet, so it stays unique
     even when the rows are split into date groups. */
  const shaped = records.map((r, i) => ({
    date: productionDateOf(r),
    row: productionRecordRow(
      {
        serialNumber:     r.serialNumber,
        productionDate:   productionDateOf(r),
        designName:       r.batchRecipe?.designName ?? null,
        thickness:        r.batchRecipe?.thickness ?? null,
        batchNo:          r.batchRecipe?.batchNo ?? null,
        slabNumber:       r.slabNumber,
        roymixBodyWeight: r.roymixBodyWeight,
        roymixCycleTime:  r.roymixCycleTime,
        inTime:           r.inTime,
        outTime:          r.outTime,
        // The exact string Slabs Records shows: the slab's own note AND its
        // delays, e.g. "C5 Robo1 15m [22:40-22:55]".
        remarks:          formatSlabRemarks(r.remarks, r.delayLogs),
      },
      i + 1,
    ),
  }));

  const rows: ProductionRecordRow[] = [];
  if (grouped) {
    // One group per production date, its own "Total → X records" at the end,
    // then two blank rows before the next date.
    let cursor = 0;
    while (cursor < shaped.length) {
      const day = shaped[cursor].date;
      let end = cursor;
      while (end < shaped.length && shaped[end].date === day) end++;
      const group = shaped.slice(cursor, end);
      for (const s of group) rows.push(s.row);
      rows.push(recordsTotalRow("Total", group.length));
      if (end < shaped.length) rows.push(...SPACER);
      cursor = end;
    }
    // The final overall total, kept as it was — one line for the whole sheet.
    if (shaped.length > 0) rows.push(...SPACER);
    rows.push(recordsTotalRow("GRAND TOTAL", shaped.length));
  } else {
    for (const s of shaped) rows.push(s.row);
    rows.push({});
    rows.push(recordsTotalRow("TOTAL", shaped.length));
  }

  const wsRecords = XLSX.utils.json_to_sheet(rows, { header: [...PRODUCTION_RECORD_COLUMNS] });
  wsRecords["!cols"] = PRODUCTION_RECORD_WIDTHS.map((wch) => ({ wch }));

  /* Second sheet: the production setup each slab was produced under. Grouped
     by date the same way, with two blank rows between dates — but no total
     rows, because a setup count is not a figure anyone reads off this sheet. */
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
  let prevSetupDate: string | null = null;
  for (const s of setups) {
    const setupDate = setupProductionDate(s);
    // A blank-row separator each time the date changes — but only when the
    // sheet is grouped (the "All" scope). A single chosen date is one block.
    if (grouped && prevSetupDate !== null && setupDate !== prevSetupDate) {
      setupRows.push({}, {});
    }
    prevSetupDate = setupDate;

    const entries = [...s.entries].sort(
      (a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name)
    );
    for (const e of entries) {
      const isRoycut3 = e.machine.name === "Roycut-3";
      setupRows.push({
        "Production Date":          String(dash(setupDate)),
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
    { wch: 15 }, { wch: 22 }, { wch: 13 }, { wch: 12 }, { wch: 12 },
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
