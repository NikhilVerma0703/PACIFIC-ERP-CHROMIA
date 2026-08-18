// Phase 3 — server-side data layer for the dashboards.
// All functions run on the server (Prisma). Designed to degrade gracefully
// when the database is empty (before the Phase 2 import is run).
import { prisma } from "@/lib/prisma";
import { normalizeBatch, parentBatch, isSubBatch } from "@/lib/normalizeBatch";
import { getRangeEdits, AUTOFILL_PREFIX } from "@/lib/batchRange";
import { thicknessMixByBatch, thicknessBySlab, mergeMix, mixBars } from "@/lib/slabThickness";

/** Parse a value that may be a JSON-wrapped Airtable formula/rollup result. */
export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object") {
    // Airtable sometimes wraps values; try common shapes.
    const o = v as Record<string, unknown>;
    if ("value" in o) return num(o.value);
  }
  return 0;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface OverviewData {
  polished7d: number;
  polished30d: number;
  pressedToday: number;
  daily: { day: string; count: number }[];
  statusMix: { label: string; count: number }[];
  thicknessMix: { label: string; count: number }[];
  recentBatches: { batch: string; slabs: number; lastDate: string | null; design: string | null; designDiscrepancy: boolean }[];
}

// ---- Design name resolution --------------------------------------------
// A batch should carry a single slab design. Designs are stamped on several
// tables (Press.designName, PolishEntry.design, PolishQc.design, Mis.design).
// We gather the distinct values across all of them per batch so we can show
// the design and flag any in-batch discrepancy (more than one distinct value).
export interface BatchDesign {
  primary: string | null;             // most-frequently stamped design
  designs: string[];                  // all distinct designs seen in the batch
  discrepancy: boolean;               // true when designs.length > 1
  bySource: Record<string, string[]>; // distinct designs per source table
}

function emptyDesign(): BatchDesign {
  return { primary: null, designs: [], discrepancy: false, bySource: {} };
}

/** Distinct designs + counts for many batch keys at once (4 groupBy queries). */
export async function designsForBatchKeys(keys: string[]): Promise<Map<string, BatchDesign>> {
  const out = new Map<string, BatchDesign>();
  if (!keys.length) return out;
  const where = { batchKey: { in: keys } };

  const [press, polish, qc, mis] = await Promise.all([
    prisma.press.groupBy({ by: ["batchKey", "designName"], where: { ...where, designName: { not: null } }, _count: { _all: true } }),
    prisma.polishEntry.groupBy({ by: ["batchKey", "design"], where: { ...where, design: { not: null } }, _count: { _all: true } }),
    prisma.polishQc.groupBy({ by: ["batchKey", "design"], where: { ...where, design: { not: null } }, _count: { _all: true } }),
    prisma.mis.groupBy({ by: ["batchKey", "design"], where: { ...where, design: { not: null } }, _count: { _all: true } }),
  ]);

  // freq[key] -> Map<design, count>; src[key] -> { source -> Set<design> }
  const freq = new Map<string, Map<string, number>>();
  const src = new Map<string, Record<string, Set<string>>>();
  const add = (key: string | null, raw: string | null, n: number, source: string) => {
    if (!key) return;
    const design = (raw ?? "").trim();
    if (!design) return;
    if (!freq.has(key)) freq.set(key, new Map());
    const fm = freq.get(key)!;
    fm.set(design, (fm.get(design) ?? 0) + n);
    if (!src.has(key)) src.set(key, {});
    const sm = src.get(key)!;
    (sm[source] ??= new Set()).add(design);
  };
  for (const r of press) add(r.batchKey, r.designName, r._count._all, "Press");
  for (const r of polish) add(r.batchKey, r.design, r._count._all, "Polish");
  for (const r of qc) add(r.batchKey, r.design, r._count._all, "QC");
  for (const r of mis) add(r.batchKey, r.design, r._count._all, "MIS");

  for (const [key, fm] of freq) {
    const designs = [...fm.keys()].sort();
    const primary = [...fm.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const bySource: Record<string, string[]> = {};
    for (const [s, set] of Object.entries(src.get(key) ?? {})) bySource[s] = [...set].sort();
    out.set(key, { primary, designs, discrepancy: designs.length > 1, bySource });
  }
  return out;
}

/** Distinct designs for a single batch key. */
export async function designForBatch(key: string): Promise<BatchDesign> {
  if (!key) return emptyDesign();
  return (await designsForBatchKeys([key])).get(key) ?? emptyDesign();
}

export async function getOverview(): Promise<OverviewData> {
  const since30 = daysAgo(30);
  const since7 = daysAgo(7);
  const todayStart = daysAgo(0);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // The window predicates below are the OR expansion of COALESCE(col, imported_at) —
  // identical row set by COALESCE's definition (imported_at is NOT NULL), but the OR
  // shape lets the planner BitmapOr the 0038 indexes (created/date + imported_at)
  // instead of seq-scanning 44.7k polish_entry rows per bucket query (measured
  // 2026-08-14: the status-mix GROUP BY alone was ~200 ms as COALESCE). The COALESCE
  // stays in the SELECT list — only the WHERE had to become indexable.
  //
  // `grouped` (recent batches from Press) rides in the same Promise.all: it depends on
  // nothing above and used to be a third serialized await stage.
  const [polished7d, polished30d, pressedToday, dayRows, statusRows, pressKeys, grouped] = await Promise.all([
    prisma.polishEntry.count({ where: { OR: [{ created: { gte: since7 } }, { created: null, importedAt: { gte: since7 } }] } }),
    prisma.polishEntry.count({ where: { OR: [{ created: { gte: since30 } }, { created: null, importedAt: { gte: since30 } }] } }),
    prisma.press.count({ where: { date: { gte: todayStart } } }),
    // counted in the DB — same buckets as before, ~40 rows instead of ~20k
    (prisma as any).$queryRaw`SELECT to_char(COALESCE(created, imported_at), 'YYYY-MM-DD') AS k, COUNT(*)::int AS c FROM polish_entry WHERE (created >= ${since30} OR (created IS NULL AND imported_at >= ${since30})) GROUP BY 1` as Promise<{ k: string; c: number }[]>,
    (prisma as any).$queryRaw`SELECT COALESCE(NULLIF(TRIM(polishing_status), ''), '—') AS k, COUNT(*)::int AS c FROM polish_entry WHERE (created >= ${since30} OR (created IS NULL AND imported_at >= ${since30})) GROUP BY 1` as Promise<{ k: string; c: number }[]>,
    // batches pressed in the window — the thickness split itself comes from the
    // shared resolver below, not from any single station's column
    (prisma as any).$queryRaw`SELECT DISTINCT batch_key AS k FROM press WHERE batch_key IS NOT NULL AND (date >= ${since30} OR (date IS NULL AND imported_at >= ${since30})) AND COALESCE(date, imported_at) <= now() + interval '2 days'` as Promise<{ k: string }[]>,
    // Recent batches from Press. "Last date" = latest PRESS date that is NOT a
    // future-dated typo (a press row mis-dated e.g. 2028 must not float the batch
    // to the top); the 2-day grace tolerates IST/UTC skew on today's rows; the
    // slab count still includes every press row.
    prisma.$queryRaw`
      SELECT batch_key, COUNT(*)::int AS slabs, MAX(date) FILTER (WHERE date <= now() + interval '2 days') AS last_date
      FROM press
      WHERE batch_key IS NOT NULL
      GROUP BY batch_key
      ORDER BY MAX(date) FILTER (WHERE date <= now() + interval '2 days') DESC NULLS LAST
      LIMIT 10` as Promise<{ batch_key: string; slabs: number; last_date: Date | null }[]>,
  ]);

  // Thickness mix = slabs PRESSED in the last 30 days, split by the per-slab thickness
  // the shared resolver returns (Jot -> Distributor -> Kreos -> Polish Entry -> Polish QC).
  // It used to read polish_entry.slab_thickness raw, which (a) counted polishing
  // throughput rather than production and (b) rendered "3cm" and "3 cm" as two bars.
  // `since30` is passed through so a batch straddling the window contributes only the
  // slabs actually pressed inside it.
  //
  // Runs in parallel with the recent-batch design lookup: the two chains are
  // independent (thickness needs pressKeys, designs need `grouped`), and running
  // them back to back was one more serialized round-trip wave for nothing.
  const [thickMixMap, designMap] = await Promise.all([
    thicknessMixByBatch(pressKeys.map((r) => String(r.k)), since30),
    designsForBatchKeys(grouped.map((g) => g.batch_key)),
  ]);
  const thicknessMix = mixBars(mergeMix(thickMixMap.values()));

  const dayMap = new Map<string, number>(dayRows.map((r) => [r.k, r.c]));
  const statusMap = new Map<string, number>(statusRows.map((r) => [r.k, r.c]));
  const daily = [...dayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, count]) => ({ day: day.slice(5), count }));
  const statusMix = [...statusMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));

  const recentBatches = grouped.map((g) => {
    const d = designMap.get(g.batch_key);
    return {
      batch: g.batch_key,
      slabs: Number(g.slabs),
      lastDate: g.last_date ? new Date(g.last_date).toISOString().slice(0, 10) : null,
      design: d?.primary ?? null,
      designDiscrepancy: d?.discrepancy ?? false,
    };
  });

  return {
    polished7d,
    polished30d,
    pressedToday,
    daily,
    statusMix,
    thicknessMix,
    recentBatches,
  };
}

