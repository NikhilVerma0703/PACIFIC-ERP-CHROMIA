// FIFO confirm-and-split — the WRITE side of lib/mixerSharing.
//
// When a shared mixer run is confirmed (detector confident + incharge clicked), split the
// run's cycles across the group's slabs so each slab links to the cycle that actually fed
// it, whatever batch label the cycle happens to be stamped with. Writes ONLY mixerCycleIds
// on the line-head rows (Distributor / Kreos). Purely additive: no row changes batch, no
// weight moves, and every prior link rides along in the action log so Undo restores it.
//
// WHY NOT the existing assigners (lib/automations-links.ts, never called anywhere):
//   · assignDistributorByWeight FIFOs on totalWeightAtDistributor, which is EMPTY on every
//     row of the live case (1386/1387). With all weights 0 its advance rule
//     `remainder < w/2` reads `remainder < 0` — never true — so every slab lands on
//     cycle #1 with no error raised.
//   · cyclesForBatch orders by cycle NUMBER. For an interleaved run that is NOT the order
//     the mixes happened (1386 runs 15,16,17,18,19,…,1,30,… by start time). Physical
//     order must come from mixerStartTime, and if any cycle lacks one we refuse rather
//     than guess.
//
// Mass model: slabs walk in slab-number order (the line stamps them in physical order —
// the same timestamp-free principle the detector rests on) and cycles walk in
// mixerStartTime order. Each cycle's mix kg is scaled by the run's overall yield
// (slab kg out ÷ mix kg in), the cycles are laid end-to-end on that axis, and a slab
// belongs to the cycle whose stretch contains the slab's mass midpoint. A slab weighs
// what its press row says (~92% of the live case); the few without one weigh the median
// press slab so the walk always advances. A zero-weight cycle occupies no stretch and
// receives no slabs. This cannot stall and needs no per-step advance rule — the two
// cumulative sums land on the same total by construction.
//
// Slabs sitting far OUTSIDE the run's slab-number span are left unlinked: a mis-typed
// slab number would sort to the extreme of the axis and take a link that is wrong by
// construction (its number is wrong), while polluting the yield for everyone else. The
// preview says how many were set aside. The detector trims to a 5–95 percentile window
// for the same reason; the padding here is generous so genuine head/tail slabs of the
// run are never dropped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { num, batchFamily } from "@/lib/erp";
import { detectSharedMixRun, W_SELECT, cycleKg } from "@/lib/mixerSharing";
import { logActionTx } from "@/lib/actionLog";

const db = prisma as any;

/** How far beyond the detected runs' slab span a slab may sit and still be linked.
 *  The detector's stray example (1259) sat 9,911 numbers out; real run tails observed
 *  so far sit within a few dozen. */
const SPAN_PAD = 2000;

/** What the user confirmed, checked again at apply time — if the data moved in
 *  between (new rows, edited weights, another fix), refuse and ask for a fresh look. */
export interface MixSplitFingerprint {
  slabs: number;
  rows: number;
  cycles: number;
  alreadyLinked: number;
  mixKg: number;
}

export interface MixSplitSummary {
  ok: true;
  key: string;
  group: string[];
  /** cycles that can receive slabs (kg > 0), all cycles, and how they are stamped */
  cycles: { assignable: number; total: number; byBatch: Record<string, number> };
  slabs: number;          // distinct line-head slab numbers being linked
  rows: number;           // physical rows written (distributor + kreos, duplicates included)
  weights: { fromPress: number; fallback: number; medianKg: number };
  /** slabs whose line-head batch differs from the batch stamped on their cycle */
  crossLinked: number;
  /** rows that already carry a link — overwritten on apply, restored by Undo */
  alreadyLinked: number;
  /** slabs left unlinked because their number sits far outside the run's span */
  outliers: number;
  /** true when every row already carries exactly the link this plan would write */
  noop: boolean;
  fp: MixSplitFingerprint;
}
export interface MixSplitRefusal { ok: false; reason: string }
export type MixSplitPreview = MixSplitSummary | MixSplitRefusal;

