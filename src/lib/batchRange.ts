// Manual batch slab-range edits: per-batch range confirmations + manually-added
// slabs. Backed by the raw `batch_range_edit` table (no Prisma model needed).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { localId } from "@/lib/rbac";
import { applyWrongBatchMove } from "@/lib/batchMismatch";
import { thicknessBySlab } from "@/lib/slabThickness";

const db = prisma as any;
const STATION_MODELS = ["Press", "Oven", "Jot", "PolishEntry", "PolishQc"];
const dele = (m: string) => db[m[0].toLowerCase() + m.slice(1)];

export interface RangeEdits { confirmed: { by: string | null; at: string } | null; added: number[]; skipped: number[]; }

/** Range confirmation + manually-added slab numbers for a batch. */
export async function getRangeEdits(batchKey: string): Promise<RangeEdits> {
  if (!batchKey) return { confirmed: null, added: [], skipped: [] };
  let rows: any[] = [];
  try { rows = await db.$queryRaw`SELECT kind, slab_number, entered_by, created_at FROM batch_range_edit WHERE batch_key = ${batchKey}`; }
  catch { return { confirmed: null, added: [], skipped: [] }; }
  let confirmed: RangeEdits["confirmed"] = null;
  const added: number[] = [];
  const skipped: number[] = [];
  for (const r of rows) {
    if (r.kind === "confirm") confirmed = { by: r.entered_by ?? null, at: new Date(r.created_at).toISOString().slice(0, 10) };
    else if (r.kind === "add" && r.slab_number != null) added.push(Number(r.slab_number));
    else if (r.kind === "skip" && r.slab_number != null) skipped.push(Number(r.slab_number));
  }
  added.sort((a, b) => a - b);
  skipped.sort((a, b) => a - b);
  return { confirmed, added, skipped };
}

export async function confirmRange(batchKey: string, by: string | null): Promise<void> {
  if (!batchKey) return;
  await db.$executeRaw`DELETE FROM batch_range_edit WHERE batch_key = ${batchKey} AND kind = 'confirm'`;
  await db.$executeRaw`INSERT INTO batch_range_edit (id, batch_key, kind, entered_by) VALUES (${localId("bre")}, ${batchKey}, 'confirm', ${by})`;
}

export async function addSlab(batchKey: string, slabNumber: number, by: string | null): Promise<void> {
  if (!batchKey || !Number.isFinite(slabNumber)) return;
  await db.$executeRaw`INSERT INTO batch_range_edit (id, batch_key, slab_number, kind, entered_by)
    VALUES (${localId("bre")}, ${batchKey}, ${slabNumber}, 'add', ${by})
    ON CONFLICT (batch_key, kind, slab_number) DO NOTHING`;
}

/** Mark a slab number as intentionally SKIPPED (never produced) so it stops
 * showing as a missing-slab discrepancy and is never auto-filled. */
export async function skipSlab(batchKey: string, slabNumber: number, by: string | null): Promise<void> {
  if (!batchKey || !Number.isFinite(slabNumber)) return;
  await db.$executeRaw`INSERT INTO batch_range_edit (id, batch_key, slab_number, kind, entered_by)
    VALUES (${localId("bre")}, ${batchKey}, ${slabNumber}, 'skip', ${by})
    ON CONFLICT (batch_key, kind, slab_number) DO NOTHING`;
}

/** Undo a skip mark. */
export async function unskipSlab(batchKey: string, slabNumber: number): Promise<void> {
  if (!batchKey || !Number.isFinite(slabNumber)) return;
  await db.$executeRaw`DELETE FROM batch_range_edit WHERE batch_key = ${batchKey} AND kind = 'skip' AND slab_number = ${slabNumber}`;
}

/** The batch the line head (Distributor/Kreos) says a slab belongs to, if any. */
async function lineHeadBatchFor(slabNumber: number): Promise<{ raw: string; key: string } | null> {
  const opt = { where: { slabNumber }, select: { batch: true, batchKey: true }, orderBy: { importedAt: "desc" } } as any;
  const [d, k] = await Promise.all([db.distributor.findFirst(opt).catch(() => null), db.kreos.findFirst(opt).catch(() => null)]);
  const r = d ?? k;
  return r && r.batchKey ? { raw: r.batch ?? r.batchKey, key: r.batchKey } : null;
}

export interface RemoveResult { ok?: boolean; message?: string; error?: string }

/** Remove a slab from a batch. Non-destructive: an added-override is dropped; a
 * real slab is moved to its true line-head batch; an orphan (no line-head record
 * anywhere) is flagged "does not belong" instead of being deleted. */
export async function removeSlabFromBatch(batchKey: string, slabNumber: number, added: number[]): Promise<RemoveResult> {
  if (!batchKey || !Number.isFinite(slabNumber)) return { error: "Invalid slab." };
  if (added.includes(slabNumber)) {
    await db.$executeRaw`DELETE FROM batch_range_edit WHERE batch_key = ${batchKey} AND kind = 'add' AND slab_number = ${slabNumber}`;
    return { ok: true, message: `Removed slab ${slabNumber} from the batch's expected list.` };
  }
  const lh = await lineHeadBatchFor(slabNumber);
  if (!lh) return { error: `⚠ Slab ${slabNumber} does not belong to this batch — no Distributor/Kreos (line-head) record exists for it in any batch.` };
  if (lh.key === batchKey) return { error: `Slab ${slabNumber} belongs to this batch per the line head (${lh.raw}). It can't be removed here.` };
  let moved = 0, skipped = 0;
  for (const m of STATION_MODELS) {
    try {
      const rows: any[] = await dele(m).findMany({ where: { batchKey, slabNumber }, select: { id: true } });
      if (rows.length) { const r = await applyWrongBatchMove(m, rows.map((x) => x.id), lh.raw); moved += r.moved; skipped += r.skipped; }
    } catch { /* station may lack the slab column */ }
  }
  return { ok: true, message: `Moved slab ${slabNumber} (${moved} row(s)${skipped ? `, ${skipped} already there` : ""}) to its true batch ${lh.raw}.` };
}