// Slabs produced per stage. Press, Oven and Jot should each see the same
// number of slabs for a batch; a mismatch is worth surfacing.
export interface SlabsProduced {
  press: number;
  oven: number;
  jot: number;
  value: number;        // representative count (max across stages)
  discrepancy: boolean; // true when stages with data disagree
}

// ---- Slab-level audit ---------------------------------------------------
// Per station, find slab numbers entered twice (duplicates) and slab numbers
// that are present in other stations but missing here, plus true sequence
// gaps (slab numbers absent from EVERY station between min and max).
export interface StationAudit {
  label: string;
  total: number;                              // total rows for the batch
  distinct: number;                           // distinct slab numbers
  duplicates: { slab: number; count: number }[]; // slab entered more than once
  missing: number[];                          // slabs seen elsewhere but not here
  autoAdded: number[];                        // placeholder rows auto-created (params missing)
}
export interface SlabAudit {
  stations: StationAudit[];
  range: { min: number; max: number } | null; // overall slab-number range
  globalMissing: number[];                     // gaps absent from every station
  notes: string[];                             // structural anomalies (missing stage / both-or-neither distributor+kreos)
  hasIssues: boolean;
  added: number[];                             // slab numbers manually added to this batch (expected even if absent)
  skipped: number[];                           // slab numbers intentionally skipped (never produced) — excluded from missing
  confirmed: { by: string | null; at: string } | null; // range confirmed-as-correct
  blankRows: { model: string; label: string; count: number }[]; // rows with no slab number (removable)
  blankTotal: number;                          // total slab-less rows across stations
}

const AUDIT_STATIONS: string[] = ["Press", "Distributor", "Kreos", "Oven", "Jot", "Polish Entry", "Polish QC"];

