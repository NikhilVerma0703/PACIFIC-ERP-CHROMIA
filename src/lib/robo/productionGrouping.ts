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
 * S.No. is COMPUTED, not read from the stored serialNumber. Within each batch
 * the slabs are ranked by their physical slab number — the authoritative
 * production order — and numbered 1…N (see slabSequence.ts). That is what fixes
 * the old mistyped runs (a batch numbered 1…36 then restarting at 24, appearing
 * to end far short of its real slab count): the sheet now always shows a clean
 * 1…N for the batch, in slab-number order. The stored serialNumber is left
 * untouched in the database — it is simply no longer what the sheet prints.
 */
import { canonBatchNo } from "./batchNo.ts";
import { sequencedByBatch } from "./slabSequence.ts";
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
 * Batch mode: one continuous list for the selected batch. Rows are laid out in
 * slab-number order and numbered 1…N — the batch's real sequence, whatever the
 * mistyped stored S.No. said.
 */
export function assembleContinuous(records: readonly ExportRecord[]): ProductionRecordRow[] {
  const rows: ProductionRecordRow[] = sequencedByBatch(records).map(({ slab, seqNo }) =>
    productionRecordRow(slab, seqNo),
  );
  rows.push({});
  rows.push(totalRow("TOTAL", records.length));
  return rows;
}

/**
 * Date mode: group by batch, number each group 1…N by slab-number order, and
 * close each group with blank rows + a total before the next. Groups appear in
 * the order their earliest record was produced; the rows INSIDE a group run in
 * slab-number order so the S.No. reads 1…N.
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
    // Number the group 1…N by slab-number order (slabSequence.ts), not by the
    // stored S.No. and not by row position — so a batch whose operator S.No. was
    // mistyped still reads a clean 1…N. The stored value is untouched.
    sequencedByBatch(g.items).forEach(({ slab, seqNo }) => rows.push(productionRecordRow(slab, seqNo)));
    rows.push({}, {}); // 2 blank rows after the batch's records
    rows.push(totalRow("Total", g.items.length));
    if (gi < groupList.length - 1) rows.push({}, {}); // spacing before the next batch
  });
  return rows;
}
