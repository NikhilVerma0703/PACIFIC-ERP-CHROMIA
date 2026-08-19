// Shared mixer run — ONE continuous mix feeding SEVERAL line batches.
//
// The mixer can keep a single formulation running while the line alternates the slabs
// it makes between two batch numbers (5 of X, 11 of Y, 5 of X …). Every cycle stays
// stamped with whichever batch was open at the mixer, so the ERP — which reconciles
// material against output by matching batch LABELS — reports one batch with impossible
// wastage and the other with no material at all. Live case: 1386 ("Cathereine") and
// 1387 ("Super White") alternate 23 runs at the line head (12 and 11); 1386 alone reads
// ~75% wastage and 1387 has no cycles, yet together they reconcile at ~5%.
//
// DETECTION IS DELIBERATELY TIMESTAMP-FREE. Data entry lags production by hours or
// days (press up to ~93 h, distributor up to ~207 h observed), so any rule keyed off
// WHEN a row was typed in is unreliable. A slab NUMBER, by contrast, is stamped by the
// line in physical order no matter when the row is eventually entered.
//
// THE SLAB IS BORN AT THE LINE HEAD (Distributor / Kreos), which owns its true batch —
// the same principle batchMismatch.ts is built on. We read the interleaving from there,
// NOT from press: a cluster of mis-typed press rows makes exactly the pattern this
// module treats as proof, and those rows are what the wrong-batch panel above already
// flags. Press is used only as a fallback for older batches that predate line-head data.
//
// Design-switch families (1376 / 1376-A) are excluded — erp.ts already explains those
// through `mixFamilyWide`, and its parent-only slab weight can itself inflate wastage,
// so a batch in that state is skipped rather than blamed on a neighbour.
//
// READ-ONLY. It reports evidence only. Re-allocating material is a separate step the
// production manager must confirm first.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { num } from "@/lib/erp";

const db = prisma as any;

/** A real batch change needs a wash-out. The signal works ONE WAY only: a gap SHORTER
 *  than this proves the mix continued; a longer gap proves nothing (the line pauses for
 *  breaks and shift changes too), so it never vetoes — it only adds confidence. */
const CLEANING_GAP_H = 3;
/** Each batch must COME BACK for it to be alternation. A,B,A is an interrupted batch —
 *  a legitimate two-mix event — so every named batch needs at least this many runs. */
const MIN_RUNS_PER_BATCH = 2;
/** Above this a batch's own material figure cannot be right. */
const IMPLAUSIBLE_WASTAGE = 25;
/** A believable wastage for the combined run. */
const PLAUSIBLE_MAX = 20;
/** A genuine shared run is 2 batches, occasionally 3. More means messy data — don't guess. */
const MAX_PARTNERS = 3;
/** Fewer slabs than this in the window is a stray row, not an interleaved batch. */
const MIN_PARTNER_SLABS = 3;
/** If even the trimmed span is this wide the slab numbers are too scattered to judge. */
const MAX_SPAN = 5000;

export interface MixRun { batch: string; from: number; to: number; n: number }
export interface MixTotals { mixKg: number; slabKg: number; wastagePct: number | null }
export interface SharedMixReport {
  key: string;
  partners: string[];
  source: "line head" | "press";
  runs: MixRun[];
  runCount: number;
  runsPerBatch: Record<string, number>;
  ownCycles: number;
  partnerCycles: number;
  /** A batch in this run that pressed slabs from a mix it has NO cycles for — impossible
   *  on its own, and the fact that actually distinguishes a shared run from a bad batch. */
  noMixMember: string | null;
  mixer: { cycles: number; maxGapH: number | null; ranContinuously: boolean };
  alone: MixTotals;
  combined: MixTotals;
  confident: boolean;
}

