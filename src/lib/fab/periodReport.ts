// THE FABRICATION REPORT — day, week, month, with what it was worth.
//
// The owner: "there is report in the full project, same like I need that type
// for my fabrication module — day wise, month wise, weekly, along with pricing."
//
// reportPeriods.ts already knows how to put a day into a bucket (ISO weeks,
// Monday to Sunday; calendar months). This folds the floor's two different
// kinds of number into those buckets and keeps them apart, because they answer
// different questions and one of them has already been got wrong once.
//
// ───────────────────────────────── OPERATIONS ARE NOT PIECES ────────────────
// The owner, on the old dashboard: "here I think everything is added up — total
// piece cut + polish + sink + fabri + pack all are total as piece, but no, there
// were no such pieces. Same piece is being cut, polished, sinked, fabricated and
// packaged but added as 4-5 times."
//
// He was right, and it is the reason `operations` is spelt out rather than
// called a total. One piece crossing five stages is FIVE operations and ONE
// piece. Both are worth reporting — operations is how busy the floor was, pieces
// is how much work left it — and a column that adds them together is a lie in
// either direction. So:
//
//   operations    stage completions. 250 on a day of 50 pieces is normal.
//   piecesPacked  pieces that reached the end. The honest output figure.
//
// ───────────────────────────────── WHEN MONEY IS EARNED ─────────────────────
// On the day a piece is PACKED, not when its row was ordered and not when it was
// cut. Packing is when the work is finished and billable; anything earlier
// counts revenue on stone that could still be rejected, and anything later is
// not a shop-floor event at all.
//
// The caller values each packed piece from lib/fab/pricing.ts and hands the
// money here already attributed to a day. This module does not know the rate
// card and must not: two places that both know it are two places to change it.
//
// PURE, AND IT IMPORTS ONE THING — reportPeriods.ts, which itself imports
// nothing. `node --test` resolves it, and the .ts extension is what makes that
// work; see the note in that file.

import {
  bucketByPeriod, dayKeysBetween, periodOf,
  type DatedRow, type Period, type PeriodGrain,
} from "./reportPeriods.ts";

/** One day of stage completions, as the CEO route already builds them. */
export interface PeriodStageRow extends DatedRow {
  dayKey: string;
  cutting: number;
  polishing: number;
  sinkCutting: number;
  fabrication: number;
  packaging: number;
}

/** One day's worth of packed value. Several rows may share a day — one per
 *  ordered row — and they are summed. */
export interface PeriodMoneyRow extends DatedRow {
  dayKey: string;
  edgeCost: number;
  sinkCost: number;
  /** Pieces that reached the end on this day. EVERY packed piece — plain,
   *  fabrication and sample alike — because this is the output figure. */
  piecesPacked: number;
  /** How many of those actually earned the money beside them: the FABRICATION
   *  pieces, the ones with sinks.
   *
   *  Two counts rather than one because a row of 60 with 30 sinks packs sixty
   *  pieces and charges for thirty, and a single column would have to be one or
   *  the other — understating output or doubling the money. The second is
   *  exactly the bug this field was added to make visible: the charge was once
   *  applied to all sixty. Optional, so a caller that has not been taught the
   *  difference reports zero charged rather than a wrong number. */
  piecesCharged?: number;
}

export interface PeriodReportRow {
  period: Period;
  cutting: number;
  polishing: number;
  sinkCutting: number;
  fabrication: number;
  packaging: number;
  /** Stage completions. NOT a piece count — see the note at the top. */
  operations: number;
  piecesPacked: number;
  /** Of those, the ones that earned: fabrication pieces. Never greater than
   *  piecesPacked, and usually well under it. */
  piecesCharged: number;
  edgeCost: number;
  sinkCost: number;
  total: number;
}

