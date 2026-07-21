"use server";

import { revalidatePath } from "next/cache";
import { canRectify } from "@/lib/rbac";
import { currentBranchName } from "@/lib/branch";
import { applyWrongBatchMove } from "@/lib/batchMismatch";

export async function moveWrongBatchRows(model: string, ids: string[], toBatch: string): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can move slabs between batches." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { error: "Production data can only be rectified from the Shop Floor branch." };
  if (!ids?.length) return { error: "Nothing to move." };
  try {
    const r = await applyWrongBatchMove(model, ids, toBatch);
    revalidatePath("/batch"); revalidatePath("/slab");
    return { ok: true, message: `✓ Moved ${r.moved} slab(s) to batch ${toBatch}${r.skipped ? ` · ${r.skipped} skipped (already present there)` : ""}.` };
  } catch (e) { return { error: `Move failed: ${(e as Error).message}` }; }
}