// Same weight rule the batch page uses (erp.ts), so the kg here are built the same way.
// Exported for lib/mixerFifo — the confirm-and-split must weigh cycles EXACTLY as the
// evidence panel did, or the split would apportion a different total than was confirmed.
export const W_SELECT: Record<string, boolean> = (() => {
  const o: Record<string, boolean> = { batchKey: true, totalCycleWeight: true, mixerStartTime: true, mixerEndTime: true };
  for (let x = 1; x <= 4; x++) { for (let g = 1; g <= 8; g++) o[`m${x}W${g}`] = true; o[`m${x}FW`] = true; o[`m${x}RW`] = true; }
  return o;
})();
export function cycleKg(m: Record<string, unknown>): number {
  const t = num(m.totalCycleWeight);
  if (t) return t;
  let s = 0;
  for (let x = 1; x <= 4; x++) { for (let g = 1; g <= 8; g++) s += num(m[`m${x}W${g}`]); s += num(m[`m${x}FW`]) + num(m[`m${x}RW`]); }
  return s;
}
const pct = (mixKg: number, slabKg: number) => (mixKg > 0 && slabKg > 0 ? ((mixKg - slabKg) / mixKg) * 100 : null);
/** "1376-A" and "1376" are one family — already handled by mixFamilyWide. */
const famOf = (k: string) => k.split("-")[0];

type SlabRow = { s: number; b: string };
/** Unambiguous slabs (one batch label only) from the line head, within a window. */
const lineHeadSlabs = (keys: string[], lo: number, hi: number) => prisma.$queryRaw<SlabRow[]>`
  SELECT slab_number::float8 s, min(batch_key) b FROM (
    SELECT slab_number, batch_key FROM distributor WHERE batch_key = ANY(${keys}::text[]) AND slab_number IS NOT NULL
    UNION ALL
    SELECT slab_number, batch_key FROM kreos WHERE batch_key = ANY(${keys}::text[]) AND slab_number IS NOT NULL
  ) t WHERE slab_number BETWEEN ${lo} AND ${hi}
  GROUP BY slab_number HAVING count(DISTINCT batch_key) = 1 ORDER BY 1`;
const pressSlabs = (keys: string[], lo: number, hi: number) => prisma.$queryRaw<SlabRow[]>`
  SELECT slab_number::float8 s, min(batch_key) b FROM press
  WHERE batch_key = ANY(${keys}::text[]) AND slab_number IS NOT NULL
    AND slab_number BETWEEN ${lo} AND ${hi}
  GROUP BY slab_number HAVING count(DISTINCT batch_key) = 1 ORDER BY 1`;

/**
 * Does this batch's material actually belong to a run it shares with another batch?
 * Returns null when there is nothing to report (the normal case).
 */
