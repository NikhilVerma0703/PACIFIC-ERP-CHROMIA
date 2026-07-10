"use server";

import { revalidatePath } from "next/cache";
import { canRectify, currentUser } from "@/lib/rbac";
import { confirmRange, addSlab, removeSlabFromBatch, autoFillBatch, type RemoveResult } from "@/lib/batchRange";
import { logAction } from "@/lib/actionLog";

const who = async () => { const me = await currentUser(); return me?.name || me?.email || null; };

export async function confirmRangeAction(batchKey: string): Promise<{ ok?: boolean; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can confirm the range." };
  await confirmRange(batchKey, await who());
  const cf = await autoFillBatch(batchKey);
  await logAction({ kind: "rangeConfirm", batchKey, model: "range", summary: `Confirmed slab range${cf.created ? ` · auto-filled ${cf.created} placeholder slab(s)` : ""}`, payload: { created: cf.created } });
  revalidatePath("/batch");
  return { ok: true };
}

export async function addSlabAction(batchKey: string, slab: number): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can edit the range." };
  if (!Number.isFinite(slab)) return { error: "Enter a valid slab number." };
  await addSlab(batchKey, slab, await who());
  const af = await autoFillBatch(batchKey);
  await logAction({ kind: "rangeAdd", batchKey, model: "range", summary: `Added slab ${slab} to the range${af.created ? ` · auto-filled ${af.created} placeholder slab(s)` : ""}`, payload: { slab } });
  revalidatePath("/batch"); revalidatePath("/batch/range");
  return { ok: true, message: `Added slab ${slab} to the batch.` };
}

export async function removeSlabAction(batchKey: string, slab: number, added: number[]): Promise<RemoveResult> {
  if (!(await canRectify())) return { error: "Only incharge and above can edit the range." };
  const r = await removeSlabFromBatch(batchKey, slab, added);
  if (r.ok) await logAction({ kind: "rangeRemove", batchKey, model: "range", summary: r.message ?? `Removed slab ${slab} from the range`, payload: { slab } });
  revalidatePath("/batch"); revalidatePath("/batch/range");
  return r;
}
