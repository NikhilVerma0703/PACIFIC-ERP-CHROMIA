/**
 * The Production Records sheet of the Complete Production download — its
 * columns and the shape of one row.
 *
 * In lib rather than in the route so `node --test` can reach it, which is the
 * whole point here: json_to_sheet takes a header list AND the row objects, and
 * silently APPENDS any row key the header does not mention. A header and a key
 * that drift apart therefore do not fail, they produce a sheet with an empty
 * column where the reader expects data and a stray column past the last one.
 *
 * That is not hypothetical — it is what this download did. The header said
 * "Robo2 Body Weight (kg)" / "Robo2 Cycle Time (sec)" while the rows were
 * keyed "RoyMix …", so those two columns came out blank and the real numbers
 * appeared after Remarks, which was supposed to be last. Keeping the two here,
 * next to each other and covered by a test, is what stops that repeating.
 *
 * ── What changed, and why ────────────────────────────────────────────────
 * Operator is gone: it was RoboShift.operatorName, which nothing in the ERP
 * fills in, so the column was dashes all the way down.
 *
 * Design Name is gone: it belongs to the setup, and the Production Setup sheet
 * carries it once per run rather than repeating it on all 500 slabs of a batch.
 *
 * Robo2, not RoyMix: the machine is stored as "Roymix" and always will be —
 * the stored names carry the ordering, the preset keys and every delay log ever
 * saved — but no screen has said RoyMix for a long time, so a sheet that did
 * was naming a machine its reader cannot find. Re-importing an exported sheet
 * still works either way; importRegister accepts both spellings.
 */

/** Column order, left to right. Remarks is last, deliberately. */
export const PRODUCTION_RECORD_COLUMNS = [
  "S.No.",
  "Production Date",
  "Shift",
  "Thickness (cm)",
  "Slab Number",
  // Beside the slab they describe, not stranded at the far end of the row.
  "Robo2 Body Weight (kg)",
  "Robo2 Cycle Time (sec)",
  "In Time",
  "Out Time",
  "Status",
  "Delay Codes",
  "Total Delay",
  "Remarks",
] as const;

/** Column widths, one per column above and in the same order. */
export const PRODUCTION_RECORD_WIDTHS = [7, 15, 7, 13, 14, 21, 21, 10, 10, 14, 18, 20, 30];

export type ProductionRecordColumn = (typeof PRODUCTION_RECORD_COLUMNS)[number];
export type ProductionRecordRow = Partial<Record<ProductionRecordColumn, string | number>>;

/** What a record contributes, already resolved by the route. */
export interface ProductionRowInput {
  serialNumber: number | null;
  productionDate: string;
  shiftNumber: number | null;
  thickness: number | null;
  slabNumber: string;
  roymixBodyWeight: number | null;
  roymixCycleTime: number | null;
  inTime: string | null;
  outTime: string | null;
  status: string;
  delayCodes: string[];
  delayMinutes: number;
  remarks: string | null;
}

const dash = (v: string | number | null | undefined): string | number =>
  v === null || v === undefined || v === "" ? "-" : v;

/**
 * One row, keyed by exactly the columns above.
 *
 * `statusLabel` and `formatDuration` are passed in rather than imported: they
 * live in utils.ts, which pulls in enough of the app that `node --test` cannot
 * load it, and the shaping is what needs testing here.
 */
export function productionRecordRow(
  r: ProductionRowInput,
  fallbackSerial: number,
  statusLabel: (status: string) => string,
  formatDuration: (minutes: number) => string,
): ProductionRecordRow {
  return {
    "S.No.":                  r.serialNumber ?? fallbackSerial,
    "Production Date":        dash(r.productionDate),
    "Shift":                  dash(r.shiftNumber),
    "Thickness (cm)":         dash(r.thickness),
    "Slab Number":            dash(r.slabNumber),
    "Robo2 Body Weight (kg)": dash(r.roymixBodyWeight),
    "Robo2 Cycle Time (sec)": dash(r.roymixCycleTime),
    "In Time":                dash(r.inTime),
    "Out Time":               dash(r.outTime),
    "Status":                 statusLabel(r.status),
    "Delay Codes":            r.delayCodes.length ? r.delayCodes.join(", ") : "-",
    "Total Delay":            r.delayMinutes > 0 ? formatDuration(r.delayMinutes) : "-",
    "Remarks":                dash(r.remarks),
  };
}