async function slabAuditForKeys(keys: string[], foreign: Set<number> = new Set()): Promise<SlabAudit> {
  const where = { batchKey: { in: keys } };
  const rowsByStation = await Promise.all([
    prisma.press.findMany({ where, select: { slabNumber: true, remarks: true } }),
    prisma.distributor.findMany({ where, select: { slabNumber: true, remarks: true } }),
    prisma.kreos.findMany({ where, select: { slabNumber: true, remarks: true } }),
    prisma.oven.findMany({ where, select: { slabNumber: true, remarks: true } }),
    prisma.jot.findMany({ where, select: { slabNumber: true, remarks: true } }),
    prisma.polishEntry.findMany({ where, select: { slabNumber: true, remarks: true } }),
    prisma.polishQc.findMany({ where, select: { slabNumber: true, remarks: true } }),
  ]);

  // Rows with no slab number at all — they inflate raw row counts (false "slab
  // count mismatch") but carry no slab. Surfaced so a manager can remove them.
  const STATION_MODEL = ["Press", "Distributor", "Kreos", "Oven", "Jot", "PolishEntry", "PolishQc"];
  const blankRows: { model: string; label: string; count: number }[] = [];
  rowsByStation.forEach((rows, i) => {
    let c = 0;
    for (const r of rows) { const n = r.slabNumber; if (n == null || !Number.isFinite(n)) c++; }
    if (c > 0) blankRows.push({ model: STATION_MODEL[i], label: AUDIT_STATIONS[i], count: c });
  });
  const blankTotal = blankRows.reduce((a, b) => a + b.count, 0);

  const union = new Set<number>();
  const autoByStation: Set<number>[] = [];
  const foreignRows: { label: string; count: number }[] = []; // rows stamped with OUR key whose slab belongs to a sibling
  const counts = rowsByStation.map((rows, i) => {
    const m = new Map<number, number>();
    const auto = new Set<number>();
    let fgn = 0;
    for (const r of rows) {
      const n = r.slabNumber;
      if (n == null || !Number.isFinite(n)) continue;
      if (foreign.has(n)) { fgn++; continue; } // this slab belongs to a sibling sub-batch
      m.set(n, (m.get(n) ?? 0) + 1);
      union.add(n);
      if (String((r as { remarks?: string | null }).remarks ?? "").startsWith(AUTOFILL_PREFIX)) auto.add(n);
    }
    if (fgn) foreignRows.push({ label: AUDIT_STATIONS[i], count: fgn });
    autoByStation.push(auto);
    return m;
  });

  const edits = await getRangeEdits(keys[0] ?? "");
  for (const n of edits.added) union.add(n);

  // Overall range + true gaps. Computed over the WHOLE-NUMBER sequence only, so an
  // "insert" slab (a decimal like 1.1 shown as "1a") doesn't disable gap-detection;
  // intentionally-skipped numbers are excluded from the gaps.
  const skippedSet = new Set(edits.skipped);
  let range: { min: number; max: number } | null = null;
  const globalMissing: number[] = [];
  const intSlabs = [...union].filter((n) => Number.isInteger(n));
  if (intSlabs.length) {
    const min = Math.min(...intSlabs);
    const max = Math.max(...intSlabs);
    range = { min, max };
    for (let i = min; i <= max; i++) if (!union.has(i) && !skippedSet.has(i) && !foreign.has(i)) globalMissing.push(i);
  }

  const stations: StationAudit[] = AUDIT_STATIONS.map((label, i) => {
    const m = counts[i];
    if (m.size === 0) return null; // station not used for this batch
    const duplicates = [...m.entries()]
      .filter(([, c]) => c > 1)
      .map(([slab, count]) => ({ slab, count }))
      .sort((a, b) => a.slab - b.slab);
    const missing = [...union].filter((n) => !m.has(n) && !skippedSet.has(n)).sort((a, b) => a - b);
    const total = [...m.values()].reduce((a, c) => a + c, 0);
    const autoAdded = [...(autoByStation[i] ?? new Set<number>())].filter((n) => !duplicates.some((d) => d.slab === n)).sort((a, b) => a - b);
    return { label, total, distinct: m.size, duplicates, missing: missing.filter((n) => !(autoByStation[i] ?? new Set<number>()).has(n)), autoAdded };
  }).filter((s): s is StationAudit => s !== null);

  // Structural checks against the expected pipeline:
  //  always-present per-slab stations, and exactly one of Distributor/Kreos.
  const sizeByLabel = new Map(AUDIT_STATIONS.map((label, i) => [label, counts[i].size] as const));
  const REQUIRED = ["Press", "Oven", "Jot", "Polish Entry", "Polish QC"];
  const notes: string[] = [];
  for (const r of REQUIRED) if ((sizeByLabel.get(r) ?? 0) === 0) notes.push(`No ${r} records — expected in every batch.`);
  for (const f of foreignRows)
    notes.push(`${f.count} ${f.label} row(s) are stamped with this batch but their slab numbers belong to a design-switch sub-batch — they are excluded here; re-stamp them at the station (or use Rectify) so the batch reads clean.`);
  const dHas = (sizeByLabel.get("Distributor") ?? 0) > 0;
  const kHas = (sizeByLabel.get("Kreos") ?? 0) > 0;
  const pressHas = (sizeByLabel.get("Press") ?? 0) > 0;
  if (dHas && kHas) notes.push("Both Distributor and Kreos have records — exactly one machine should run per batch.");
  if (!dHas && !kHas && pressHas) notes.push("Neither Distributor nor Kreos has records — exactly one is expected.");

  const hasIssues =
    globalMissing.length > 0 ||
    notes.length > 0 ||
    stations.some((s) => s.duplicates.length > 0 || s.missing.length > 0 || s.autoAdded.length > 0);

  return { stations, range, globalMissing, notes, hasIssues, added: edits.added, skipped: edits.skipped, confirmed: edits.confirmed, blankRows, blankTotal };
}

export interface BatchData {
  key: string;
  found: boolean;
  counts: { mixer: number; press: number; oven: number; jot: number; polishEntry: number; polishQc: number };
  slabsProduced: SlabsProduced;
  slabAudit: SlabAudit;
  totalMixWeight: number;
  totalSlabWeight: number;
  wastageKg: number;
  wastagePct: number | null;
  perMixer: [number, number, number, number];
  qcGrades: { label: string; count: number }[];
  thickness: { label: string; count: number }[];
  design: BatchDesign;
  family: { parent: string; isSub: boolean; solo: boolean; mixFamilyWide: boolean; keys: string[]; members: { key: string; design: string | null; slabs: number }[] };
}

