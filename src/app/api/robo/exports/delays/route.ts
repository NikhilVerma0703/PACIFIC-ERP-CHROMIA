import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { fmtDurationLong, machineLabel } from "@/lib/robo/utils";
import { delayGrandTotal, delayTotalsByDate } from "@/lib/robo/delayTotals";
import { delayProductionDateOf, delayProductionDateWhere } from "@/lib/robo/productionDate";

const COLUMNS = [
  "S.No.", "Production Date", "Shift", "Delay Code", "Description", "Category",
  "Machine", "Slab No.", "Start Time", "End Time", "Duration (min)", "Remarks",
];

/** The second sheet: one row per production date. See delayTotals.ts. */
const BY_DATE_COLUMNS = ["Production Date", "Delay Events", "Total Delay (min)", "Total Delay"];

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : v;

/** GET /api/robo/exports/delays?date=YYYY-MM-DD — omit date for every delay to date. */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date")?.trim() || "";

  const fetched = await prisma.roboDelayLog.findMany({
    // Dated by the slab the delay held up, so a delay and its slab never land
    // on two different days in the same workbook — see productionDate.ts.
    where: delayProductionDateWhere(date) ?? {},
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

  const rows: Record<string, string | number>[] = delays.map((d, i) => ({
    "S.No.":            i + 1,
    "Production Date":  String(dash(delayProductionDateOf(d))),
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

  /* Both totals come off the SAME breakdown, so the second sheet and the
     bottom of the first can never disagree — which is the first thing anyone
     compares when a file carries two sets of numbers. */
  const byDate = delayTotalsByDate(
    delays.map((d) => ({ date: delayProductionDateOf(d), durationMinutes: d.durationMinutes })),
  );
  const overall = delayGrandTotal(byDate);

  // The overall totals stay at the end of the list sheet, exactly as before.
  rows.push({});
  rows.push({
    "Description":     "TOTAL DELAY DURATION",
    "Duration (min)":  overall.minutes,
    "Remarks":         fmtDurationLong(overall.minutes),
  });
  rows.push({
    "Description":     "Delay Events",
    "Duration (min)":  overall.events,
  });
  rows.push({
    "Description":     `Date-wise totals for ${byDate.length} production date(s) — see the "Date-wise Totals" sheet`,
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  ws["!cols"] = [
    { wch: 7 }, { wch: 15 }, { wch: 7 }, { wch: 12 }, { wch: 38 }, { wch: 15 },
    { wch: 13 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 15 }, { wch: 28 },
  ];

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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Delay List`.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, wsByDate, "Date-wise Totals");

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
