/**
 * QC Rejection Analysis — which QC rejections the Robo line is accountable for.
 *
 * Given a batch, the Robo Downloads screen answers four questions: how many
 * slabs the batch produced, how many QC has inspected, how many QC rejected
 * BECAUSE OF THE ROBO LINE, and for which Robo-line faults. This file decides
 * the last two, with no database and no opinions of its own.
 *
 * ── WHICH FAULTS ARE THE ROBO LINE'S ──────────────────────────────────────
 * Exactly two, by the owner's decision (2026-09-25):
 *
 *   · Spillage
 *   · Pattern Problem in QC Line
 *
 * QC records many other faults — Pinhole, Crack, Oil Dot, Chipout, Pattern
 * Variation, pattern Blur … — but those are not caused by the Robo line, and
 * this section must neither show nor count them. Listing them here would read
 * on screen as "the Robo line caused these", which is exactly the wrong
 * conclusion to hand a manager. (This replaces the 2026-09-21 interim rule of
 * listing every fault for analysts to judge: the owner has now made that
 * judgement, so it is encoded here once instead of being re-made per batch.)
 *
 * ── HOW A STORED FAULT IS RECOGNISED ──────────────────────────────────────
 * QC types faults as free text (slab-intake chips, deduped case-insensitively),
 * so one fault can arrive as "Spillage", "spillage", " Spillage " or
 * "Spillage.". A fault is therefore normalised — trimmed, lower-cased, hyphens
 * and underscores read as spaces, trailing punctuation and repeated spaces
 * dropped — and then matched against a short list of EXACT spellings per
 * Robo fault. Never a substring, never a keyword. That is the whole point:
 * "Pattern Variation" and "pattern Blur" are separate QC faults that are NOT
 * the Robo line's, and a loose match on "pattern" would pull them in and
 * overstate the Robo line's rejections without anyone being able to see it.
 * "pattern problem" is listed as an alias because that is how QC's own master
 * records the fault the owner calls "Pattern Problem in QC Line".
 *
 * ── WHAT COUNTS AS REJECTED ───────────────────────────────────────────────
 * `C (Reject)` and nothing else — unchanged from before. B is a DOWNGRADE (the
 * slab still sells), so a B slab carrying Spillage is not a Robo-line
 * rejection and is not counted.
 *
 * ── THE RATE'S DENOMINATOR ────────────────────────────────────────────────
 * Rejection Rate = Robo-line rejected slabs ÷ Total Slabs Produced × 100, as
 * the owner specified (250 produced, 20 Robo-line rejects → 8%). QC lags the
 * line, so while a batch is still being inspected the rate can rise; the
 * screen says so beside the figure rather than changing the formula.
 *
 * Pure and import-free, so `node --test` can exercise it.
 */

/** The one grade that means QC rejected the slab. */
export const REJECT_GRADE = "C (Reject)";

/** The grade that means downgraded-but-sellable — never a rejection. */
export const DOWNGRADE_GRADE = "B";

/** The Robo line's QC faults, in the order the table shows them. Each is
 *  recognised by EXACT normalised text against its aliases — see above. If QC
 *  turns out to spell one of these faults another way, add that spelling to
 *  its aliases here; do not loosen the match. */
export const ROBO_REJECTION_REASONS: readonly { label: string; aliases: readonly string[] }[] = [
  { label: "Spillage", aliases: ["spillage"] },
  { label: "Pattern Problem in QC Line", aliases: ["pattern problem in qc line", "pattern problem"] },
];

/** One QC row, reduced to what this file reads. */
export interface QcRow {
  qualityGrade: string | null;
  qualityIssue: readonly string[] | null;
}

export interface ReasonRow {
  /** The Robo-line fault, as the owner names it. */
  reason: string;
  /** Rejected slabs carrying this fault. */
  slabs: number;
  /** Share of the slabs rejected due to the Robo line (`roboRejected`). */
  pct: number;
}

export interface RejectionSummary {
  /** Slabs the Robo line recorded producing for this batch. */
  produced: number;
  /** Slabs QC has actually inspected. QC lags the line, so this can be well
   *  below `produced` on a fresh batch. */
  inspected: number;
  /** Rejected (C) slabs carrying at least one Robo-line fault. Each slab is
   *  counted ONCE however many Robo-line faults it carries. 0 when none. */
  roboRejected: number;
  /** roboRejected ÷ produced × 100, one decimal; null when nothing was produced. */
  rejectionRatePct: number | null;
  /** Always exactly one row per Robo-line fault, in ROBO_REJECTION_REASONS
   *  order — a fault that did not occur shows 0 rather than vanishing, so the
   *  table reads the same for every batch. Nothing else is ever listed. */
  reasons: ReasonRow[];
}

const clean = (s: unknown): string => String(s ?? "").trim();

/** A stored fault as it is compared: see "HOW A STORED FAULT IS RECOGNISED". */
const norm = (s: unknown): string =>
  clean(s)
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** The Robo-line fault a stored QC fault is (its label), or null when the
 *  fault is not one of the Robo line's. */
export function roboReasonOf(fault: unknown): string | null {
  const n = norm(fault);
  if (!n) return null;
  for (const r of ROBO_REJECTION_REASONS) if (r.aliases.includes(n)) return r.label;
  return null;
}

/**
 * The batch's Robo-line QC picture.
 *
 * ONE SLAB CAN CARRY BOTH ROBO FAULTS (`quality_issue` is a multi-select), so
 * a slab rejected for Spillage AND Pattern Problem is one slab in
 * `roboRejected` but appears on both table rows. The two row counts can then
 * add up to more than `roboRejected`, and their percentages past 100 — that is
 * the data being honest, not an arithmetic error. A slab rejected for a Robo
 * fault AND an unrelated one (say, Crack) still counts as a Robo-line
 * rejection; the unrelated fault is simply never shown.
 */
export function summariseRejections(rows: readonly QcRow[], produced: number): RejectionSummary {
  const inspected = rows.length;
  const byReason = new Map<string, number>(ROBO_REJECTION_REASONS.map((r) => [r.label, 0]));
  let roboRejected = 0;

  for (const r of rows) {
    if (clean(r.qualityGrade) !== REJECT_GRADE) continue; // only C is a rejection
    // The Robo faults THIS slab carries, as a set: the same fault listed twice,
    // or two spellings of one fault, is still that one fault on this one slab.
    const robo = new Set<string>();
    for (const f of r.qualityIssue ?? []) {
      const label = roboReasonOf(f);
      if (label) robo.add(label);
    }
    if (robo.size === 0) continue; // rejected, but not for a Robo-line reason
    roboRejected += 1;
    for (const label of robo) byReason.set(label, (byReason.get(label) ?? 0) + 1);
  }

  const prod = Math.max(0, Math.trunc(produced));
  const reasons: ReasonRow[] = ROBO_REJECTION_REASONS.map(({ label }) => {
    const slabs = byReason.get(label) ?? 0;
    return { reason: label, slabs, pct: roboRejected ? round1((100 * slabs) / roboRejected) : 0 };
  });

  return {
    produced: prod,
    inspected,
    roboRejected,
    rejectionRatePct: prod ? round1((100 * roboRejected) / prod) : null,
    reasons,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
