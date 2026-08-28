// THE CEO OVERVIEW, ROLLED UP PROJECT BY PROJECT.
//
// The Slabs tab lists every slab flat, which is how it read as four rows with
// slab 146837 in two of them — the same stone put on two different projects.
// That is legitimate (a QC slab can be assigned to more than one project) but
// it looks like a duplicate, and it answers the wrong question: a CEO asks
// "how is PROJECT 1001 doing", not "what happened to slab 146837".
//
// So the overview groups by project and keeps the slabs underneath, collapsed.
//
// PURE, AND IT IMPORTS NOTHING — the rule from slabLoss.ts and pieceNaming.ts:
// `node --test` resolves ESM strictly, so a relative import without a .ts
// extension fails at runtime while adding the extension fights the Next build.
//
// ──────────────────────────────────────────────── WHY THE MATHS IS HERE ─────
// The flat table computed its own averages inline in JSX. Two of them were
// wrong in a way nobody would notice:
//
//   AVG WASTAGE WAS A MEAN OF PERCENTAGES. On today's data that is harmless:
//   all four slabs are 75.16 sqft, so weighting by area gives the same 6.1%.
//   It stops being harmless the moment slab sizes differ — a 100 sqft slab half
//   wasted beside a 10 sqft offcut barely touched averages to 30% by
//   percentage and is 46.4% by area. The first flatters the shop, and only the
//   second survives being multiplied by a rate. Both are computed below and
//   named differently, because they answer different questions and only one of
//   them belongs beside a rupee figure.
//
//   AREA CAME IN AS mm², was divided by 92,903.04 in the template, and rounded
//   at the point of display — so the column totals did not equal the sum of the
//   column. Converted once, here.

/** 25.4 × 25.4 × 144. Redeclared rather than imported — see the note above. */
export const SQ_MM_PER_SQ_FT = 25.4 * 25.4 * 144;

/** One slab as /api/fab/ceo reports it. */
export interface CeoSlabWastage {
  slabId: string;
  slabCode: string;
  projectCode: string;
  wastePct: number;
  pieceCount: number;
  slabAreaMm2: number;
  piecesAreaMm2: number;
  /** polish_qc.quality_grade — A / B / C. Null when QC never graded it, which
   *  is a different fact from grade A and is shown as such. */
  qualityGrade?: string | null;
  /** polish_qc.slab_mark — FULL_SLAB / CTS / SAMPLE. What became of the slab,
   *  which is NOT how good it is: a grade C slab cut to size is C and CTS.
   *  Carried through untouched — the chip decides how to read it, including the
   *  fallback to qualityGrade on a database without scripts/0057. */
  slabMark?: string | null;
  /** polish_qc.quality_grade_before_cts — the verdict fabrication overwrote. */
  gradeBeforeCts?: string | null;
  /** polish_qc.design — the colour, as QC named it. */
  design?: string | null;
}

export interface OverviewSlab {
  slabId: string;
  slabCode: string;
  qualityGrade: string | null;
  slabMark: string | null;
  gradeBeforeCts: string | null;
  design: string | null;
  pieceCount: number;
  slabAreaSqft: number;
  usedSqft: number;
  wasteSqft: number;
  wastePct: number;
  /** Above the 20% line the dashboard already draws in red. */
  highWaste: boolean;
}

export interface OverviewProject {
  projectCode: string;
  slabCount: number;
  pieceCount: number;
  slabAreaSqft: number;
  usedSqft: number;
  wasteSqft: number;
  /** Waste over AREA — the figure that survives being multiplied by a rate. */
  wastePct: number;
  /** The mean of the slabs' own percentages, which is what the flat table
   *  showed. Kept so the two can be compared rather than silently swapped. */
  meanSlabWastePct: number;
  highWasteSlabs: number;
  /** Worst first, because that is the row a CEO opens. */
  slabs: OverviewSlab[];
}

