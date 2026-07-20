"use server";
// Confirm-and-split for a shared mixer run. Same shape as the design rectify action:
// role gate AND Shop Floor branch gate here (Finance/Accounts share the incharge rank,
// and undo.ts only works from Shop Floor — nobody may apply a write they cannot undo),
// all real work (including re-running the detector — the client is never trusted) in
// lib/mixerFifo. The preview returns a fingerprint of the plan; apply recomputes and
// refuses if the data shifted in between, so what was confirmed is what gets written.

import { revalidatePath } from "next/cache";
import { canRectify } from "@/lib/rbac";
import { currentBranchName } from "@/lib/branch";
import { previewMixSplit, applyMixSplit, type MixSplitPreview, type MixSplitFingerprint } from "@/lib/mixerFifo";

async function gate(): Promise<string | null> {
  if (!(await canRectify())) return "Only incharge and above can split a shared mix.";
  if ((await currentBranchName()) !== "SHOP_FLOOR") return "Production data can only be rectified from the Shop Floor branch.";
  return null;
}

export async function previewMixSplitAction(batch: string): Promise<MixSplitPreview> {
  const g = await gate();
  if (g) return { ok: false, reason: g };
  try {
    return await previewMixSplit(batch);
  } catch (e) {
    return { ok: false, reason: `Could not plan the split: ${(e as Error).message}` };
  }
}

export async function confirmMixSplit(batch: string, expected: MixSplitFingerprint): Promise<{ ok: boolean; message: string }> {
  const g = await gate();
  if (g) return { ok: false, message: g };
  try {
    const r = await applyMixSplit(batch, expected);
    if (r.ok) { revalidatePath("/batch"); revalidatePath("/batch/slabs"); }
    return r;
  } catch (e) {
    return { ok: false, message: `Split failed: ${(e as Error).message}` };
  }
}
