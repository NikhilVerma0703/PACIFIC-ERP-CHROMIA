// Wrong-batch entries. The slab number is BORN at the line head (Distributor /
// Kreos), so the line head owns each slab's true batch. If a later station
// (Press/Oven/Jot/Polish) recorded a slab under a different batch, that entry
// is a wrong-batch entry (e.g. oven operator typed 1344 for 1343's slabs).
// Detection is two-directional for the batch being viewed:
//   foreign  — rows under THIS batch whose slabs the line head created in another batch
//   strayed  — slabs the line head created HERE that sit under another batch at a station
// Both are fixed the same way: move the rows to the slab's line-head batch.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;
const dele = (m: string) => db[m[0].toLowerCase() + m.slice(1)];

const STATIONS: { model: string; label: string; batchField: string }[] = [
  { model: "Press", label: "Press", batchField: "batch" },
  { model: "Oven", label: "Oven", batchField: "batch" },
  { model: "Jot", label: "Jot", batchField: "batch" },
  { model: "PolishEntry", label: "Polish Entry", batchField: "batchNumber" },
  { model: "PolishQc", label: "Polish QC", batchField: "batchNumber" },
];

export interface WrongBatchRow { id: string; slabNumber: number; }
export interface WrongBatchGroup {
  model: string; label: string; batchField: string;
  direction: "foreign" | "strayed";
  fromBatch: string;          // batch the rows currently carry (raw-ish)
  toBatch: string;            // raw batch string to write
  toBatchKey: string;
  rows: WrongBatchRow[];      // moveable rows, sorted by slab number
  skipped: { slabNumber: number; reason: string }[];
}
export interface WrongBatchReport { key: string; lineHeadRaw: string | null; groups: WrongBatchGroup[]; }

async function lineHeadRows(where: any): Promise<any[]> {
  const sel = { select: { id: true, slabNumber: true, batch: true, batchKey: true } };
  const [d, k] = await Promise.all([db.distributor.findMany({ where, ...sel }), db.kreos.findMany({ where, ...sel })]);
  return [...d, ...k];
}

