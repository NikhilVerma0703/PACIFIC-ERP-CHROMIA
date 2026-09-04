import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { fmtDurationLong, machineLabel } from "@/lib/robo/utils";
import { delayGrandTotal, delayTotalsByDate } from "@/lib/robo/delayTotals";
import { delayProductionDateOf, delayProductionDateSelectWhere } from "@/lib/robo/productionDate";
import { roboThicknessOf } from "@/lib/robo/thickness";
import { exportScopeTag } from "@/lib/robo/exportScope";
import { styleRoboSheet } from "@/lib/robo/exportStyle";
import { byDateRowRole, delayRowRole } from "@/lib/robo/exportRowRoles";

// Shift is gone — an internal grouping the register does not show. Design Name,
// Thickness and Batch No. come off the slab the delay held up, so a delay reads
// on its own without cross-referencing the production sheet.
const COLUMNS = [
  "S.No.", "Production Date", "Design Name", "Thickness (cm)", "Batch No.",
  "Slab No.", "Delay Code", "Description", "Category", "Machine",
  "Start Time", "End Time", "Duration", "Remarks",
];

/** The second sheet: one row per production date. See delayTotals.ts. */
const BY_DATE_COLUMNS = ["Production Date", "Delay Events", "Total Delay (min)", "Total Delay"];

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : v;

type DelayRow = Record<string, string | number>;

/** The pair of total lines that closes a date group and the whole sheet. */
const delayTotalRows = (mins: number, events: number): DelayRow[] => [
  { "Description": "TOTAL DELAY DURATION", "Duration": mins, "Remarks": fmtDurationLong(mins) },
  { "Description": "Delay Events", "Duration": events },
];

