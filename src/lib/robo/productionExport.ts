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
 * ── What the sheet carries, and why ──────────────────────────────────────
 * Design Name and Batch No. now ride on every row: the sheet is read one slab
 * at a time, and a reader should not have to cross-reference the Production
 * Setup sheet to learn which design a slab was. They come off the slab's own
 * batch setup.
 *
 * Remarks is the SAME string Slabs Records shows — the slab's own note and its
 * delays through one formatter, e.g. "C5 Robo1 15m [22:40-22:55]". It is
 * resolved in the route (formatSlabRemarks lives in utils.ts, which pulls in
 * enough of the app that `node --test` cannot load it) and handed in already
 * formatted, so this file stays pure.
 *
 * Shift, Status, Delay Codes and Total Delay are gone: Shift is an internal
 * grouping the register does not show, Status is derived from the Out time
 * beside it, and both delay columns are now folded into the one Remarks string
 * the operator actually reads.
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
  "Design Name",
  "Thickness (cm)",
  "Batch No.",
  "Slab No.",
  // Beside the slab they describe, not stranded at the far end of the row.
  "Robo2 Body Weight (kg)",
  "Robo2 Cycle Time (sec)",
  "In Time",
  "Out Time",
  "Remarks",
] as const;

/** Column widths, one per column above and in the same order. */
export const PRODUCTION_RECORD_WIDTHS = [7, 15, 22, 13, 12, 12, 21, 21, 10, 10, 40];

export type ProductionRecordColumn = (typeof PRODUCTION_RECORD_COLUMNS)[number];
export type ProductionRecordRow = Partial<Record<ProductionRecordColumn, string | number>>;

/** What a record contributes, already resolved by the route. */
export interface ProductionRowInput {
  serialNumber: number | null;
  productionDate: string;
  designName: string | null;
  thickness: number | null;
  batchNo: string | null;
  slabNumber: string;
  roymixBodyWeight: number | null;
  roymixCycleTime: number | null;
  inTime: string | null;
  outTime: string | null;
  /** The Slabs-Records remark string, note and delays together, resolved in
   *  the route through formatSlabRemarks. "-" when there is nothing. */
  remarks: string;
}

const dash = (v: string | number | null | undefined): string | number =>
  v === null || v === undefined || v === "" ? "-" : v;

/**
 * One row, keyed by exactly the columns above.
 *
 * `fallbackSerial` is used only when the slab carries no S.No. of its own — the
 * row's position in the sheet, so the column is never blank.
 */
export function productionRecordRow(
  r: ProductionRowInput,
  fallbackSerial: number,
): ProductionRecordRow {
  return {
    "S.No.":                  r.serialNumber ?? fallbackSerial,
    "Production Date":        dash(r.productionDate),
    "Design Name":            dash(r.designName),
    "Thickness (cm)":         dash(r.thickness),
    "Batch No.":              dash(r.batchNo),
    "Slab No.":               dash(r.slabNumber),
    "Robo2 Body Weight (kg)": dash(r.roymixBodyWeight),
    "Robo2 Cycle Time (sec)": dash(r.roymixCycleTime),
    "In Time":                dash(r.inTime),
    "Out Time":               dash(r.outTime),
    "Remarks":                dash(r.remarks),
  };
}
