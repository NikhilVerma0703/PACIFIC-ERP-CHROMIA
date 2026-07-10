"use server";

import { revalidatePath } from "next/cache";
import { canRectify, currentUser, isManager } from "@/lib/rbac";
import { writeOffSiloDeficit, openSiloDeficit } from "@/lib/backfill";
import { isCorrectableSilo } from "@/lib/siloClass";
import { previewCorrection, applyCorrection, type Op, type CorrectionDiff } from "@/lib/siloCorrection";

export async function previewSiloCorrection(siloNo: string, op: Op): Promise<{ diff?: CorrectionDiff; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can correct the silo timeline." };
  if (!isCorrectableSilo(siloNo)) return { error: "This silo isn't a grit/filler silo." };
  try { return { diff: await previewCorrection(siloNo, op) }; }
  catch (e) { return { error: `Preview failed: ${(e as Error).message}` }; }
}

export async function applySiloCorrection(siloNo: string, op: Op): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can correct the silo timeline." };
  if (!isCorrectableSilo(siloNo)) return { error: "This silo isn't a grit/filler silo." };
  try { const r = await applyCorrection(siloNo, op); revalidatePath(`/silo/${siloNo}`); revalidatePath("/live"); return { ok: r.ok, message: r.message }; }
  catch (e) { return { error: `Apply failed: ${(e as Error).message}` }; }
}

/** Write off the silo's unbacked deficit ("start fresh") — incharge+, and only
 * after the deficit has sat without any backfill activity for the drought window. */
export async function writeOffSilo(siloNo: string): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await isManager())) return { error: "Only the production manager and above can write off a deficit." };
  const open = await openSiloDeficit(siloNo);
  if (!open) return { error: "No open deficit on this silo." };
  try {
    const me = await currentUser();
    const r = await writeOffSiloDeficit(siloNo, me?.name || me?.email || "incharge");
    if (!r) return { error: "No open deficit on this silo." };
    revalidatePath(`/silo/${siloNo}`); revalidatePath("/live");
    return { ok: true, message: `✓ Written off ${r.writtenOffKg} kg — silo ${siloNo} starts fresh; ${r.cyclesAffected} old cycle(s) stay marked "composition unknown" and the next fill keeps its full weight.` };
  } catch (e) { return { error: `Write-off failed: ${(e as Error).message}` }; }
}