/** Scope for the batch readers: `solo` excludes the design-switch sub-batches. */
export interface BatchScope { solo?: boolean }

// Resolve the family of batch keys to roll up: a parent ("1350") gathers itself
// plus any design-switch sub-batches ("1350-A", "1350-B"); a sub-batch stands alone.
export async function batchFamily(input: string): Promise<{ key: string; parent: string; isSub: boolean; keys: string[] }> {
  const key = normalizeBatch(input);
  const parent = parentBatch(input);
  const isSub = isSubBatch(input);
  if (!key) return { key, parent, isSub, keys: [] };
  if (isSub) return { key, parent, isSub, keys: [key] };
  let keys = [key];
  try {
    // Discover sub-batches from every stream that stamps a batch key, so the
    // family is complete whether the suffix was written at the line head (slabs)
    // or by the mixer operator (cycles).
    const like = key + "-%";
    const rows = await prisma.$queryRaw<{ batch_key: string }[]>`
      SELECT DISTINCT batch_key FROM (
        SELECT batch_key FROM press WHERE batch_key = ${key} OR batch_key LIKE ${like}
        UNION SELECT batch_key FROM distributor WHERE batch_key = ${key} OR batch_key LIKE ${like}
        UNION SELECT batch_key FROM kreos WHERE batch_key = ${key} OR batch_key LIKE ${like}
        UNION SELECT batch_key FROM mixer_cycle WHERE batch_key = ${key} OR batch_key LIKE ${like}
      ) t WHERE batch_key IS NOT NULL`;
    keys = [...new Set([key, ...rows.map((r) => r.batch_key).filter(Boolean)])];
  } catch { /* fall back to the single key */ }
  return { key, parent, isSub, keys };
}