interface PlannedWrite { model: "Distributor" | "Kreos"; id: string; old: string[]; aid: string }
type Plan = MixSplitRefusal | (MixSplitSummary & { writes: PlannedWrite[]; usedCycles: number });

const refuse = (reason: string): MixSplitRefusal => ({ ok: false, reason });

/** Everything both preview and apply need, derived fresh from the DB — the client is
 *  never trusted with more than the batch it was looking at. Deterministic for a given
 *  DB state, so preview and apply agree unless the data itself changed. */
async function plan(batchRaw: string): Promise<Plan> {
  const key = normalizeBatch(batchRaw);
  if (!key) return refuse("Not a batch number.");

  // Same family semantics the batch page hands the detector (design-switch families are
  // explained by mixFamilyWide, not by splitting — the detector bows out of those).
  const fam = await batchFamily(batchRaw);
  const report = await detectSharedMixRun(batchRaw, { isSub: fam.isSub, keys: fam.keys });
  if (!report) return refuse("The detector no longer reports a shared run for this batch — nothing to split.");
  if (!report.confident)
    return refuse("The evidence here is suggestive, not conclusive (no strong-evidence badge) — splitting is only offered when a batch in the run pressed slabs from a mix it has no cycles for.");

  const group = [report.key, ...report.partners];

  // ---- cycles, in the order the mixes physically happened ----
  const cyc: any[] = await db.mixerCycle.findMany({
    where: { batchKey: { in: group } },
    select: { ...W_SELECT, airtableId: true, cycle: true },
  });
  if (!cyc.length) return refuse("No mixer cycles found for the run.");
  const noStart = cyc.filter((c) => !c.mixerStartTime).length;
  if (noStart > 0)
    return refuse(`${noStart} of ${cyc.length} cycles have no mixer start time, so the physical order of the run is unknowable — no links can be made. (Cycle numbers are not a substitute: this run's numbers do not follow the clock.)`);
  const cycles = cyc
    .map((c) => ({
      aid: String(c.airtableId),
      batch: String(c.batchKey ?? ""),
      t: new Date(c.mixerStartTime).getTime(),
      n: num(c.cycle),
      kg: cycleKg(c),
    }))
    .sort((a, b) => a.t - b.t || a.n - b.n || (a.aid < b.aid ? -1 : 1));
  const totalMixKg = cycles.reduce((a, c) => a + c.kg, 0);
  if (totalMixKg <= 0) return refuse("The run's cycles carry no mix weight — there is nothing to apportion.");

  // ---- the group's slabs at the line head, in physical (slab-number) order ----
  const sel = { select: { id: true, slabNumber: true, batchKey: true, mixerCycleIds: true } };
  const [dRows, kRows] = await Promise.all([
    db.distributor.findMany({ where: { batchKey: { in: group }, slabNumber: { not: null } }, ...sel }) as Promise<any[]>,
    db.kreos.findMany({ where: { batchKey: { in: group }, slabNumber: { not: null } }, ...sel }) as Promise<any[]>,
  ]);
  type Row = { model: "Distributor" | "Kreos"; id: string; slab: number; batch: string; old: string[] };
  const allRows: Row[] = [
    ...dRows.map((r): Row => ({ model: "Distributor", id: r.id, slab: Number(r.slabNumber), batch: String(r.batchKey ?? ""), old: (r.mixerCycleIds ?? []) as string[] })),
    ...kRows.map((r): Row => ({ model: "Kreos", id: r.id, slab: Number(r.slabNumber), batch: String(r.batchKey ?? ""), old: (r.mixerCycleIds ?? []) as string[] })),
  ];
  if (!allRows.length) return refuse("The run has no line-head rows to link.");

  // Keep to the run's span (padded): a slab number thousands away is a typo, and a typo
  // must not take a link or bend the yield. It stays unlinked and is reported instead.
  const runMin = Math.min(...report.runs.map((r) => r.from));
  const runMax = Math.max(...report.runs.map((r) => r.to));
  const inSpan = (n: number) => n >= runMin - SPAN_PAD && n <= runMax + SPAN_PAD;

  // One physical slab per number. Duplicate rows (and the rare slab entered under both
  // labels — the wrong-batch panel's business) all take the same cycle: whatever the
  // slab's true label, its POSITION in the stream is what decides which mix fed it.
  const bySlab = new Map<number, Row[]>();
  for (const r of allRows) { const a = bySlab.get(r.slab) ?? []; a.push(r); bySlab.set(r.slab, a); }
  const allSlabNumbers = [...bySlab.keys()];
  const slabNumbers = allSlabNumbers.filter(inSpan).sort((a, b) => a - b);
  const outliers = allSlabNumbers.length - slabNumbers.length;
  if (!slabNumbers.length) return refuse("Every line-head slab sits outside the run's slab-number span — that needs eyes, not an automatic split.");
  const rows = slabNumbers.reduce((a, n) => a + (bySlab.get(n) as Row[]).length, 0);

  // ---- per-slab weight: press row by slab number, median fallback ----
  // Ordered so duplicate press rows resolve the same way every time — plan() must be a
  // pure function of DB state or the apply could silently differ from the preview.
  const pressRows: any[] = await db.press.findMany({
    where: { batchKey: { in: group }, slabNumber: { not: null }, slabWeight: { not: null } },
    select: { id: true, slabNumber: true, slabWeight: true },
    orderBy: [{ slabNumber: "asc" }, { id: "asc" }],
  });
  const wBySlab = new Map<number, number>();
  for (const p of pressRows) {
    const n = Number(p.slabNumber), w = Number(p.slabWeight);
    if (w > 0 && !wBySlab.has(n)) wBySlab.set(n, w);
  }
  const matched = slabNumbers.filter((n) => wBySlab.has(n));
  if (!matched.length)
    return refuse("None of the run's slabs have a press weight, so a weight-FIFO would be pure invention — no links can be made.");
  const sortedW = matched.map((n) => wBySlab.get(n) as number).sort((a, b) => a - b);
  const medianKg = sortedW[Math.floor(sortedW.length / 2)];

  // ---- FIFO by cumulative mass midpoint ----
  const axis = cycles.filter((c) => c.kg > 0);
  const totalSlabKg = slabNumbers.reduce((a, n) => a + (wBySlab.get(n) ?? medianKg), 0);
  const yieldF = totalSlabKg / totalMixKg;
  let acc = 0;
  const bounds = axis.map((c) => (acc += c.kg * yieldF));
  const writes: PlannedWrite[] = [];
  const used = new Set<string>();
  let crossLinked = 0, alreadyLinked = 0, s = 0, ci = 0;
  for (const n of slabNumbers) {
    const w = wBySlab.get(n) ?? medianKg;
    const mid = s + w / 2;
    while (ci < axis.length - 1 && bounds[ci] < mid) ci++;
    const cycle = axis[ci];
    used.add(cycle.aid);
    const slabRows = bySlab.get(n) as Row[];
    const slabBatch = slabRows.every((r) => r.batch === slabRows[0].batch) ? slabRows[0].batch : null;
    if (slabBatch && slabBatch !== cycle.batch) crossLinked++;
    for (const r of slabRows) {
      if (r.old.length) alreadyLinked++;
      writes.push({ model: r.model, id: r.id, old: r.old, aid: cycle.aid });
    }
    s += w;
  }

  const byBatch: Record<string, number> = {};
  for (const c of cycles) byBatch[c.batch] = (byBatch[c.batch] ?? 0) + 1;
  const noop = writes.every((w) => w.old.length === 1 && w.old[0] === w.aid);

  return {
    ok: true, key: report.key, group,
    cycles: { assignable: axis.length, total: cycles.length, byBatch },
    slabs: slabNumbers.length, rows,
    weights: { fromPress: matched.length, fallback: slabNumbers.length - matched.length, medianKg },
    crossLinked, alreadyLinked, outliers, noop,
    fp: { slabs: slabNumbers.length, rows, cycles: axis.length, alreadyLinked, mixKg: Math.round(totalMixKg) },
    writes, usedCycles: used.size,
  };
}