/** All slabs currently in a batch (across stations) plus manual adds, with the
 * stations each appears at. Powers the rectify page. */
export async function getBatchSlabList(batchKey: string): Promise<{ slab: number; stations: string[]; added: boolean }[]> {
  if (!batchKey) return [];
  const STN: [string, string][] = [["Press", "press"], ["Distributor", "distributor"], ["Kreos", "kreos"], ["Oven", "oven"], ["Jot", "jot"], ["Polish Entry", "polishEntry"], ["Polish QC", "polishQc"]];
  const present = new Map<number, Set<string>>();
  for (const [label, model] of STN) {
    let rows: any[] = [];
    try { rows = await db[model].findMany({ where: { batchKey }, select: { slabNumber: true } }); } catch { continue; }
    for (const r of rows) {
      const n = r.slabNumber;
      if (n == null || !Number.isFinite(n)) continue;
      let set = present.get(n); if (!set) { set = new Set(); present.set(n, set); }
      set.add(label);
    }
  }
  const { added } = await getRangeEdits(batchKey);
  const addedSet = new Set(added);
  for (const n of added) if (!present.has(n)) present.set(n, new Set());
  return [...present.entries()].map(([slab, st]) => ({ slab, stations: [...st], added: addedSet.has(slab) })).sort((a, b) => a.slab - b.slab);
}


export const AUTOFILL_PREFIX = "⚙ auto-added";
export const AUTOFILL_REMARK = "⚙ auto-added by range rectify — parameters missing";
const FILL_TABLE: Record<string, string> = { distributor: "distributor", kreos: "kreos", press: "press", oven: "oven", jot: "jot" };
// Thickness column per auto-filled station. Press and Oven have NO thickness column
// at all, so their placeholders cannot carry one; the rest inherit the slab's
// thickness from whichever station already recorded it (see slabThickness.ts).
const FILL_THICKNESS_COL: Record<string, string> = { distributor: "slab_thickness", kreos: "slab_thickness", jot: "thickness" };

async function rawBatchFor(batchKey: string): Promise<string> {
  for (const m of ["distributor", "kreos", "press", "oven", "jot"]) {
    try { const r = await db[m].findFirst({ where: { batchKey }, select: { batch: true } }); if (r?.batch) return String(r.batch); } catch { /* ignore */ }
  }
  return batchKey;
}

/** After a confirm/rectify: create placeholder rows (parameters null, flagged in
 * `remarks`) for every canonical slab missing at the PRODUCTION stations only —
 * the active line head (Distributor or Kreos), Press, Oven, Jot. Polish stations
 * are never auto-filled. Rows are dated now() so they count in date metrics.
 * Idempotent: only fills slabs not already present. */
export async function autoFillBatch(batchKey: string): Promise<{ created: number }> {
  if (!batchKey) return { created: 0 };
  const ALL = ["press", "distributor", "kreos", "oven", "jot", "polishEntry", "polishQc"];
  const present: Record<string, Set<number>> = {};
  const union = new Set<number>();
  for (const m of ALL) {
    let rows: any[] = [];
    try { rows = await db[m].findMany({ where: { batchKey }, select: { slabNumber: true } }); } catch { continue; }
    const set = new Set<number>();
    for (const r of rows) { const n = r.slabNumber; if (n != null && Number.isFinite(n)) { set.add(n); union.add(n); } }
    present[m] = set;
  }
  const { added, skipped } = await getRangeEdits(batchKey);
  for (const n of added) union.add(n);
  for (const n of skipped) union.delete(n); // never auto-fill a skipped slab
  if (!union.size) return { created: 0 };
  const dSize = present["distributor"]?.size ?? 0, kSize = present["kreos"]?.size ?? 0;
  const lineHead = dSize === 0 && kSize === 0 ? null : dSize >= kSize ? "distributor" : "kreos";
  const stations = [...(lineHead ? [lineHead] : []), "press", "oven", "jot"];
  const raw = await rawBatchFor(batchKey);
  // Resolved BEFORE any insert, so it only ever reads real (non-placeholder) rows:
  // slab -> thickness, taken from any station that recorded it.
  const thickBySlab = await thicknessBySlab({ keys: [batchKey] });
  let created = 0;
  for (const m of stations) {
    const have = present[m] ?? new Set<number>();
    const missing = [...union].filter((n) => !have.has(n));
    if (!missing.length) continue;
    const tcol = FILL_THICKNESS_COL[m];
    const cols = `id, "airtableId", batch, batch_key, slab_number, remarks, date, imported_at, synced_at${tcol ? `, ${tcol}` : ""}`;
    const tuples = missing.map((n) => tcol
      ? Prisma.sql`(${localId(m)}, ${localId(m)}, ${raw}, ${batchKey}, ${n}, ${AUTOFILL_REMARK}, now(), now(), now(), ${thickBySlab.get(n) ?? null})`
      : Prisma.sql`(${localId(m)}, ${localId(m)}, ${raw}, ${batchKey}, ${n}, ${AUTOFILL_REMARK}, now(), now(), now())`);
    try {
      const r = await db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(`"${FILL_TABLE[m]}"`)} (${Prisma.raw(cols)}) VALUES ${Prisma.join(tuples)}`);
      created += Number(r) || 0;
    } catch (e) { console.error(`autoFillBatch ${m} insert failed:`, e); }
  }
  return { created };
}