export async function detectSharedMixRun(
  batchRaw: string,
  /** `data.family` from getBatch. It already resolves the family across press, the line
   *  head and the mixer, so passing it in is both cheaper and wider than probing press. */
  family?: { isSub: boolean; keys: string[] },
): Promise<SharedMixReport | null> {
  const key = normalizeBatch(batchRaw);
  if (!key) return null;
  try {
    // 0) skip design-switch families in EITHER direction — a parent with sub-batches, or a
    // sub-batch itself. erp.ts already explains them via mixFamilyWide, and its
    // parent-only slab weight can inflate wastage enough to look "impossible" here.
    if (family) {
      if (family.isSub || family.keys.length > 1) return null;
    } else {
      const subs = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int n FROM (
          SELECT DISTINCT batch_key FROM press WHERE batch_key LIKE ${key + "-%"}
        ) t`;
      if ((subs[0]?.n ?? 0) > 0) return null;
    }

    // 1) the batch's slab window, from the line head where it exists. TRIMMED, not
    // min..max: one mis-stamped slab can sit thousands of numbers from the body (1259 has
    // a stray 142022 against a body of 131990-132105) and min..max would sweep in every
    // batch between. Percentiles are taken over DISTINCT slabs so duplicate rows can't
    // drag the window toward one slab.
    const win = await prisma.$queryRaw<{ lo: number; hi: number; n: number; lh: number }[]>`
      WITH s AS (
        SELECT DISTINCT slab_number, 1 AS lh FROM distributor WHERE batch_key = ${key} AND slab_number IS NOT NULL
        UNION SELECT DISTINCT slab_number, 1 FROM kreos WHERE batch_key = ${key} AND slab_number IS NOT NULL
      ), p AS (
        SELECT DISTINCT slab_number, 0 AS lh FROM press WHERE batch_key = ${key} AND slab_number IS NOT NULL
      ), pick AS (SELECT * FROM s UNION ALL SELECT * FROM p WHERE NOT EXISTS (SELECT 1 FROM s))
      SELECT percentile_cont(0.05) WITHIN GROUP (ORDER BY slab_number)::float8 lo,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY slab_number)::float8 hi,
             count(*)::int n, max(lh)::int lh FROM pick`;
    const w = win[0];
    if (!w || !w.n || w.n < 2 || w.lo == null || w.hi == null) return null;
    if (w.hi - w.lo > MAX_SPAN) return null; // slab numbers too scattered to judge
    const source: "line head" | "press" = w.lh === 1 ? "line head" : "press";
    const slabsIn = source === "line head" ? lineHeadSlabs : pressSlabs;

    // 2) candidate partners: batches with a real presence inside that window
    const cand = source === "line head"
      ? await prisma.$queryRaw<{ b: string }[]>`
          SELECT batch_key b FROM (
            SELECT slab_number, batch_key FROM distributor WHERE slab_number BETWEEN ${w.lo} AND ${w.hi}
            UNION ALL SELECT slab_number, batch_key FROM kreos WHERE slab_number BETWEEN ${w.lo} AND ${w.hi}
          ) t WHERE batch_key IS NOT NULL AND batch_key <> '' AND batch_key <> ${key}
          GROUP BY 1 HAVING count(DISTINCT slab_number) >= ${MIN_PARTNER_SLABS}`
      : await prisma.$queryRaw<{ b: string }[]>`
          SELECT batch_key b FROM press WHERE slab_number BETWEEN ${w.lo} AND ${w.hi}
            AND batch_key IS NOT NULL AND batch_key <> '' AND batch_key <> ${key}
          GROUP BY 1 HAVING count(DISTINCT slab_number) >= ${MIN_PARTNER_SLABS}`;
    const candidates = cand.map((o) => String(o.b)).filter((b) => famOf(b) !== famOf(key));
    if (!candidates.length || candidates.length > MAX_PARTNERS) return null;

    // 3) compress the merged slab stream into alternating runs.
    // Alternation means every named batch COMES BACK. Crucially the runs must be counted
    // over ONLY the batches that survive, because a batch that gets dropped would
    // otherwise split someone else's contiguous block in two and manufacture the very
    // "comes back" evidence this test looks for (C2,K,C1,K,C2 makes K look alternating
    // when the real pattern is C2,K,C2 — an interrupted batch, which is two mixes).
    // So: compress, filter, recompress, re-test — to a fixed point.
    const seq = await slabsIn([key, ...candidates], w.lo, w.hi);
    const compress = (keep: Set<string>): MixRun[] => {
      const out: MixRun[] = [];
      for (const r of seq) {
        const b = String(r.b);
        if (!keep.has(b)) continue;
        const last = out[out.length - 1];
        if (last && last.batch === b) { last.to = Number(r.s); last.n++; }
        else out.push({ batch: b, from: Number(r.s), to: Number(r.s), n: 1 });
      }
      return out;
    };
    let partners = candidates;
    let runs: MixRun[] = [];
    let runsPerBatch: Record<string, number> = {};
    for (let pass = 0; pass < candidates.length + 1; pass++) {
      runs = compress(new Set([key, ...partners]));
      runsPerBatch = {};
      const slabsPerBatch: Record<string, number> = {};
      for (const r of runs) { runsPerBatch[r.batch] = (runsPerBatch[r.batch] ?? 0) + 1; slabsPerBatch[r.batch] = (slabsPerBatch[r.batch] ?? 0) + r.n; }
      const next = partners.filter((b) => (runsPerBatch[b] ?? 0) >= MIN_RUNS_PER_BATCH && (slabsPerBatch[b] ?? 0) >= MIN_PARTNER_SLABS);
      if (next.length === partners.length) break; // stable
      partners = next;
      if (!partners.length) break;
    }
    if (!partners.length) return null;
    if ((runsPerBatch[key] ?? 0) < MIN_RUNS_PER_BATCH) return null; // our batch never comes back = nested, not alternating

    // 4) material, per batch, in two queries
    const group = [key, ...partners];
    const [cyc, pressRows] = await Promise.all([
      db.mixerCycle.findMany({ where: { batchKey: { in: group } }, select: W_SELECT }) as Promise<any[]>,
      db.press.findMany({ where: { batchKey: { in: group } }, select: { batchKey: true, slabWeight: true } }) as Promise<any[]>,
    ]);
    let ownMixKg = 0, groupMixKg = 0, ownCycles = 0;
    const partnerMix: Record<string, number> = {}, partnerCyc: Record<string, number> = {};
    for (const c of cyc) {
      const v = cycleKg(c); groupMixKg += v;
      if (c.batchKey === key) { ownMixKg += v; ownCycles++; }
      else { partnerMix[c.batchKey] = (partnerMix[c.batchKey] ?? 0) + v; partnerCyc[c.batchKey] = (partnerCyc[c.batchKey] ?? 0) + 1; }
    }
    let ownSlabKg = 0, groupSlabKg = 0;
    const partnerSlab: Record<string, number> = {};
    for (const r of pressRows) {
      const v = r.slabWeight ?? 0; groupSlabKg += v;
      if (r.batchKey === key) ownSlabKg += v;
      else partnerSlab[r.batchKey] = (partnerSlab[r.batchKey] ?? 0) + v;
    }
    const alone: MixTotals = { mixKg: ownMixKg, slabKg: ownSlabKg, wastagePct: pct(ownMixKg, ownSlabKg) };
    const combined: MixTotals = { mixKg: groupMixKg, slabKg: groupSlabKg, wastagePct: pct(groupMixKg, groupSlabKg) };

    // Only speak up when this batch's OWN material figure cannot be right.
    const suspect = (ownCycles === 0 && ownSlabKg > 0) || (alone.wastagePct != null && alone.wastagePct > IMPLAUSIBLE_WASTAGE);
    if (!suspect) return null;

    // 5) mixer continuity — corroboration only, never a veto
    const times = cyc
      .map((c) => ({ s: c.mixerStartTime ? new Date(c.mixerStartTime).getTime() : null, e: c.mixerEndTime ? new Date(c.mixerEndTime).getTime() : null }))
      .filter((t) => t.s != null)
      .sort((a, b) => (a.s as number) - (b.s as number));
    let maxGapH: number | null = null;
    for (let i = 1; i < times.length; i++) {
      const prevEnd = times[i - 1].e ?? times[i - 1].s;
      const gap = Math.max(0, ((times[i].s as number) - (prevEnd as number)) / 3600000); // mixers overlap; never report a negative pause
      if (gap > (maxGapH ?? -Infinity)) maxGapH = gap;
    }

    // The decisive fact is not that the combined figure looks nice — a small broken batch
    // beside a big healthy one always would. It is that SOME batch in the run pressed slabs
    // out of a mix it has no cycles for, which is impossible unless the mix came from
    // another label. Checked across the whole run, so the verdict is the same whichever
    // member you happen to be looking at.
    const noMixMember =
      (ownCycles === 0 && ownSlabKg > 0) ? key
      : (partners.find((b) => (partnerCyc[b] ?? 0) === 0 && (partnerSlab[b] ?? 0) > 0) ?? null);
    const confident =
      source === "line head" && // press can be mis-typed; never badge that as strong
      noMixMember != null &&
      combined.wastagePct != null && combined.wastagePct >= 0 && combined.wastagePct <= PLAUSIBLE_MAX &&
      (alone.wastagePct == null || combined.wastagePct < alone.wastagePct);

    return {
      key, partners, source, runs, runCount: runs.length, runsPerBatch,
      ownCycles, partnerCycles: cyc.length - ownCycles, noMixMember,
      mixer: { cycles: cyc.length, maxGapH, ranContinuously: maxGapH != null && maxGapH < CLEANING_GAP_H },
      alone, combined, confident,
    };
  } catch (e) {
    console.error("detectSharedMixRun failed:", e); // never break the batch page
    return null;
  }
}