export async function getBatch(input: string, scope?: BatchScope): Promise<BatchData> {
  const { key, parent, isSub, keys: famKeys } = await batchFamily(input);
  // solo = show the parent on its own, excluding its design-switch sub-batches. The
  // family is still resolved in full so the chips can render and link back to it.
  const solo = !!scope?.solo && !isSub && famKeys.length > 1;
  const keys = solo ? [key] : famKeys;
  // A sub-batch stands alone for DATA, but its page should still show the family bar (the
  // chips + the way back), so the family is resolved for display only.
  const dispKeys = isSub ? (await batchFamily(parent)).keys : famKeys;
  const where = { batchKey: { in: keys } };
  const famWhere = { batchKey: { in: dispKeys } };
  // Mixer cycles are often stamped ONLY on the parent key even when the slab
  // stations split into sub-batches — the mix for the whole run then sits on the
  // parent. In that case a solo view cannot apportion the mix: dividing a
  // family-wide mix weight by a parent-only slab weight invents a wastage figure
  // (measured: 21.6% instead of the true 9.4% on one live batch). So we detect it,
  // keep the mixer family-wide, and suppress the wastage % rather than fabricate one.
  const subKeys = famKeys.filter((k) => k !== key);
  // Ownership of a slab is decided by press + the line head, NOT by whichever station
  // typed the batch on its form. In a solo view the sibling sub-batch's slabs are simply
  // not ours — even when a station mis-stamped a row with our key. Without this, 43 Polish
  // Entry rows carrying 1376-A's slabs stretched 1376's range to 147757 and invented "391
  // missing from every station".
  let foreign = new Set<number>();
  // The foreign-slab lookup and the sub-batch mixer count are independent reads that
  // used to run back to back — one round-trip wave each (part of /batch's measured
  // 5+ serialized stages, 2026-08-14). Same two queries, one wave.
  const [, subMixerCount] = await Promise.all([
    (async () => {
      if (!(solo && subKeys.length)) return;
      try {
        const rows = await prisma.$queryRaw<{ s: number }[]>`
          SELECT DISTINCT slab_number::float8 s FROM (
            SELECT slab_number, batch_key FROM press       WHERE batch_key = ANY(${subKeys}::text[])
            UNION ALL SELECT slab_number, batch_key FROM distributor WHERE batch_key = ANY(${subKeys}::text[])
            UNION ALL SELECT slab_number, batch_key FROM kreos       WHERE batch_key = ANY(${subKeys}::text[])
          ) t WHERE slab_number IS NOT NULL`;
        foreign = new Set(rows.map((r) => Number(r.s)));
      } catch (e) { console.error("solo-view slab ownership lookup failed:", e); /* audit degrades to the old behaviour */ }
    })(),
    solo && subKeys.length > 0 ? prisma.mixerCycle.count({ where: { batchKey: { in: subKeys } } }) : Promise.resolve(-1),
  ]);
  const mixFamilyWide = solo && subKeys.length > 0 && subMixerCount === 0;
  const mixWhere = mixFamilyWide ? famWhere : where;
  // thicknessMixByBatch rides in this Promise.all too: it depends only on `keys`,
  // but used to run as its own await stage after everything else had finished.
  const [design, audit, [mixer, press, polishEntryCount, qcRows, ovenCount, jotCount], famDesigns, famSlabs, thickMixMap] = await Promise.all([
    designForBatch(key),
    slabAuditForKeys(keys, foreign),
    Promise.all([
      prisma.mixerCycle.findMany({
        where: mixWhere,
        select: {
          totalCycleWeight: true,
          m1W1: true, m1W2: true, m1W3: true, m1W4: true, m1W5: true, m1FW: true, m1RW: true,
          m2W1: true, m2W2: true, m2W3: true, m2W4: true, m2W5: true, m2FW: true, m2RW: true,
          m3W1: true, m3W2: true, m3W3: true, m3W4: true, m3W5: true, m3FW: true, m3RW: true,
          m4W1: true, m4W2: true, m4W3: true, m4W4: true, m4W5: true, m4FW: true, m4RW: true,
        },
      }),
      prisma.press.findMany({ where, select: { slabWeight: true } }),
      prisma.polishEntry.count({ where }),
      prisma.polishQc.findMany({
        where,
        select: { qualityGrade: true },
      }),
      prisma.oven.count({ where }),
      prisma.jot.count({ where }),
    ]),
    dispKeys.length > 1 ? designsForBatchKeys(dispKeys) : Promise.resolve(new Map()),
    dispKeys.length > 1 ? prisma.press.groupBy({ by: ["batchKey"], where: famWhere, _count: { _all: true } }) : Promise.resolve([] as { batchKey: string | null; _count: { _all: number } }[]),
    thicknessMixByBatch(keys),
  ]);

  const rawCycleWeight = (m: Record<string, unknown>) => {
    let t = 0;
    for (let x = 1; x <= 4; x++) { for (let g = 1; g <= 5; g++) t += num(m[`m${x}W${g}`]); t += num(m[`m${x}FW`]) + num(m[`m${x}RW`]); }
    return t;
  };
  const totalMixWeight = mixer.reduce((a, m) => a + (num(m.totalCycleWeight) || rawCycleWeight(m as Record<string, unknown>)), 0);
  const totalSlabWeight = press.reduce((a, p) => a + (p.slabWeight ?? 0), 0);
  const perMixer: [number, number, number, number] = [0, 0, 0, 0];
  for (const m of mixer) {
    perMixer[0] += (m.m1W1 ?? 0) + (m.m1W2 ?? 0) + (m.m1W3 ?? 0) + (m.m1W4 ?? 0) + (m.m1W5 ?? 0) + (m.m1FW ?? 0);
    perMixer[1] += (m.m2W1 ?? 0) + (m.m2W2 ?? 0) + (m.m2W3 ?? 0) + (m.m2W4 ?? 0) + (m.m2W5 ?? 0) + (m.m2FW ?? 0);
    perMixer[2] += (m.m3W1 ?? 0) + (m.m3W2 ?? 0) + (m.m3W3 ?? 0) + (m.m3W4 ?? 0) + (m.m3W5 ?? 0) + (m.m3FW ?? 0);
    perMixer[3] += (m.m4W1 ?? 0) + (m.m4W2 ?? 0) + (m.m4W3 ?? 0) + (m.m4W4 ?? 0) + (m.m4W5 ?? 0) + (m.m4FW ?? 0);
  }

  // mixFamilyWide: the mix belongs to the whole run but the slab weight is
  // parent-only, so neither wastage figure is meaningful — report none.
  const wastageKg = mixFamilyWide ? 0 : totalMixWeight - totalSlabWeight;
  const wastagePct =
    !mixFamilyWide && totalMixWeight > 0 && totalSlabWeight > 0 ? (wastageKg / totalMixWeight) * 100 : null;

  const gradeMap = new Map<string, number>();
  for (const q of qcRows) {
    const g = q.qualityGrade?.trim() || "—";
    gradeMap.set(g, (gradeMap.get(g) ?? 0) + 1);
  }
  // Thickness comes from the shared resolver, counted over the batch's press slabs —
  // the same numbers the production report and the Telegram bot show. It used to be
  // built from polish_qc rows only, using the RAW string, so a batch was split across
  // a "3cm" and a "3 cm" bar and unpolished slabs never appeared at all.
  let thicknessBars = mixBars(mergeMix(thickMixMap.values()));
  if (!thicknessBars.length) {
    // Older batches carry station thickness but NO press rows (nothing to anchor to),
    // and an empty card would hide data the old QC-only card did show. Count the
    // stations' own slabs in that case — the resolver still decides each slab's value.
    const bySlab = await thicknessBySlab({ keys });
    const m = new Map<string, number>();
    for (const t of bySlab.values()) m.set(t, (m.get(t) ?? 0) + 1);
    thicknessBars = mixBars({ mix: m, noThickness: 0, total: bySlab.size });
  }

  const pressCount = press.length;
  const nonzero = [pressCount, ovenCount, jotCount].filter((n) => n > 0);
  const slabsProduced: SlabsProduced = {
    press: pressCount,
    oven: ovenCount,
    jot: jotCount,
    value: Math.max(pressCount, ovenCount, jotCount),
    discrepancy: new Set(nonzero).size > 1,
  };

  return {
    key,
    // In solo mode keep the page rendered even when the parent key itself holds no
    // rows — otherwise the chip dead-ends on "no records" with no way back to the family.
    found: solo || mixer.length + pressCount + polishEntryCount + qcRows.length + ovenCount + jotCount > 0,
    counts: {
      mixer: mixer.length,
      press: pressCount,
      oven: ovenCount,
      jot: jotCount,
      polishEntry: polishEntryCount,
      polishQc: qcRows.length,
    },
    slabsProduced,
    slabAudit: audit,
    totalMixWeight,
    totalSlabWeight,
    wastageKg,
    wastagePct,
    perMixer,
    qcGrades: [...gradeMap.entries()].map(([label, count]) => ({ label, count })),
    thickness: thicknessBars,
    design,
    family: {
      parent, isSub, solo, mixFamilyWide, keys: dispKeys,
      members: dispKeys.map((k) => ({ key: k, design: (famDesigns as Map<string, BatchDesign>).get(k)?.primary ?? null, slabs: Number((famSlabs as { batchKey: string | null; _count: { _all: number } }[]).find((r) => r.batchKey === k)?._count?._all ?? (dispKeys.length === 1 ? press.length : 0)) })),
    },
  };
}

// ---- Search batches by design name -------------------------------------
export interface DesignMatch { batch: string; designs: string[]; discrepancy: boolean; slabs: number; lastDate: string | null; }