/** Dry run for the confirmation step — same numbers apply() will produce, no ids shipped. */
export async function previewMixSplit(batchRaw: string): Promise<MixSplitPreview> {
  const p = await plan(batchRaw);
  if (!p.ok) return p;
  const { writes: _writes, usedCycles: _used, ...summary } = p;
  return summary;
}

export interface MixSplitResult { ok: boolean; message: string }

/** Re-derives everything server-side, checks the plan still matches what the user saw,
 *  then writes AND logs inside one transaction: a split that promises "one Undo away"
 *  must never outlive its undo trail, so if the action log cannot be written the whole
 *  split rolls back. Idempotent: an already-split run is reported, not rewritten. */
export async function applyMixSplit(batchRaw: string, expected: MixSplitFingerprint): Promise<MixSplitResult> {
  const p = await plan(batchRaw);
  if (!p.ok) return { ok: false, message: p.reason };

  const fp = p.fp;
  const same = fp.slabs === expected?.slabs && fp.rows === expected?.rows && fp.cycles === expected?.cycles
    && fp.alreadyLinked === expected?.alreadyLinked && fp.mixKg === expected?.mixKg;
  if (!same)
    return { ok: false, message: "The data changed since the preview (rows, cycles or weights moved) — nothing was written. Close and re-open the preview to see the current plan." };

  if (p.noop)
    return { ok: true, message: `✓ Already split — every line-head row of ${p.group.join(" + ")} carries exactly these links. Nothing was written.` };

  // Group the row updates by (table, cycle) — ~2 tables × cycles updateMany calls.
  // That is more than the default 5 s interactive-transaction budget comfortably fits
  // over a remote DB, so the timeout is raised rather than risking a mid-split abort.
  const groups = new Map<string, { model: string; aid: string; ids: string[] }>();
  for (const w of p.writes) {
    const k = `${w.model}::${w.aid}`;
    const g = groups.get(k) ?? { model: w.model, aid: w.aid, ids: [] };
    g.ids.push(w.id);
    groups.set(k, g);
  }
  const partners = p.group.slice(1).join(" + ");
  await db.$transaction(async (tx: any) => {
    for (const g of groups.values()) {
      const t = tx[g.model[0].toLowerCase() + g.model.slice(1)];
      await t.updateMany({ where: { id: { in: g.ids } }, data: { mixerCycleIds: [g.aid] } });
    }
    await logActionTx(tx, {
      kind: "mixLink",
      summary: `Confirmed shared mixer run ${p.group.join(" + ")} — FIFO-linked ${p.slabs} slabs to ${p.usedCycles} cycles (start-time order, press weights, ${p.weights.fallback} at the ${Math.round(p.weights.medianKg)} kg median)`,
      batchKey: p.key,
      model: "Distributor",
      payload: { group: p.group, entries: p.writes.map((w) => ({ model: w.model, id: w.id, old: w.old })) },
    });
  }, { timeout: 60000, maxWait: 10000 });

  return {
    ok: true,
    message: `✓ Linked ${p.slabs} slabs to ${p.usedCycles} cycles across ${p.key} + ${partners}` +
      `${p.crossLinked ? ` — ${p.crossLinked} slab(s) now draw from cycles stamped with the other batch` : ""}` +
      `${p.alreadyLinked ? ` · ${p.alreadyLinked} existing link(s) overwritten (Undo restores them)` : ""}` +
      `${p.outliers ? ` · ${p.outliers} slab(s) left unlinked (far outside the run's slab numbers — check them)` : ""}.`,
  };
}