export interface OverviewTotals {
  projectCount: number;
  slabCount: number;
  pieceCount: number;
  slabAreaSqft: number;
  usedSqft: number;
  wasteSqft: number;
  wastePct: number;
  meanSlabWastePct: number;
  highWasteSlabs: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
function positive(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
export function sqftFromSqMm(areaSqMm: number): number {
  return positive(areaSqMm) / SQ_MM_PER_SQ_FT;
}

/** The 20% line. One constant, so the tile and the row badge cannot disagree
 *  about which slabs are bad. */
export const HIGH_WASTE_PCT = 20;

/**
 * Project → slabs, worst waste first at both levels.
 *
 * A slab appearing under two projects is TWO ENTRIES, not one, and that is
 * correct: each project used part of it and each carries its own share of the
 * waste. Deduplicating by slab code would hide one project's consumption
 * inside another's.
 */
export function groupByProject(slabs: CeoSlabWastage[]): OverviewProject[] {
  const byProject = new Map<string, OverviewSlab[]>();

  for (const s of slabs ?? []) {
    const code = String(s?.projectCode ?? "").trim() || "(no project)";
    const slabAreaSqft = sqftFromSqMm(s?.slabAreaMm2 ?? 0);
    const usedSqft = sqftFromSqMm(s?.piecesAreaMm2 ?? 0);
    // Never negative: an over-committed slab is a real state, but "-3 sqft of
    // waste" in a total is worse than nothing.
    const wasteSqft = Math.max(0, slabAreaSqft - usedSqft);
    const wastePct = slabAreaSqft > 0 ? (wasteSqft / slabAreaSqft) * 100 : 0;

    const list = byProject.get(code) ?? [];
    list.push({
      slabId: String(s?.slabId ?? ""),
      slabCode: String(s?.slabCode ?? ""),
      qualityGrade: s?.qualityGrade ?? null,
      slabMark: s?.slabMark ?? null,
      gradeBeforeCts: s?.gradeBeforeCts ?? null,
      design: s?.design ?? null,
      pieceCount: Math.max(0, Math.floor(Number(s?.pieceCount) || 0)),
      slabAreaSqft: round2(slabAreaSqft),
      usedSqft: round2(usedSqft),
      wasteSqft: round2(wasteSqft),
      wastePct: round1(wastePct),
      highWaste: wastePct > HIGH_WASTE_PCT,
    });
    byProject.set(code, list);
  }

  const out: OverviewProject[] = [];
  for (const [projectCode, list] of byProject) {
    const slabAreaSqft = list.reduce((n, s) => n + s.slabAreaSqft, 0);
    const usedSqft = list.reduce((n, s) => n + s.usedSqft, 0);
    const wasteSqft = list.reduce((n, s) => n + s.wasteSqft, 0);
    const meanSlab = list.length
      ? list.reduce((n, s) => n + s.wastePct, 0) / list.length
      : 0;
    out.push({
      projectCode,
      slabCount: list.length,
      pieceCount: list.reduce((n, s) => n + s.pieceCount, 0),
      slabAreaSqft: round2(slabAreaSqft),
      usedSqft: round2(usedSqft),
      wasteSqft: round2(wasteSqft),
      // AREA-WEIGHTED, not a mean of percentages. See the note at the top.
      wastePct: slabAreaSqft > 0 ? round1((wasteSqft / slabAreaSqft) * 100) : 0,
      meanSlabWastePct: round1(meanSlab),
      highWasteSlabs: list.filter((s) => s.highWaste).length,
      slabs: [...list].sort((a, b) => b.wastePct - a.wastePct),
    });
  }

  // Worst project first — the one a CEO opens.
  return out.sort((a, b) => b.wastePct - a.wastePct || a.projectCode.localeCompare(b.projectCode));
}

/** The four tiles. Derived from the same rows the tree is built from, so a
 *  tile can never disagree with the sum of what is under it. */
export function overviewTotals(projects: OverviewProject[]): OverviewTotals {
  const slabAreaSqft = projects.reduce((n, p) => n + p.slabAreaSqft, 0);
  const usedSqft = projects.reduce((n, p) => n + p.usedSqft, 0);
  const wasteSqft = projects.reduce((n, p) => n + p.wasteSqft, 0);
  const allSlabs = projects.flatMap((p) => p.slabs);
  const meanSlab = allSlabs.length
    ? allSlabs.reduce((n, s) => n + s.wastePct, 0) / allSlabs.length
    : 0;
  return {
    projectCount: projects.length,
    slabCount: allSlabs.length,
    pieceCount: projects.reduce((n, p) => n + p.pieceCount, 0),
    slabAreaSqft: round2(slabAreaSqft),
    usedSqft: round2(usedSqft),
    wasteSqft: round2(wasteSqft),
    wastePct: slabAreaSqft > 0 ? round1((wasteSqft / slabAreaSqft) * 100) : 0,
    meanSlabWastePct: round1(meanSlab),
    highWasteSlabs: projects.reduce((n, p) => n + p.highWasteSlabs, 0),
  };
}