/** Find batches whose design name matches a query (case-insensitive, partial). */
export async function searchBatchesByDesign(input: string, limit = 60): Promise<DesignMatch[]> {
  const q = input.trim();
  if (!q) return [];
  const like = { contains: q, mode: "insensitive" as const };

  const [press, polish, mis] = await Promise.all([
    prisma.press.findMany({ where: { designName: like, batchKey: { not: null } }, select: { batchKey: true }, distinct: ["batchKey"], take: 2000 }),
    prisma.polishEntry.findMany({ where: { design: like, batchKey: { not: null } }, select: { batchKey: true }, distinct: ["batchKey"], take: 2000 }),
    prisma.mis.findMany({ where: { design: like, batchKey: { not: null } }, select: { batchKey: true }, distinct: ["batchKey"], take: 2000 }),
  ]);
  const keys = [...new Set([...press, ...polish, ...mis].map((r) => r.batchKey).filter((k): k is string => !!k))].slice(0, limit);
  if (!keys.length) return [];

  const [designMap, pressCounts] = await Promise.all([
    designsForBatchKeys(keys),
    prisma.press.groupBy({ by: ["batchKey"], where: { batchKey: { in: keys } }, _count: { _all: true }, _max: { date: true } }),
  ]);
  const countMap = new Map(pressCounts.map((c) => [c.batchKey, c]));

  return keys
    .map((batch) => {
      const d = designMap.get(batch);
      const c = countMap.get(batch);
      return {
        batch,
        designs: d?.designs ?? [],
        discrepancy: d?.discrepancy ?? false,
        slabs: c?._count._all ?? 0,
        lastDate: c?._max.date ? c._max.date.toISOString().slice(0, 10) : null,
      };
    })
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.batch.localeCompare(b.batch));
}

// ---- Records Browser ----------------------------------------------------
export const RECORD_VIEWS = {
  PolishEntry: {
    label: "Polish Entry",
    columns: ["batchNumber", "slabNumber", "design", "polishingStatus", "slabThickness", "created"],
  },
  PolishQc: {
    label: "Polish QC",
    columns: ["batchNumber", "slabNumber", "qualityGrade", "qualityIssue", "inspector", "createdTime"],
  },
  Press: {
    label: "Press",
    columns: ["batch", "slabNumber", "designName", "slabWeight", "operator", "date"],
  },
  Mis: {
    label: "MIS (Shifts)",
    columns: ["date", "hour", "batch", "design", "startingSlabNumber", "endingSlabNumber"],
  },
  Silo: {
    label: "SILO",
    columns: ["batch"],
  },
} as const;

export type RecordView = keyof typeof RECORD_VIEWS;

const delegateMap: Record<RecordView, () => { findMany: Function; count: Function }> = {
  PolishEntry: () => prisma.polishEntry,
  PolishQc: () => prisma.polishQc,
  Press: () => prisma.press,
  Mis: () => prisma.mis,
  Silo: () => prisma.silo,
};

export async function listRecords(view: RecordView, page: number, batch?: string) {
  const pageSize = 25;
  const cfg = RECORD_VIEWS[view];
  const d = delegateMap[view]();
  const where = batch ? { batchKey: normalizeBatch(batch) } : {};
  // Select ONLY the view's fixed columns — /records renders nothing else. WHY
  // (measured 2026-08-14): the unselected findMany shipped all ~90–140 columns per row
  // (~4 KB/row on polish_qc) to paint a 6-column grid; same 25 rows, same order.
  const select = Object.fromEntries(cfg.columns.map((c) => [c, true]));
  const [rows, total] = await Promise.all([
    d.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { importedAt: "desc" }, select }),
    d.count({ where }),
  ]);
  return { rows: rows as Record<string, unknown>[], total, pageSize, columns: cfg.columns as readonly string[] };
}

// ---- Production Report --------------------------------------------------
export async function getProductionReport(input: string) {
  const batch = await getBatch(input);
  const [mis, mixerTimes] = await Promise.all([
    prisma.mis.findMany({
      where: { batchKey: batch.key },
      select: { reasonForDeviation: true, breakdownDelayDurationMechanicalOrElectricalMinutes: true, cleaningDelayDurationMinutes: true },
    }),
    prisma.mixerCycle.findMany({
      where: { batchKey: batch.key },
      select: { mixerStartTime: true, mixerEndTime: true },
    }),
  ]);
  const starts = mixerTimes.map((m) => m.mixerStartTime).filter(Boolean) as Date[];
  const ends = mixerTimes.map((m) => m.mixerEndTime).filter(Boolean) as Date[];
  const opening = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
  const closing = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
  const reasons = [...new Set(mis.flatMap((m) => m.reasonForDeviation ?? []))];
  const cleaningDelay = mis.reduce((a, m) => a + (m.cleaningDelayDurationMinutes ?? 0), 0);
  const breakdownDelay = mis.reduce((a, m) => a + (m.breakdownDelayDurationMechanicalOrElectricalMinutes ?? 0), 0);

  return { batch, opening, closing, reasons, cleaningDelay, breakdownDelay, cycles: batch.counts.mixer };
}

// ---- Slab drill-down (focused lists behind each metric) -----------------
export type SlabStation = "press" | "distributor" | "kreos" | "oven" | "jot" | "polishEntry" | "polishQc" | "mixer";

export const STATION_LABEL: Record<SlabStation, string> = {
  press: "Press",
  distributor: "Distributor",
  kreos: "Kreos",
  oven: "Oven",
  jot: "Jot",
  polishEntry: "Polish Entry",
  polishQc: "Polish QC",
  mixer: "Mixer cycles",
};

export interface SlabCol { key: string; label: string; kind?: "date" | "num" | "duration" }

export interface StationSlabList {
  key: string;
  station: SlabStation;
  model: string;
  label: string;
  columns: SlabCol[];
  rows: Record<string, unknown>[];
  dupSlabs: number[];   // slab numbers (or cycles) appearing more than once
  idKey: string;        // the column that identifies a row (slabNumber / cycle)
}

