// Append-only action log + "undo the last action".
// Every reversible data fix records an entry with enough payload to reverse it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { delegateOf } from "@/lib/tables";
import { currentUser } from "@/lib/rbac";

const log = () => (prisma as any).actionLog;

export type ActionKind = "create" | "delete" | "designApply" | "rangeConfirm" | "rangeAdd" | "rangeRemove" | "edit";

export interface LogInput {
  kind: ActionKind;
  summary: string;
  batchKey?: string | null;
  model?: string | null;
  payload: any;
}

export async function logAction(input: LogInput): Promise<void> {
  // Best-effort: if the action_log table/client isn't available yet
  // (migration not run), never block or fail the underlying action.
  try {
    const delegate = log();
    if (!delegate?.create) return;
    const u = await currentUser();
    await delegate.create({
      data: {
        kind: input.kind,
        summary: input.summary,
        batchKey: input.batchKey ?? null,
        model: input.model ?? null,
        payload: input.payload,
        actor: (u as any)?.email ?? (u as any)?.name ?? null,
      },
    });
  } catch {
    /* logging is best-effort */
  }
}

export interface UndoableInfo { id: string; summary: string; kind: string; createdAt: string; actor: string | null }

/** The most recent action that has not yet been undone (optionally for one batch). */
export async function lastUndoable(batchKey?: string | null): Promise<UndoableInfo | null> {
  const row = await log().findFirst({
    where: { undone: false, kind: { notIn: ["rangeConfirm", "rangeAdd", "rangeRemove", "edit"] }, ...(batchKey ? { batchKey } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return { id: row.id, summary: row.summary, kind: row.kind, createdAt: new Date(row.createdAt).toISOString(), actor: row.actor ?? null };
}

// Convert ISO date strings (from JSON payload) back to Date for DateTime columns.
function revive(rec: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(v) : v;
  }
  return out;
}

async function reverse(row: any): Promise<void> {
  const p = row.payload ?? {};
  if (row.kind === "create") {
    // payload: { model, ids: string[] }  -> delete what was created
    if (p.model && Array.isArray(p.ids) && p.ids.length) {
      await delegateOf(p.model).deleteMany({ where: { id: { in: p.ids } } });
    }
  } else if (row.kind === "delete") {
    // payload: { model, records: object[] }  OR  { groups: [{ model, records }] }
    if (p.model && Array.isArray(p.records)) {
      for (const r of p.records) {
        try { await delegateOf(p.model).create({ data: revive(r) }); } catch { /* skip if it already exists */ }
      }
    }
    if (Array.isArray(p.groups)) {
      for (const g of p.groups) {
        if (g?.model && Array.isArray(g.records)) {
          for (const r of g.records) {
            try { await delegateOf(g.model).create({ data: revive(r) }); } catch { /* skip if it already exists */ }
          }
        }
      }
    }
  } else if (row.kind === "designApply") {
    // payload: { entries: [{ model, field, id, old }] } -> restore previous design values
    const groups = new Map<string, { model: string; field: string; old: any; ids: string[] }>();
    for (const e of (p.entries ?? [])) {
      const k = `${e.model}::${e.field}::${e.old ?? ""}`;
      if (!groups.has(k)) groups.set(k, { model: e.model, field: e.field, old: e.old ?? null, ids: [] });
      groups.get(k)!.ids.push(e.id);
    }
    for (const g of groups.values()) {
      await delegateOf(g.model).updateMany({ where: { id: { in: g.ids } }, data: { [g.field]: g.old } });
    }
  }
}

export interface UndoResult { ok: boolean; message: string }

/** Reverse the most recent not-yet-undone action (optionally scoped to a batch). */
export async function undoLastAction(batchKey?: string | null): Promise<UndoResult> {
  const row = await log().findFirst({
    where: { undone: false, kind: { notIn: ["rangeConfirm", "rangeAdd", "rangeRemove", "edit"] }, ...(batchKey ? { batchKey } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, message: "Nothing to undo." };
  try {
    await reverse(row);
  } catch (e) {
    return { ok: false, message: `Undo failed: ${(e as Error).message}` };
  }
  await log().update({ where: { id: row.id }, data: { undone: true, undoneAt: new Date() } });
  return { ok: true, message: `Undid: ${row.summary}` };
}

export interface ActionHistoryEntry { summary: string; actor: string | null; kind: string; createdAt: string; undone: boolean }

/** Recent logged actions for a batch (the "who rectified what, when" trail). Best-effort. */
export async function recentActions(batchKey?: string | null, limit = 15): Promise<ActionHistoryEntry[]> {
  try {
    const rows = await log().findMany({
      where: batchKey ? { batchKey } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r: any) => ({
      summary: r.summary,
      actor: r.actor ?? null,
      kind: r.kind,
      createdAt: new Date(r.createdAt).toISOString(),
      undone: !!r.undone,
    }));
  } catch {
    return [];
  }
}
