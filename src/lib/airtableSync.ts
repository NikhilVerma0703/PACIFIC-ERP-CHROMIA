// Phased Airtable → ERP cutover sync.
//
// Every mirrored table has a SOURCE OF TRUTH flag in sync_state:
//   AIRTABLE — operators still enter data in Airtable; we pull changes in.
//   ERP      — the station has been migrated; the sync NEVER touches it again.
//
// The sync is incremental (Airtable LAST_MODIFIED_TIME filter) and
// UPSERT-ONLY by airtableId — it can never delete or overwrite rows created
// natively in the ERP (their ids don't start with "rec").
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { fetchPage } from "@/lib/airtable";
import { normalizeBatch } from "@/lib/normalizeBatch";

const db = prisma as any;
const delegate = (model: string) => db[model[0].toLowerCase() + model.slice(1)];

type FieldDef = { prismaField: string; kind: string };
type TableDef = { model: string; tableName: string; batchFieldId: string | null; fields: Record<string, FieldDef> };

let _fm: Record<string, TableDef> | null = null;
function fieldmap(): Record<string, TableDef> {
  if (_fm) return _fm;
  _fm = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fieldmap.json"), "utf8"));
  return _fm!;
}
const tableIdOf = (model: string) => Object.entries(fieldmap()).find(([, d]) => d.model === model)?.[0] ?? null;

function coerce(kind: string, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  switch (kind) {
    case "scalar": return String(v);
    case "number": case "int": { const n = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(n) ? (kind === "int" ? Math.trunc(n) : n) : undefined; }
    case "bool": return v === true || v === "true";
    case "date": { const d = new Date(String(v)); return isNaN(d.getTime()) ? undefined : d; }
    case "multiselect": case "link": return Array.isArray(v) ? v.map(String) : [String(v)];
    default: return v;
  }
}
function toRow(rec: { id: string; fields: Record<string, unknown> }, def: TableDef): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [fieldId, fd] of Object.entries(def.fields)) {
    const val = coerce(fd.kind, rec.fields[fieldId]);
    if (val !== undefined) row[fd.prismaField] = val;
  }
  if (def.batchFieldId) {
    const b = normalizeBatch(rec.fields[def.batchFieldId]);
    if (b) row.batchKey = b;
  }
  return row;
}

// ---------- state ----------
export type TableStatus = "SYNCING" | "QUIET" | "VERIFYING" | "READY" | "LIVE";
export interface SyncRow {
  model: string; tableName: string; source: string;
  lastSyncAt: Date | null; lastCount: number; lastChangeAt: Date | null;
  airtableTotal: number | null; countCheckedAt: Date | null;
  cutoverAt: Date | null; cutoverBy: string | null; erpRows: number; recRows: number; nativeRecent: boolean;
  status: TableStatus; quietHours: number; parityOk: boolean;
}

const QUIET_HOURS = 48;          // Airtable must be silent this long
const NATIVE_WINDOW_DAYS = 7;    // ERP-native entries must exist within this window

function deriveStatus(s: { source: string; lastChangeAt: Date | null; lastSyncAt: Date | null; airtableTotal: number | null; countCheckedAt: Date | null }, recRows: number, nativeRecent: boolean): { status: TableStatus; quietHours: number; parityOk: boolean } {
  if (s.source === "ERP") return { status: "LIVE", quietHours: 0, parityOk: true };
  const lastChange = s.lastChangeAt ?? s.lastSyncAt; // never-changed counts as quiet since first sync
  const quietHours = lastChange ? (Date.now() - new Date(lastChange).getTime()) / 36e5 : 0;
  const countFresh = !!s.countCheckedAt && (!s.lastChangeAt || new Date(s.countCheckedAt) > new Date(s.lastChangeAt));
  const parityOk = countFresh && s.airtableTotal != null && s.airtableTotal === recRows;
  if (quietHours < QUIET_HOURS) return { status: "SYNCING", quietHours, parityOk };
  if (!countFresh) return { status: "QUIET", quietHours, parityOk };       // quiet, parity not yet verified
  if (!parityOk) return { status: "VERIFYING", quietHours, parityOk };     // counted but mismatch — keep syncing
  if (!nativeRecent) return { status: "QUIET", quietHours, parityOk };     // data done, but station not active in ERP yet
  return { status: "READY", quietHours, parityOk };                        // auto-cutover will fire
}

