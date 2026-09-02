/**
 * The query string the Reports and Downloads screens send — built once, here,
 * so the preview (summary) and the download (exports) can never disagree about
 * what the current filter is, and so the two screens stay identical.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * Two independent filters, matching the screens:
 *   Production Date — All | Date Wise (one day) | Date Range (From/To, inclusive)
 *   Batch Number    — a typed number, matched loosely server-side (see batchNo.ts)
 *
 * They compose: a batch is sent whatever the date mode is, so "this batch, on
 * this date", "this batch, any date" and "this date, any batch" are all just
 * whichever fields are filled. An empty result is "?", i.e. no filter at all.
 */

export type ReportMode = "ALL" | "DATE" | "RANGE";

export interface ReportFilter {
  mode: ReportMode;
  /** The "Date Wise" day; used only when mode is DATE. */
  date: string;
  /** The "Date Range" bounds; used only when mode is RANGE, either omittable. */
  from: string;
  to: string;
  /** The Batch Number box; sent in every mode, independent of the date. */
  batch: string;
}

export function reportQuery(f: ReportFilter): string {
  const qs = new URLSearchParams();

  if (f.mode === "DATE" && f.date.trim()) {
    qs.set("date", f.date.trim());
  } else if (f.mode === "RANGE") {
    if (f.from.trim()) qs.set("from", f.from.trim());
    if (f.to.trim()) qs.set("to", f.to.trim());
  }

  if (f.batch.trim()) qs.set("batch", f.batch.trim());

  const s = qs.toString();
  return s ? `?${s}` : "";
}
