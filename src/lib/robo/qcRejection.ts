/**
 * QC Rejection Analysis — the rules, with no database and no opinions.
 *
 * Given a batch, the Robo Downloads screen answers three questions: how many
 * slabs the batch produced, how many QC rejected, and WHICH faults it rejected
 * them for. This file decides the last two.
 *
 * ── WHY THERE IS NO "ROBO-RELATED" FILTER HERE ────────────────────────────
 * The brief asked for the table to show only Robo-line-related reasons. It
 * cannot, honestly: `polish_qc.quality_issue` stores plain fault names —
 * Pinhole, Pattern Variation, Oil Dot, Chipout — and carries nothing that says
 * which came from the Robo line. Any filter would be a guess encoded in source
 * and then read off a screen as fact, which is how a management number becomes
 * wrong in a way nobody can see.
 *
 * The owner's instruction (2026-09-21) settles it: "dont define it, just
 * mention the error, we will as analysts look at the fault and decide if its
 * robo or something else." So every fault on the batch's rejected slabs is
 * listed with its count and share, and the judgement stays with the person who
 * has the plant knowledge to make it.
 *
 * ── WHAT COUNTS AS REJECTED ───────────────────────────────────────────────
 * `C (Reject)` and nothing else, by the owner's decision. B is a DOWNGRADE —
 * the slab still sells — so counting it as a rejection would overstate the
 * figure roughly sixfold on some batches (batch 1449: 2 rejects, 11 downgrades).
 * B is reported separately rather than folded in or dropped, so the two can
 * never be confused for one another.
 *
 * Pure and import-free, so `node --test` can exercise it.
 */

/** The one grade that means QC rejected the slab. */
export const REJECT_GRADE = "C (Reject)";

/** The grade that means downgraded-but-sellable. Reported beside the rejects,
 *  never inside them. */
export const DOWNGRADE_GRADE = "B";

/** One QC row, reduced to what this file reads. */
export interface QcRow {
  qualityGrade: string | null;
  qualityIssue: readonly string[] | null;
}

export interface ReasonRow {
  reason: string;
  /** Slabs rejected carrying this fault. */
  slabs: number;
  /** Share of REJECTED SLABS, not of faults — see the note in summarise. */
  pct: number;
}

export interface RejectionSummary {
  /** Slabs the Robo line recorded producing for this batch. */
  produced: number;
  /** Slabs QC has actually inspected. Never assume this equals `produced`:
   *  QC lags the line, so a fresh batch can be largely uninspected and a
   *  rejection rate against `produced` would read far better than the truth. */
  inspected: number;
  rejected: number;
  downgraded: number;
  /** Rejected as a share of INSPECTED, which is the only honest denominator. */
  rejectRatePct: number | null;
  reasons: ReasonRow[];
  /** Rejected slabs with no fault recorded at all — counted, never hidden,
   *  because they are the gap between the table and the reject total. */
  rejectedWithoutReason: number;
}

const clean = (s: unknown): string => String(s ?? "").trim();

/**
 * The batch's QC picture.
 *
 * ONE SLAB CAN CARRY SEVERAL FAULTS, so the reason counts add up to MORE than
 * the reject total, and the percentages can sum past 100. That is a property of
 * the data, not an error: `quality_issue` is a multi-select and a slab rejected
 * for a crack AND a pinhole is one slab on two rows. The percentage is
 * deliberately "of rejected slabs" rather than "of faults" — an analyst asking
 * "what share of our rejects had pattern trouble?" wants the former, and the
 * latter would shrink every fault's share as soon as slabs started carrying two.
 *
 * Reasons are NOT case-folded or merged. "Pattern Variation", "pattern Blur"
 * and "pattern problem" are three distinct entries in the QC master and mean
 * three different things; folding them would invent a category the plant does
 * not have. They are reported exactly as QC stores them.
 */
export function summariseRejections(rows: readonly QcRow[], produced: number): RejectionSummary {
  const inspected = rows.length;
  const rejectedRows = rows.filter((r) => clean(r.qualityGrade) === REJECT_GRADE);
  const downgraded = rows.filter((r) => clean(r.qualityGrade) === DOWNGRADE_GRADE).length;
  const rejected = rejectedRows.length;

  const byReason = new Map<string, number>();
  let rejectedWithoutReason = 0;
  for (const r of rejectedRows) {
    // De-duplicated PER SLAB: a row that somehow lists the same fault twice is
    // one slab with that fault, not two.
    const faults = new Set((r.qualityIssue ?? []).map(clean).filter(Boolean));
    if (faults.size === 0) { rejectedWithoutReason += 1; continue; }
    for (const f of faults) byReason.set(f, (byReason.get(f) ?? 0) + 1);
  }

  const reasons: ReasonRow[] = [...byReason.entries()]
    .map(([reason, slabs]) => ({
      reason,
      slabs,
      pct: rejected ? round1((100 * slabs) / rejected) : 0,
    }))
    // Biggest first; ties alphabetical so the order is stable between loads.
    .sort((a, b) => b.slabs - a.slabs || a.reason.localeCompare(b.reason));

  return {
    produced: Math.max(0, Math.trunc(produced)),
    inspected,
    rejected,
    downgraded,
    rejectRatePct: inspected ? round1((100 * rejected) / inspected) : null,
    reasons,
    rejectedWithoutReason,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
