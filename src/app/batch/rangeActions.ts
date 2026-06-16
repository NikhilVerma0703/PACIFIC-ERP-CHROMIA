"use server";

import { revalidatePath } from "next/cache";
import { canRectify, currentUser } from "@/lib/rbac";
import { confirmRange, addSlab, removeSlabFromBatch, autoFillBatch, type RemoveResult } from "@/lib/batchRange";

const who = async () => { const me = await currentUser(); return me?.name || me?.email || null; };

export async function confirmRangeAction(batchKey: string): Promise<{ ok?: boolean; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can confirm the range." };
  await confirmRange(batchKey, await who());
  await autoFillBatch(batchKey);
  revalidatePath("/batch");
  return { ok: true };
}

export async function addSlabAction(batchKey: string, slab: number): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can edit the range." };
  if (!Number.isFinite(slab)) return { error: "Enter a valid slab number." };
  await addSlab(batchKey, slab, await who());
  await autoFillBatch(batchKey);
  revalidatePath("/batch"); revalidatePath("/batch/range");
  return { ok: true, message: `Added slab ${slab} to the batch.` };
}

export async function removeSlabAction(batchKey: string, slab: number, added: number[]): Promise<RemoveResult> {
  if (!(await canRectify())) return { error: "Only incharge and above can edit the range." };
  const r = await removeSlabFromBatch(batchKey, slab, added);
  revalidatePath("/batch"); revalidatePath("/batch/range");
  return r;
}