export async function detectWrongBatch(batchRaw: string): Promise<WrongBatchReport> {
  const key = normalizeBatch(batchRaw) ?? "";
  const out: WrongBatchReport = { key, lineHeadRaw: null, groups: [] };
  if (!key) return out;

  // the slabs this batch truly owns (line head)
  const own = await lineHeadRows({ batchKey: key, slabNumber: { not: null } });
  if (!own.length) return out; // batch never opened at the line head -> can't judge
  const ownSet = new Set<number>(own.map((r) => r.slabNumber as number));
  out.lineHeadRaw = (own[0]?.batch as string) ?? key;

  for (const st of STATIONS) {
    const d = dele(st.model);
    let mine: any[] = [];
    try { mine = await d.findMany({ where: { batchKey: key, slabNumber: { not: null } }, select: { id: true, slabNumber: true, [st.batchField]: true } }); }
    catch { continue; }
    const mineSet = new Set<number>(mine.map((r) => r.slabNumber as number));

    // ---- FOREIGN: rows here that the line head created in ANOTHER batch ----
    const foreignRows = mine.filter((r) => !ownSet.has(r.slabNumber));
    if (foreignRows.length && foreignRows.length <= 500) {
      const lh = await lineHeadRows({ slabNumber: { in: foreignRows.map((r) => r.slabNumber) } });
      const trueBatch = new Map<number, { raw: string; key: string }>();
      for (const r of lh) if (r.batchKey && r.batchKey !== key) trueBatch.set(r.slabNumber, { raw: r.batch ?? r.batchKey, key: r.batchKey });
      // group by true batch
      const byKey = new Map<string, { raw: string; rows: any[] }>();
      const skipped: { slabNumber: number; reason: string }[] = [];
      for (const r of foreignRows) {
        const t = trueBatch.get(r.slabNumber);
        if (!t) { skipped.push({ slabNumber: r.slabNumber, reason: "no line-head record for this slab in any batch" }); continue; }
        const g = byKey.get(t.key) ?? { raw: t.raw, rows: [] };
        g.rows.push(r); byKey.set(t.key, g);
      }
      for (const [tKey, g] of byKey) {
        // duplicate guard: slabs that ALREADY have a row at this station under the target batch
        const existing: any[] = await d.findMany({ where: { batchKey: tKey, slabNumber: { in: g.rows.map((r) => r.slabNumber) } }, select: { slabNumber: true } });
        const dupSet = new Set<number>(existing.map((r) => r.slabNumber));
        const ok = g.rows.filter((r) => !dupSet.has(r.slabNumber));
        const dupSkipped = g.rows.filter((r) => dupSet.has(r.slabNumber)).map((r) => ({ slabNumber: r.slabNumber as number, reason: `already entered at ${st.label} under ${g.raw} — duplicate, fix via the duplicates tool` }));
        if (ok.length || dupSkipped.length || skipped.length) out.groups.push({
          model: st.model, label: st.label, batchField: st.batchField, direction: "foreign",
          fromBatch: batchRaw, toBatch: g.raw, toBatchKey: tKey,
          rows: ok.map((r) => ({ id: r.id as string, slabNumber: r.slabNumber as number })).sort((a, b) => a.slabNumber - b.slabNumber),
          skipped: [...dupSkipped, ...skipped.splice(0)],
        });
      }
    }

    // ---- STRAYED: this batch's slabs sitting under another batch at this station ----
    const missing = [...ownSet].filter((n) => !mineSet.has(n));
    if (missing.length && missing.length <= 500) {
      let stray: any[] = [];
      try { stray = await d.findMany({ where: { slabNumber: { in: missing }, NOT: { batchKey: key } }, select: { id: true, slabNumber: true, batchKey: true, [st.batchField]: true } }); }
      catch { stray = []; }
      const byFrom = new Map<string, any[]>();
      for (const r of stray) { const f = String(r[st.batchField] ?? r.batchKey ?? "?"); const a = byFrom.get(f) ?? []; a.push(r); byFrom.set(f, a); }
      for (const [from, rows] of byFrom) {
        out.groups.push({
          model: st.model, label: st.label, batchField: st.batchField, direction: "strayed",
          fromBatch: from, toBatch: out.lineHeadRaw ?? key, toBatchKey: key,
          rows: rows.map((r) => ({ id: r.id as string, slabNumber: r.slabNumber as number })).sort((a, b) => a.slabNumber - b.slabNumber),
          skipped: [],
        });
      }
    }
  }
  return out;
}

/** Move the given station rows to their slab's true (line-head) batch.
 * Re-validates the duplicate guard inside the transaction. */
export async function applyWrongBatchMove(model: string, ids: string[], toBatchRaw: string): Promise<{ moved: number; skipped: number }> {
  const st = STATIONS.find((s) => s.model === model);
  if (!st) throw new Error("Unknown station table.");
  const toKey = normalizeBatch(toBatchRaw) ?? toBatchRaw;
  return db.$transaction(async (tx: any) => {
    const t = tx[model[0].toLowerCase() + model.slice(1)];
    const rows: any[] = await t.findMany({ where: { id: { in: ids } }, select: { id: true, slabNumber: true } });
    const existing: any[] = await t.findMany({ where: { batchKey: toKey, slabNumber: { in: rows.map((r) => r.slabNumber).filter((n) => n != null) } }, select: { slabNumber: true } });
    const dup = new Set<number>(existing.map((r) => r.slabNumber));
    const ok = rows.filter((r) => r.slabNumber == null || !dup.has(r.slabNumber));
    if (ok.length) await t.updateMany({ where: { id: { in: ok.map((r) => r.id) } }, data: { [st.batchField]: toBatchRaw, batchKey: toKey } });
    return { moved: ok.length, skipped: rows.length - ok.length };
  });
}