export interface PeriodReport {
  grain: PeriodGrain;
  rows: PeriodReportRow[];
  totals: Omit<PeriodReportRow, "period">;
  /** Rows whose day could not be read. Reported, never bucketed into today —
   *  a silent reassignment puts yesterday's output on today's report and nobody
   *  ever finds it. */
  dropped: number;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function money(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function blank(period: Period): PeriodReportRow {
  return {
    period,
    cutting: 0, polishing: 0, sinkCutting: 0, fabrication: 0, packaging: 0,
    operations: 0, piecesPacked: 0, piecesCharged: 0, edgeCost: 0, sinkCost: 0, total: 0,
  };
}

/**
 * FOLD THE FLOOR INTO PERIODS.
 *
 * `from` and `to` are day keys and are inclusive. EVERY period between them
 * appears, including the ones with nothing in them: a shop that cut nothing on
 * Thursday needs to see Thursday, and a report that silently skips a day makes a
 * bad week look like a short one.
 */
export function buildPeriodReport(
  stageRows: PeriodStageRow[],
  moneyRows: PeriodMoneyRow[],
  grain: PeriodGrain,
  from?: string,
  to?: string,
): PeriodReport {
  const byKey = new Map<string, PeriodReportRow>();
  let dropped = 0;

  // The empty scaffold first, so a period with no work still has a row.
  if (from && to) {
    for (const day of dayKeysBetween(from, to)) {
      const p = periodOf(day, grain);
      if (p && !byKey.has(p.key)) byKey.set(p.key, blank(p));
    }
  }

  const stages = bucketByPeriod(stageRows ?? [], grain);
  dropped += stages.dropped;
  for (const b of stages.buckets) {
    const row = byKey.get(b.period.key) ?? blank(b.period);
    for (const r of b.rows) {
      row.cutting += n(r.cutting);
      row.polishing += n(r.polishing);
      row.sinkCutting += n(r.sinkCutting);
      row.fabrication += n(r.fabrication);
      row.packaging += n(r.packaging);
    }
    // Derived, never taken from the caller: the one place this sum is computed
    // is the one place it can be wrong.
    row.operations = row.cutting + row.polishing + row.sinkCutting
      + row.fabrication + row.packaging;
    byKey.set(b.period.key, row);
  }

  const cash = bucketByPeriod(moneyRows ?? [], grain);
  dropped += cash.dropped;
  for (const b of cash.buckets) {
    const row = byKey.get(b.period.key) ?? blank(b.period);
    for (const r of b.rows) {
      row.edgeCost = money(row.edgeCost + n(r.edgeCost));
      row.sinkCost = money(row.sinkCost + n(r.sinkCost));
      row.piecesPacked += Math.max(0, Math.floor(n(r.piecesPacked)));
      row.piecesCharged += Math.max(0, Math.floor(n(r.piecesCharged)));
    }
    row.total = money(row.edgeCost + row.sinkCost);
    byKey.set(b.period.key, row);
  }

  const rows = [...byKey.values()].sort((a, b) =>
    a.period.startDayKey.localeCompare(b.period.startDayKey));

  const totals = rows.reduce<Omit<PeriodReportRow, "period">>((t, r) => ({
    cutting: t.cutting + r.cutting,
    polishing: t.polishing + r.polishing,
    sinkCutting: t.sinkCutting + r.sinkCutting,
    fabrication: t.fabrication + r.fabrication,
    packaging: t.packaging + r.packaging,
    operations: t.operations + r.operations,
    piecesPacked: t.piecesPacked + r.piecesPacked,
    piecesCharged: t.piecesCharged + r.piecesCharged,
    edgeCost: money(t.edgeCost + r.edgeCost),
    sinkCost: money(t.sinkCost + r.sinkCost),
    total: money(t.total + r.total),
  }), {
    cutting: 0, polishing: 0, sinkCutting: 0, fabrication: 0, packaging: 0,
    operations: 0, piecesPacked: 0, piecesCharged: 0, edgeCost: 0, sinkCost: 0, total: 0,
  });

  return { grain, rows, totals, dropped };
}

/**
 * WHAT ONE PACKED PIECE OF A ROW IS WORTH.
 *
 * A row's charge divided by the pieces that earn it — its FABRICATION pieces,
 * the sink ones, because edge work is fabrication work and a plain piece never
 * reaches the fabricator (see pricing.ts). So a row of 60 with 30 sinks spreads
 * its whole charge over those 30, and packing a plain piece earns nothing.
 *
 * Zero when the row has no fabrication pieces, which is most rows: a plain
 * purchase-order row and every sample row are cut, polished, packed and not
 * charged for on this card.
 *
 * ROUNDED ONLY AT THE END, by the caller summing these. Rounding per piece and
 * then summing loses paise across a hundred pieces, and a project total that
 * does not equal the sum of its rows is the bug this whole module exists to
 * avoid repeating.
 */
export function perPieceCharge(
  rowEdgeCost: number,
  rowSinkCost: number,
  fabricationPieces: number,
): { edge: number; sink: number } {
  const k = Math.max(0, Math.floor(n(fabricationPieces)));
  if (k <= 0) return { edge: 0, sink: 0 };
  return { edge: n(rowEdgeCost) / k, sink: n(rowSinkCost) / k };
}