const STATION_SPEC: Record<SlabStation, { idKey: string; columns: SlabCol[]; order: string }> = {
  press: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "designName", label: "Design" },
    { key: "slabWeight", label: "Weight (kg)", kind: "num" },
    { key: "operator", label: "Operator" },
    { key: "date", label: "Date", kind: "date" },
  ] },
  distributor: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "designName", label: "Design" },
    { key: "slabThickness", label: "Thickness" },
    { key: "operator", label: "Operator" },
    { key: "date", label: "Date", kind: "date" },
  ] },
  kreos: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "designName", label: "Design" },
    { key: "slabThickness", label: "Thickness" },
    { key: "slabWeight", label: "Weight (kg)", kind: "num" },
    { key: "operator", label: "Operator" },
    { key: "date", label: "Date", kind: "date" },
  ] },
  oven: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "inTime", label: "In time", kind: "duration" },
    { key: "outTime", label: "Out time", kind: "duration" },
    { key: "cookingTime", label: "Cooking (min)", kind: "num" },
    { key: "date", label: "Date", kind: "date" },
  ] },
  jot: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "thickness", label: "Thickness" },
    { key: "operator", label: "Operator" },
    { key: "date", label: "Date", kind: "date" },
  ] },
  polishEntry: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "design", label: "Design" },
    { key: "polishingStatus", label: "Status" },
    { key: "slabThickness", label: "Thickness" },
    { key: "created", label: "Created", kind: "date" },
  ] },
  polishQc: { idKey: "slabNumber", order: "slabNumber", columns: [
    { key: "slabNumber", label: "Slab #", kind: "num" },
    { key: "slabThickness", label: "Thickness" },
    { key: "qualityGrade", label: "Grade" },
    { key: "qualityIssue", label: "Issue" },
    { key: "inspector", label: "Inspector" },
    { key: "createdTime", label: "Created", kind: "date" },
  ] },
  mixer: { idKey: "cycle", order: "cycle", columns: [
    { key: "cycle", label: "Cycle", kind: "num" },
    { key: "operator", label: "Operator" },
    { key: "totalCycleWeight", label: "Cycle weight (kg)", kind: "num" },
    { key: "mixerStartTime", label: "Start" },
    { key: "mixerEndTime", label: "End" },
  ] },
};

function stationDelegate(station: SlabStation) {
  switch (station) {
    case "press": return prisma.press;
    case "distributor": return prisma.distributor;
    case "kreos": return prisma.kreos;
    case "oven": return prisma.oven;
    case "jot": return prisma.jot;
    case "polishEntry": return prisma.polishEntry;
    case "polishQc": return prisma.polishQc;
    case "mixer": return prisma.mixerCycle;
  }
}

