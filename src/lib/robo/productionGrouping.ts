/**
 * How the Complete Production sheet lays its rows out — the two shapes change
 * (6) asks for, kept here (pure) so `node --test` can pin them.
 *
 * The download is read one of two ways, and the layout follows which filter is
 * active:
 *
 *  • A BATCH is chosen → one continuous list. The stored S.No. is shown as-is
 *    and the batch's days flow one into the next with no blank rows and no
 *    reset, because it is one batch being read start to finish (S.No. 121 on 18
 *    Jul, 122 on 19 Jul, straight on).
 *
 *  • Only a DATE filter (no batch) → records from several batches can share the
 *    scope, so they are GROUPED BY BATCH. Inside each group the S.No. restarts
 *    at 1, and the group is closed by blank rows and a "Total: X records" line
 *    before the next batch begins.
 *
 * The S.No. reset is DISPLAY ONLY. The stored serialNumber and the register's
 * running sequence are never touched — the reset is just this sheet numbering
 * the rows it chose to show for one batch.
 */
import { canonBatchNo } from "./batchNo.ts";
import {
  productionRecordRow,
  type ProductionRecordRow,
  type ProductionRowInput,
} from "./productionExport.ts";

/** What each record contributes, plus a stable tiebreak for ordering. */
export interface ExportRecord extends ProductionRowInput {
  /** createdAt as epoch ms — the within-a-day order, so a batch's slabs stay in
   *  entry order and S.No. runs the way the register does. */
  createdAtMs: number;
}

/** Chronological within any set: by the date the sheet PRINTS, then entry
 *  order. yyyy-mm-dd sorts as text exactly as it sorts as a date. */
function chrono(a: ExportRecord, b: ExportRecord): number {
  return a.productionDate.localeCompare(b.productionDate) || a.createdAtMs - b.createdAtMs;
}

/** A row naming the batch a group belongs to. */
function batchHeaderRow(batchNo: string, designName: string): ProductionRecordRow {
  return { "S.No.": "BATCH", "Batch No.": batchNo || "(no batch)", "Design Name": designName || "" };
}

/** The "Total → X records" line, the same shape the rest of the sheet uses. */
function totalRow(label: string, count: number): ProductionRecordRow {
  return { "Slab No.": label, "Remarks": `${count} record${count === 1 ? "" : "s"}` };
}

/**
 * Batch mode: one continuous list, stored S.No. preserved, no per-date breaks.
 */
export function assembleContinuous(records: readonly ExportRecord[]): ProductionRecordRow[] {
  const sorted = [...records].sort(chrono);
  // fallbackSerial (i+1) is used ONLY when a row carries no stored S.No.; a real
  // serialNumber wins, so the register's own numbers show through unchanged.
  const rows: ProductionRecordRow[] = sorted.map((r, i) => productionRecordRow(r, i + 1));
  rows.push({});
  rows.push(totalRow("TOTAL", sorted.length));
  return rows;
}

/**
 * Date mode: group by batch, restart S.No. at 1 per group (display only), and
 * close each group with blank rows + a total before the next.
 */
export function assembleByBatch(records: readonly ExportRecord[]): ProductionRecordRow[] {
  const sorted = [...records].sort(chrono);

  // Partition by canonical batch — "D-1372" and "d1372" are one batch — keeping
  // groups in the order their first (earliest) record appears.
  const groups = new Map<string, { label: string; design: string; items: ExportRecord[] }>();
  for (const r of sorted) {
    const key = canonBatchNo(r.batchNo) || "(no-batch)"; // canonBatchNo yields only [A-Z0-9] or "", so this never collides; no-batch slabs share one group
    let g = groups.get(key);
    if (!g) {
      g = { label: (r.batchNo ?? "").trim(), design: r.designName ?? "", items: [] };
      groups.set(key, g);
    }
    g.items.push(r);
  }

  const rows: ProductionRecordRow[] = [];
  const groupList = [...groups.values()];
  groupList.forEach((g, gi) => {
    rows.push(batchHeaderRow(g.label, g.design));
    // S.No. restarts at 1 for the group: drop the stored serial so
    // productionRecordRow falls back to the group-local position. The stored
    // value is untouched in the database — this is the sheet's own numbering.
    g.items.forEach((r, i) => rows.push(productionRecordRow({ ...r, serialNumber: null }, i + 1)));
    rows.push({}, {}); // 2 blank rows after the batch's records
    rows.push(totalRow("Total", g.items.length));
    if (gi < groupList.length - 1) rows.push({}, {}); // spacing before the next batch
  });
  return rows;
}
