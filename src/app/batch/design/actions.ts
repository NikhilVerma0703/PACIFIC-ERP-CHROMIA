"use server";

import { currentBranchName } from "@/lib/branch";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canRectify } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { designForBatch } from "@/lib/erp";
import { logAction } from "@/lib/actionLog";

const TABLES: { model: string; delegate: () => any; field: string }[] = [
  { model: "Press",       delegate: () => prisma.press,       field: "designName" },
  { model: "PolishEntry", delegate: () => prisma.polishEntry, field: "design" },
  { model: "PolishQc",    delegate: () => prisma.polishQc,    field: "design" },
  { model: "Mis",         delegate: () => prisma.mis,         field: "design" },
];

export interface DesignFix {
  batch: string;
  key: string;
  designs: string[];
  primary: string | null;
  bySource: Record<string, string[]>;
}

export async function getDesignFix(batch: string): Promise<DesignFix> {
  // Well-formed refusal: the page reads .designs, so a degenerate object crashed it.
  if (!(await canRectify())) return { batch, key: "", designs: [], primary: null, bySource: {} };
  const key = normalizeBatch(batch);
  const d = await designForBatch(key);
  return { batch, key, designs: d.designs, primary: d.primary, bySource: d.bySource };
}

export interface ApplyResult { ok: boolean; message: string; changed: number; }

/** Set one design across all batch records that currently carry a different (non-null) design. Logged + reversible. */
export async function applyBatchDesign(batch: string, chosenRaw: string): Promise<ApplyResult> {
  if (!(await canRectify())) return { ok: false, message: "Only incharge and above can change designs.", changed: 0 };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Production data can only be rectified from the Shop Floor branch.", changed: 0 };
  const chosen = chosenRaw.trim();
  if (!chosen) return { ok: false, message: "Pick a design first.", changed: 0 };
  const key = normalizeBatch(batch);

  const entries: { model: string; field: string; id: string; old: string | null }[] = [];
  for (const t of TABLES) {
    const where = { batchKey: key, [t.field]: { not: null }, NOT: { [t.field]: chosen } };
    const rows: any[] = await t.delegate().findMany({ where, select: { id: true, [t.field]: true } });
    for (const r of rows) entries.push({ model: t.model, field: t.field, id: r.id, old: r[t.field] ?? null });
    if (rows.length) await t.delegate().updateMany({ where, data: { [t.field]: chosen } });
  }
  revalidatePath("/batch");
  revalidatePath("/batch/design");
  if (!entries.length) return { ok: true, message: `Nothing to change — all records already read “${chosen}”.`, changed: 0 };

  await logAction({ kind: "designApply", batchKey: key, model: "design", summary: `Set design to “${chosen}” on ${entries.length} record(s) in ${key}`, payload: { entries } });
  return { ok: true, message: `Set design to “${chosen}” on ${entries.length} record(s). (Undoable)`, changed: entries.length };
}