export async function getStationSlabs(input: string, station: SlabStation, onlyDup = false, scope?: BatchScope): Promise<StationSlabList> {
  // Family-scoped like getMixerCycles/getSiloBags: the batch page's duplicate counts are
  // rolled up over the family (a parent plus its design-switch sub-batches), so the
  // drill-down has to search the SAME set — otherwise clicking "147583x2" on 1376 lands
  // on a page that filters 1376 alone, finds nothing (the duplicate is 1376-A's) and
  // says "none", contradicting the number that linked there.
  const { key, isSub, keys: famKeys } = await batchFamily(input);
  const keys = scope?.solo && !isSub ? [key] : famKeys;
  const spec = STATION_SPEC[station];
  const MODEL: Record<SlabStation, string> = { press: "Press", distributor: "Distributor", kreos: "Kreos", oven: "Oven", jot: "Jot", polishEntry: "PolishEntry", polishQc: "PolishQc", mixer: "MixerCycle" };
  const select: Record<string, boolean> = { id: true };
  for (const c of spec.columns) select[c.key] = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await (stationDelegate(station) as any).findMany({
    where: { batchKey: { in: keys } },
    select,
    orderBy: { [spec.order]: "asc" },
  });

  const counts = new Map<number, number>();
  for (const r of rows) {
    const v = r[spec.idKey];
    if (typeof v === "number" && Number.isFinite(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const dupSlabs = [...counts.entries()].filter(([, c]) => c > 1).map(([s]) => s).sort((a, b) => a - b);
  const dupSet = new Set(dupSlabs);
  const filtered = onlyDup ? rows.filter((r) => dupSet.has(r[spec.idKey])) : rows;

  return { key, station, model: MODEL[station], label: STATION_LABEL[station], columns: spec.columns, rows: filtered, dupSlabs, idKey: spec.idKey };
}

// Slabs missing from one station but present elsewhere in the batch, with the
// list of stations that DO have each slab.
export interface MissingPresence {
  key: string;
  station: SlabStation;
  label: string;
  rows: { slab: number; presentIn: string[] }[];
  skipped: number[]; // slab numbers already marked as intentionally skipped
}

export async function getMissingSlabs(input: string, station: SlabStation): Promise<MissingPresence> {
  const key = normalizeBatch(input);
  const where = { batchKey: key };
  const auditStations: { station: SlabStation; label: string }[] = [
    { station: "press", label: "Press" },
    { station: "distributor", label: "Distributor" },
    { station: "kreos", label: "Kreos" },
    { station: "oven", label: "Oven" },
    { station: "jot", label: "Jot" },
    { station: "polishEntry", label: "Polish Entry" },
    { station: "polishQc", label: "Polish QC" },
  ];
  const sets = await Promise.all(auditStations.map(async (a) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (stationDelegate(a.station) as any).findMany({ where, select: { slabNumber: true, remarks: true } });
    const set = new Set<number>();
    for (const r of rows) if (typeof r.slabNumber === "number" && Number.isFinite(r.slabNumber)) set.add(r.slabNumber);
    return { ...a, set };
  }));
  const union = new Set<number>();
  for (const s of sets) for (const n of s.set) union.add(n);
  const { skipped } = await getRangeEdits(key);
  const skippedSet = new Set(skipped);
  const me = sets.find((s) => s.station === station);
  const missing = [...union].filter((n) => !(me?.set.has(n)) && !skippedSet.has(n)).sort((a, b) => a - b);
  const rows = missing.map((slab) => ({
    slab,
    presentIn: sets.filter((s) => s.set.has(slab)).map((s) => s.label),
  }));
  return { key, station, label: STATION_LABEL[station], rows, skipped };
}

// ---- Mixer cycle & SILO details for the batch lookup --------------------
// One grit line within a cycle: which mixer, which grit category, how much, from
// which silo. Filler and resin are summarised per cycle (no per-category split).
export interface MixerLine { mixer: number; kind: "grit" | "filler" | "resin"; label: string; kg: number; silo: string | null; }
export interface MixerCycleRow {
  cycle: number | null;
  operator: string | null;
  mixers: number[];
  cycleWeight: number;
  start: Date | null;
  end: Date | null;
  gritKg: number;            // total grit across all mixers/categories
  fillerKg: number;          // total filler
  resinKg: number;           // total resin
  gritSilos: string[];       // distinct silos grit was drawn from
  fillerSilo: string | null; // filler silo / buffer
  lines: MixerLine[];        // per-mixer grit / filler / resin detail (for expand)
}

export async function getMixerCycles(input: string, scope?: BatchScope): Promise<MixerCycleRow[]> {
  const { key, isSub, keys: famKeys } = await batchFamily(input);
  const keys = scope?.solo && !isSub ? [key] : famKeys;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await prisma.mixerCycle.findMany({ where: { batchKey: { in: keys } }, orderBy: { cycle: "asc" } });
  return rows.map((r) => {
    const mixers = [r.mixer1 ? 1 : 0, r.mixer2 ? 2 : 0, r.mixer3 ? 3 : 0, r.mixer4 ? 4 : 0].filter((n) => n > 0);
    const fillerRaw = r.fillerSiloBuffer;
    const fillerSilo = fillerRaw != null && String(fillerRaw).trim() !== "" ? String(fillerRaw).trim() : null;
    const lines: MixerLine[] = [];
    const gritSiloSet = new Set<string>();
    let gritKg = 0, fillerKg = 0, resinKg = 0;
    for (const m of [1, 2, 3, 4]) {
      for (const g of [1, 2, 3, 4, 5]) {
        const w = num(r[`m${m}W${g}`]);
        const snRaw = r[`m${m}G${g}Sn`];
        const silo = snRaw != null && String(snRaw).trim() !== "" ? String(snRaw).trim() : null;
        if (w > 0) {
          gritKg += w;
          if (silo) gritSiloSet.add(silo);
          lines.push({ mixer: m, kind: "grit", label: `G${g}`, kg: w, silo });
        }
      }
      const fw = num(r[`m${m}FW`]);
      fillerKg += fw;
      if (fw > 0) lines.push({ mixer: m, kind: "filler", label: "Filler", kg: fw, silo: fillerSilo });
      const rw = num(r[`m${m}RW`]);
      resinKg += rw;
      if (rw > 0) lines.push({ mixer: m, kind: "resin", label: "Resin", kg: rw, silo: null });
    }
    return {
      cycle: r.cycle,
      operator: r.operator,
      mixers,
      cycleWeight: num(r.totalCycleWeight),
      start: r.mixerStartTime,
      end: r.mixerEndTime,
      gritKg, fillerKg, resinKg,
      gritSilos: [...gritSiloSet],
      fillerSilo,
      lines,
    };
  });
}

export interface SiloRow {
  increment: number | null;
  siloNo: string | null;
  sku: string | null;
  weight: number | null;
  remaining: number | null;
  date: Date | null;
  assignee: string | null;
  bag: string | null;
  supplier: string | null;   // supplier name(s) of the bag(s) in this silo
  size: string | null;       // grit/filler size(s) of the bag(s) in this silo
  grade: string | null;      // grade(s) of the bag(s) in this silo
  shade: string | null;      // grit/filler shade (from the linked RM bag)
}

// Coerce a Json scalar/array (e.g. ["A&A Silicates"]) to a deduped, comma-joined string.
function jstr(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const a = [...new Set(v.filter(Boolean).map((x) => String(x).trim()).filter(Boolean))];
    return a.length ? a.join(", ") : null;
  }
  const str = String(v).trim();
  return str || null;
}
export async function getSiloBags(input: string, scope?: BatchScope): Promise<SiloRow[]> {
  const { key, isSub, keys: famKeys } = await batchFamily(input);
  const keys = scope?.solo && !isSub ? [key] : famKeys;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await prisma.silo.findMany({
    where: { batchKey: { in: keys } },
    select: {
      siloIncrement: true, siloNo: true, sku: true, weight: true,
      remainingWeight: true, date: true, assignee: true, invNoBagNo: true,
      sizeFromUsedBag: true, nameFromSupplierMasterFromUsedBag: true, gradeFromUsedBag: true, rmIds: true,
    },
    orderBy: { siloIncrement: "asc" },
  });
  // Shade isn't on the silo bag — it's on the linked RM (grit shade for grit, filler shade for filler).
  const rmIds = [...new Set(rows.flatMap((r) => (Array.isArray(r.rmIds) ? r.rmIds : [])).filter(Boolean))] as string[];
  const shadeByRm = new Map<string, string | null>();
  if (rmIds.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rms: any[] = await prisma.rm.findMany({ where: { airtableId: { in: rmIds } }, select: { airtableId: true, gritShade: true, fillerShade: true } });
    for (const rm of rms) shadeByRm.set(rm.airtableId, rm.gritShade ?? rm.fillerShade ?? null);
  }
  return rows.map((r) => ({
    increment: r.siloIncrement,
    siloNo: r.siloNo,
    sku: r.sku,
    weight: r.weight,
    remaining: r.remainingWeight,
    date: r.date,
    assignee: r.assignee,
    bag: r.invNoBagNo,
    supplier: jstr(r.nameFromSupplierMasterFromUsedBag),
    size: jstr(r.sizeFromUsedBag),
    grade: jstr(r.gradeFromUsedBag),
    shade: (Array.isArray(r.rmIds) && r.rmIds[0] ? shadeByRm.get(r.rmIds[0]) : null) ?? null,
  }));
}