/**
 * GET /api/robo/exports/delays?date=&from=&to=&batch=
 * Omit everything for every delay to date. `date` is one day, `from`/`to` an
 * inclusive window (a range beats a single date), `batch` a loosely-matched
 * Batch Number — the same filters the Downloads screen shows.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date")?.trim() || "";
  const from = sp.get("from")?.trim() || "";
  const to = sp.get("to")?.trim() || "";
  const batchIds = await resolveBatchRecipeIds(sp.get("batch"));

  // "All dates" groups the list date-wise; a single day is one block. A range
  // keeps the grouping (bounded All); a batch is a filter, not a date scope.
  const grouped = date === "";

  const fetched = await prisma.roboDelayLog.findMany({
    // Dated by the slab the delay held up, so a delay and its slab never land
    // on two different days in the same workbook — see productionDate.ts — and
    // filtered to that slab's batch when one is typed (through the slab, since a
    // delay carries no batch of its own; a batch filter drops slab-less delays).
    where: {
      ...(delayProductionDateSelectWhere({ date, from, to }) ?? {}),
      ...(batchIds !== null ? { productionRecord: { batchRecipeId: { in: batchIds } } } : {}),
    },
    include: {
      shift: true,
      delayCode: true,
      machine: true,
      productionRecord: { include: { batchRecipe: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  /* Sorted by the Production Date the sheet prints, for the same reason as the
     production export — and here it matters twice over: S.No. is the row
     position, and the Date-wise Totals sheet next to it IS date-sorted, so an
     unsorted list would have the two sheets of one workbook disagree about the
     order of the same days. */
  const delays = [...fetched].sort(
    (a, b) =>
      delayProductionDateOf(a).localeCompare(delayProductionDateOf(b)) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // Each delay shaped once, carrying its production date and minutes so the
  // grouping never resolves them again. S.No. is the position across the WHOLE
  // list, so it stays unique when the rows are split into date groups.
  const shaped = delays.map((d, i) => ({
    date: delayProductionDateOf(d),
    mins: d.durationMinutes,
    row: {
      "S.No.":           i + 1,
      "Production Date": String(dash(delayProductionDateOf(d))),
      "Design Name":     String(dash(d.productionRecord?.batchRecipe?.designName)),
      "Thickness (cm)":  String(dash(roboThicknessOf(d.productionRecord))),
      "Batch No.":       String(dash(d.productionRecord?.batchRecipe?.batchNo)),
      "Slab No.":        String(dash(d.productionRecord?.slabNumber)),
      "Delay Code":      d.delayCode.code,
      "Description":     d.delayCode.description,
      "Category":        d.delayCode.category,
      // Shop-floor name, matching every screen — see the note in the production export.
      "Machine":         String(dash(machineLabel(d.machineName || d.machine?.name))),
      "Start Time":      String(dash(d.startTime)),
      "End Time":        String(dash(d.endTime)),
      "Duration":        d.durationMinutes,
      "Remarks":         String(dash(d.remarks)),
    } as DelayRow,
  }));

  /* Both totals come off the SAME breakdown, so the second sheet and the
     bottom of the first can never disagree — which is the first thing anyone
     compares when a file carries two sets of numbers. */
  const byDate = delayTotalsByDate(shaped.map((s) => ({ date: s.date, durationMinutes: s.mins })));
  const overall = delayGrandTotal(byDate);

  const rows: DelayRow[] = [];
  if (grouped) {
    // One group per production date, closed by its own TOTAL DELAY DURATION and
    // Delay Events, then two blank rows before the next date.
    let cursor = 0;
    while (cursor < shaped.length) {
      const day = shaped[cursor].date;
      let end = cursor;
      let mins = 0;
      while (end < shaped.length && shaped[end].date === day) { mins += shaped[end].mins; end++; }
      for (let k = cursor; k < end; k++) rows.push(shaped[k].row);
      rows.push(...delayTotalRows(mins, end - cursor));
      if (end < shaped.length) rows.push({}, {});
      cursor = end;
    }
  } else {
    for (const s of shaped) rows.push(s.row);
  }

  // The overall totals stay at the end of the list sheet, exactly as before.
  rows.push({});
  rows.push(...delayTotalRows(overall.minutes, overall.events));
  rows.push({
    "Description": `Date-wise totals for ${byDate.length} production date(s) — see the "Date-wise Totals" sheet`,
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  ws["!cols"] = [
    { wch: 7 }, { wch: 15 }, { wch: 22 }, { wch: 13 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 38 }, { wch: 15 }, { wch: 13 }, { wch: 11 }, { wch: 11 },
    { wch: 12 }, { wch: 28 },
  ];
  // Highlight the header and every "TOTAL DELAY DURATION" / "Delay Events" line.
  styleRoboSheet(ws, { columnCount: COLUMNS.length, rowRoles: rows.map(delayRowRole) });

  /* Second sheet: the same delays totalled per production date. Downloading
     "All" used to give one figure for the whole period, which is the least
     useful shape for the download anyone reviewing a month actually takes —
     it says how much was lost and nothing about which day lost it. */
  const byDateRows: Record<string, string | number>[] = byDate.map((day) => ({
    "Production Date":   day.date || "(no date)",
    "Delay Events":      day.events,
    "Total Delay (min)": day.minutes,
    "Total Delay":       fmtDurationLong(day.minutes),
  }));
  byDateRows.push({});
  byDateRows.push({
    "Production Date":   "TOTAL",
    "Delay Events":      overall.events,
    "Total Delay (min)": overall.minutes,
    "Total Delay":       fmtDurationLong(overall.minutes),
  });

  const wsByDate = XLSX.utils.json_to_sheet(byDateRows, { header: BY_DATE_COLUMNS });
  wsByDate["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
  // Header plus the closing TOTAL line.
  styleRoboSheet(wsByDate, { columnCount: BY_DATE_COLUMNS.length, rowRoles: byDateRows.map(byDateRowRole) });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Delay List`.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, wsByDate, "Date-wise Totals");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Delay_List_${exportScopeTag({ date, from, to, hasBatch: batchIds !== null })}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