/** Ensure a sync_state row exists for every mirrored table, then return status. */
export async function listSyncStatus(): Promise<SyncRow[]> {
  const defs = Object.values(fieldmap());
  const existing: any[] = await db.syncState.findMany();
  const have = new Set(existing.map((r) => r.model));
  const missing = defs.filter((d) => !have.has(d.model)).map((d) => ({ model: d.model }));
  if (missing.length) await db.syncState.createMany({ data: missing, skipDuplicates: true });
  const rows: any[] = await db.syncState.findMany();
  const byModel = new Map(rows.map((r) => [r.model, r]));
  const since = new Date(Date.now() - NATIVE_WINDOW_DAYS * 864e5);
  const stats = await Promise.all(defs.map(async (d) => {
    try {
      const [erpRows, recRows, native] = await Promise.all([
        delegate(d.model).count(),
        delegate(d.model).count({ where: { airtableId: { startsWith: "rec" } } }),
        delegate(d.model).count({ where: { NOT: { airtableId: { startsWith: "rec" } }, importedAt: { gte: since } } }).catch(() => 0),
      ]);
      return { erpRows, recRows, nativeRecent: native > 0 };
    } catch { return { erpRows: -1, recRows: -1, nativeRecent: false }; }
  }));
  return defs.map((d, i) => {
    const s = byModel.get(d.model) ?? {};
    const base = { source: s.source ?? "AIRTABLE", lastChangeAt: s.lastChangeAt ?? null, lastSyncAt: s.lastSyncAt ?? null, airtableTotal: s.airtableTotal ?? null, countCheckedAt: s.countCheckedAt ?? null };
    const derived = deriveStatus(base, stats[i].recRows, stats[i].nativeRecent);
    return {
      model: d.model, tableName: d.tableName, source: base.source,
      lastSyncAt: base.lastSyncAt, lastCount: s.lastCount ?? 0, lastChangeAt: base.lastChangeAt,
      airtableTotal: base.airtableTotal, countCheckedAt: base.countCheckedAt,
      cutoverAt: s.cutoverAt ?? null, cutoverBy: s.cutoverBy ?? null,
      erpRows: stats[i].erpRows, recRows: stats[i].recRows, nativeRecent: stats[i].nativeRecent,
      ...derived,
    };
  });
}

export async function setSource(model: string, source: "AIRTABLE" | "ERP", by = "auto"): Promise<void> {
  const data = { source, cutoverAt: source === "ERP" ? new Date() : null, cutoverBy: source === "ERP" ? by : null };
  await db.syncState.upsert({ where: { model }, create: { model, ...data }, update: data });
}

// ---------- sync ----------
export interface SyncResult { model: string; ok: boolean; upserted: number; skipped?: string; error?: string; }

/** Columns the ERP owns even while the table is still Airtable-sourced. The
 *  confirm-and-split (lib/mixerFifo) writes mixerCycleIds on the line-head tables,
 *  so a re-synced Airtable edit must never overwrite them. They still flow in on
 *  CREATE — a first-time mirror keeps its historical Airtable links. */
const ERP_OWNED_FIELDS: Record<string, string[]> = {
  Distributor: ["mixerCycleIds"],
  Kreos: ["mixerCycleIds"],
};

