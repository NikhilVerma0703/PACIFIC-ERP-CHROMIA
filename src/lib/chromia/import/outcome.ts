/**
 * How a register import reports what it did.
 *
 * Pure and alias-free so `node --test` can reach it, the same split the rest of
 * the codebase uses. The database half — reading rows and writing them — stays
 * in server/services/import-service.ts.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The Import page showed FAILED on imports where nothing had gone wrong.
 *
 * Measured, not guessed: the real May register (PRO MAY.xlsx) parses to 199
 * slab rows, 0 unreadable, 67 blank spacer rows, and 13 slab numbers that the
 * sheet itself repeats. Replaying the old counters over those rows gave
 *
 *     first import, empty database   PARTIAL   186 imported, 0 failed
 *     second import, same good file  FAILED      0 imported, 0 failed
 *
 * Both are wrong, for the same reason: a SKIP was being counted as an error.
 *
 * A skip is the documented, intended outcome — "rows whose slab number already
 * exists are skipped rather than overwritten: live data always wins over an
 * import". It happens on the FIRST import too, because the register repeats a
 * slab number when a slab comes back from recalibration. Filing that under
 * `errors` made three things untrue at once: the status went PARTIAL on a
 * clean import, the status went FAILED on a re-import, and both sat next to a
 * "Failed: 0" count that flatly contradicted them.
 *
 * So the three outcomes are counted separately here, and the status is decided
 * from what actually went wrong rather than from how many notes were produced.
 */

export type ImportOutcomeStatus = "COMPLETED" | "PARTIAL" | "FAILED";

/**
 * What became of the rows in one import run.
 *
 * `alreadyPresent` and `blankRows` are counted apart on purpose. They used to
 * share one "skipped" figure, and the sentence beneath it then said things like
 * "all 266 slabs in this sheet are already in the ERP" for a sheet with 199
 * slab rows and 67 blank spacers — a number larger than the row count, two
 * thirds of which were not slabs at all. A spacer row is not a slab anybody
 * chose to leave alone.
 */
export interface ImportCounts {
  /** Rows written. */
  imported: number;
  /** Slabs deliberately left alone — the number is already in the ERP. */
  alreadyPresent: number;
  /** Blank spacer rows. Normal in this sheet, and not slabs. */
  blankRows: number;
  /** Rows the parser could not read at all (missing slab no., no date…). */
  unreadable: number;
  /** Rows that threw while being written. These are the real failures. */
  failed: number;
}

/**
 * The status to record against the import batch.
 *
 *   FAILED     nothing was written AND something went wrong.
 *   PARTIAL    something was written, and something else went wrong.
 *   COMPLETED  nothing went wrong — including the case where every row was
 *              already present and there was simply nothing new to write.
 *
 * The last one is the correction. "Nothing new to import" is a no-op, not a
 * failure, and telling an operator their import failed when the ERP already
 * holds every row sends them looking for a problem that does not exist.
 */
export function importStatus(counts: ImportCounts): ImportOutcomeStatus {
  const wrong = counts.failed + counts.unreadable;
  if (wrong === 0) return "COMPLETED";
  return counts.imported === 0 ? "FAILED" : "PARTIAL";
}

/**
 * One line saying what happened, in the operator's terms.
 *
 * Written here rather than in the page so the sentence and the status can
 * never disagree — they are decided from the same counts.
 */
export function importSummaryLine(counts: ImportCounts): string {
  const { imported, alreadyPresent, unreadable, failed } = counts;
  const parts: string[] = [];

  // Blank rows are never mentioned: they are spacers the sheet has always had,
  // and naming them would make an ordinary import read like a list of problems.
  if (imported === 0 && failed === 0 && unreadable === 0 && alreadyPresent > 0) {
    return alreadyPresent === 1
      ? "Nothing new — the one slab in this sheet is already in the ERP, and was left untouched."
      : `Nothing new — all ${alreadyPresent} slabs in this sheet are already in the ERP, and were left untouched.`;
  }

  parts.push(imported === 1 ? "1 slab imported" : `${imported} slabs imported`);
  if (alreadyPresent > 0) parts.push(`${alreadyPresent} already in the ERP, left untouched`);
  if (unreadable > 0) parts.push(`${unreadable} row${unreadable === 1 ? "" : "s"} could not be read`);
  if (failed > 0) parts.push(`${failed} failed to save`);
  return `${parts.join(" · ")}.`;
}
