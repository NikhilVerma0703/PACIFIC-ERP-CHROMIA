import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx-js-style";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { formatSlabRemarks, machineLabel } from "@/lib/robo/utils";
import { productionDateOf, productionDateSelectWhere, setupProductionDate } from "@/lib/robo/productionDate";
import { exportScopeTag } from "@/lib/robo/exportScope";
import { assembleByBatch, assembleContinuous, type ExportRecord } from "@/lib/robo/productionGrouping";
import { PRODUCTION_RECORD_COLUMNS, PRODUCTION_RECORD_WIDTHS } from "@/lib/robo/productionExport";
import { styleRoboSheet } from "@/lib/robo/exportStyle";
import { productionRowRole } from "@/lib/robo/exportRowRoles";

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

/**
 * GET /api/robo/exports/production?date=&from=&to=&batch=
 * Omit everything for every record to date. `date` is one day, `from`/`to` an
 * inclusive window (a range beats a single date), `batch` a loosely-matched
 * Batch Number — the same filters the Downloads screen shows.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date")?.trim() || "";
  const from = sp.get("from")?.trim() || "";
  const to = sp.get("to")?.trim() || "";
  const batchIds = await resolveBatchRecipeIds(sp.get("batch"));

  // The layout follows the ACTIVE FILTER, not the date scope — see change (6)
  // and lib/robo/productionGrouping.ts. A batch chosen → one continuous list,
  // stored S.No. preserved. No batch (only a date filter) → grouped by batch,
  // S.No. restarting per group. The batch is the pivot, so this is exactly
  // "was a batch selected?".
  const byBatch = batchIds === null;

  const fetched = await prisma.roboProductionRecord.findMany({
    // Filtered on the date the operator entered, matching what the sheet
    // prints and what Slabs Records searches — see productionDate.ts — and on
    // the batch the operator typed, resolved to setup ids (batchFilter.ts).
    where: {
      ...(productionDateSelectWhere({ date, from, to }) ?? {}),
      ...(batchIds !== null ? { batchRecipeId: { in: batchIds } } : {}),
    },
    include: {
      shift: true,
      batchRecipe: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  /* Each fetched row reduced to what the sheet carries, its production date
     resolved once (productionDateOf now honours the slab's own per-slab date —
     a batch past midnight). The grouping module sorts and lays these out; it
     does NOT touch the stored serialNumber, so preserving vs resetting S.No. is
     purely how it numbers the rows it shows. Remarks is resolved here because
     formatSlabRemarks pulls in enough of the app that node --test can't. */
  const exportRecords: ExportRecord[] = fetched.map((r) => ({
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
    remarks:          formatSlabRemarks(r.remarks, r.delayLogs),
    createdAtMs:      r.createdAt.getTime(),
  }));

  const rows = byBatch ? assembleByBatch(exportRecords) : assembleContinuous(exportRecords);

  const wsRecords = XLSX.utils.json_to_sheet(rows, { header: [...PRODUCTION_RECORD_COLUMNS] });
  wsRecords["!cols"] = PRODUCTION_RECORD_WIDTHS.map((wch) => ({ wch }));
  // Highlight the header and every batch section / total row — rows.map lines up
  // with json_to_sheet, so the roles land on exactly the right rows.
  styleRoboSheet(wsRecords, { columnCount: PRODUCTION_RECORD_COLUMNS.length, rowRoles: rows.map(productionRowRole) });

  /* Second sheet: the production setup each shown slab ran under. DERIVED from
     the records above — their distinct batch setups — rather than filtered by
     the setup's own date, so it stays in lock-step with the Records sheet. That
     matters now that a batch can run past midnight: its setup keeps the start
     date, but its later-day slabs are in scope, and this way the setup behind
     them is shown regardless. One block per batch, blank-row separated. */
  const setupIds = [...new Set(fetched.map((r) => r.batchRecipeId).filter((id): id is string => Boolean(id)))];
  const fetchedSetups = setupIds.length
    ? await prisma.roboBatchRecipe.findMany({
        where: { id: { in: setupIds } },
        include: { shift: true, entries: { include: { machine: true } } },
      })
    : [];
  const setups = [...fetchedSetups].sort(
    (a, b) =>
      setupProductionDate(a).localeCompare(setupProductionDate(b)) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const setupRows: Record<string, string | number>[] = [];
  setups.forEach((s, si) => {
    // A blank-row separator between batches.
    if (si > 0) setupRows.push({}, {});
    const setupDate = setupProductionDate(s);

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
  });

  const wsSetup = XLSX.utils.json_to_sheet(setupRows, { header: SETUP_COLUMNS });
  wsSetup["!cols"] = [
    { wch: 15 }, { wch: 22 }, { wch: 13 }, { wch: 12 }, { wch: 12 },
    { wch: 26 }, { wch: 16 }, { wch: 21 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 24 },
  ];
  // Header only — the Setup sheet has no total rows, just per-machine data.
  styleRoboSheet(wsSetup, { columnCount: SETUP_COLUMNS.length });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsRecords, "Production Records");
  XLSX.utils.book_append_sheet(wb, wsSetup, "Production Setup");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Complete_Production_${exportScopeTag({ date, from, to, hasBatch: batchIds !== null })}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
