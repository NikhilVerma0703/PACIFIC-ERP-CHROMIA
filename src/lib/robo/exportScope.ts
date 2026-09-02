/**
 * The scope tag that names a downloaded workbook — `Complete_Production_<tag>`
 * and `Delay_List_<tag>` — so a file on disk says what filter produced it.
 *
 * Pure and alias-free so `node --test` can reach it, and shared by both export
 * routes so the two never name the same scope differently.
 *
 * The date half mirrors the screen's three modes: a single day is the day, a
 * range is `<from>_to_<to>` (an open end reads "start"/"end"), and no date is
 * "All". A batch filter appends "_batch" rather than the raw number — a typed
 * batch can carry spaces and hyphens that have no business in a filename, and
 * the workbook's own Batch No. column already says which batch it is.
 */

export interface ExportScope {
  date: string;
  from: string;
  to: string;
  hasBatch: boolean;
}

export function exportScopeTag(scope: ExportScope): string {
  const date = scope.date.trim();
  const from = scope.from.trim();
  const to = scope.to.trim();

  const dateTag = date
    ? date
    : from || to
      ? `${from || "start"}_to_${to || "end"}`
      : "All";

  return scope.hasBatch ? `${dateTag}_batch` : dateTag;
}