/** Incremental (or full) one-table sync. Upsert-only; respects the ERP flag. */
export async function syncModel(model: string, opts: { full?: boolean } = {}): Promise<SyncResult> {
  const tableId = tableIdOf(model);
  const def = tableId ? fieldmap()[tableId] : null;
  if (!tableId || !def) return { model, ok: false, upserted: 0, error: "not a mirrored table" };

  const state: any = await db.syncState.upsert({ where: { model }, create: { model }, update: {} });
  if (state.source === "ERP") return { model, ok: true, upserted: 0, skipped: "cut over to ERP — not synced" };

  const startedAt = new Date();
  // 10-minute overlap on the watermark; upserts make the overlap harmless.
  const since = !opts.full && state.cursor ? new Date(new Date(state.cursor).getTime()) : null;
  const filter = since ? `IS_AFTER(LAST_MODIFIED_TIME(), "${since.toISOString()}")` : undefined;

  let upserted = 0;
  let offset: string | undefined;
  try {
    do {
      const page = await fetchPage(tableId, offset, { filterByFormula: filter });
      for (const rec of page.records) {
        const data = toRow(rec, def);
        const update = { ...data };
        for (const f of ERP_OWNED_FIELDS[model] ?? []) delete update[f];
        await delegate(model).upsert({ where: { airtableId: rec.id }, create: { airtableId: rec.id, ...data }, update });
        upserted++;
      }
      offset = page.offset;
    } while (offset);
  } catch (e) {
    return { model, ok: false, upserted, error: (e as Error).message };
  }
  await db.syncState.update({ where: { model }, data: {
    cursor: new Date(startedAt.getTime() - 10 * 60 * 1000), lastSyncAt: new Date(), lastCount: upserted,
    ...(upserted > 0 ? { lastChangeAt: new Date() } : {}),
  } });
  return { model, ok: true, upserted };
}

/** Sync every table still sourced from Airtable (incremental). */
export async function syncAllPending(opts: { full?: boolean } = {}): Promise<SyncResult[]> {
  const status = await listSyncStatus();
  const pending = status.filter((s) => s.source === "AIRTABLE");
  const out: SyncResult[] = [];
  for (const s of pending) out.push(await syncModel(s.model, opts));
  return out;
}

// ---------- parity check + automatic cutover ----------
/** Count every record in an Airtable table (primary field only — cheap pages). */
async function countAirtable(tableId: string, def: TableDef): Promise<number> {
  let n = 0; let offset: string | undefined;
  do {
    const page = await fetchPage(tableId, offset, {});
    n += page.records.length;
    offset = page.offset;
  } while (offset);
  return n;
}

/** One automatic pass (called by the cron):
 *  1. incremental-sync every Airtable-sourced table;
 *  2. parity-verify ONE quiet table per run (bounded work);
 *  3. auto-cutover every table whose three signals all hold. */
export async function runAutoSync(): Promise<{ synced: SyncResult[]; verified: string | null; cutOver: string[] }> {
  const synced = await syncAllPending();
  let status = await listSyncStatus();

  // 2) verify parity for the longest-quiet table that needs it
  const needsCount = status
    .filter((s) => s.source === "AIRTABLE" && s.status === "QUIET" && s.quietHours >= QUIET_HOURS && (!s.countCheckedAt || (s.lastChangeAt && new Date(s.countCheckedAt) <= new Date(s.lastChangeAt))))
    .sort((a, b) => b.quietHours - a.quietHours);
  let verified: string | null = null;
  if (needsCount.length) {
    const t = needsCount[0];
    const tableId = tableIdOf(t.model);
    if (tableId) {
      try {
        const total = await countAirtable(tableId, fieldmap()[tableId]);
        await db.syncState.update({ where: { model: t.model }, data: { airtableTotal: total, countCheckedAt: new Date() } });
        verified = t.model;
        status = await listSyncStatus();
      } catch { /* next run */ }
    }
  }

  // 3) auto-cutover: quiet ≥48h + parity verified + ERP-native activity in the window
  const cutOver: string[] = [];
  for (const s of status) {
    if (s.source !== "AIRTABLE" || s.status !== "READY") continue;
    const st: any = await db.syncState.findUnique({ where: { model: s.model } });
    if (st?.autoCutover === false) continue;
    await setSource(s.model, "ERP", "auto");
    cutOver.push(s.model);
  }
  return { synced, verified, cutOver };
}
