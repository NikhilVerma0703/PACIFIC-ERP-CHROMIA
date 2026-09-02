/**
 * Which rows in a Robo download are structural — section headers and totals —
 * as opposed to plain data or blank spacers. The styling pass (exportStyle.ts)
 * reads this to highlight them; kept pure and alias-free so `node --test` can
 * pin the classification without loading the spreadsheet library.
 *
 * The markers are the exact literals the export builders write (see
 * productionGrouping.ts and the two export routes), so a total row is known by
 * the label it already carries — nothing new is added to the data.
 */

export type RoboRowRole = "section" | "summary" | "grandTotal";

/** Production Records sheet: batch section headers and the total lines. */
export function productionRowRole(row: Record<string, unknown>): RoboRowRole | null {
  if (row["S.No."] === "BATCH") return "section";
  const slab = row["Slab No."];
  if (slab === "TOTAL" || slab === "GRAND TOTAL") return "grandTotal"; // the whole-list total
  if (slab === "Total") return "summary"; // a batch group's total
  return null;
}

/** Delay List sheet: the "TOTAL DELAY DURATION" / "Delay Events" total lines. */
export function delayRowRole(row: Record<string, unknown>): RoboRowRole | null {
  const desc = row["Description"];
  if (desc === "TOTAL DELAY DURATION" || desc === "Delay Events") return "summary";
  return null;
}

/** Date-wise Totals sheet: the single closing TOTAL line. */
export function byDateRowRole(row: Record<string, unknown>): RoboRowRole | null {
  return row["Production Date"] === "TOTAL" ? "grandTotal" : null;
}
