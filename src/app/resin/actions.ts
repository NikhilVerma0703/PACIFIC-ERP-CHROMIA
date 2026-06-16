"use server";

import { revalidatePath } from "next/cache";
import { canRectify, currentUser } from "@/lib/rbac";
import { writeOffTankDeficit, WRITE_OFF_AFTER_HOURS, openTankDeficit } from "@/lib/backfill";
import { previewResinCorrection, applyResinCorrection, type ResinOp, type ResinDiff } from "@/lib/resinCorrection";

export async function previewResin(tankNo: string, op: ResinOp): Promise<{ diff?: ResinDiff; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can correct the resin timeline." };
  try { return { diff: await previewResinCorrection(tankNo, op) }; }
  catch (e) { return { error: `Preview failed: ${(e as Error).message}` }; }
}
export async function applyResin(tankNo: string, op: ResinOp): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can correct the resin timeline." };
  try { const r = await applyResinCorrection(tankNo, op); revalidatePath(`/resin/${tankNo}`); revalidatePath("/live"); return { ok: r.ok, message: r.message }; }
  catch (e) { return { error: `Apply failed: ${(e as Error).message}` }; }
}

/** Write off the tank's unbacked deficit ("start fresh") — incharge+, gated by the drought window. */
export async function writeOffResinTank(tankNo: string): Promise<{ ok?: boolean; message?: string; error?: string }> {
  if (!(await canRectify())) return { error: "Only incharge and above can write off a deficit." };
  const open = await openTankDeficit(tankNo);
  if (!open) return { error: "No open deficit on this tank." };
  if (open.droughtHours < WRITE_OFF_AFTER_HOURS) return { error: `Backfill is still expected — write-off opens after ${WRITE_OFF_AFTER_HOURS} h without activity (${Math.ceil(WRITE_OFF_AFTER_HOURS - open.droughtHours)} h to go). Enter the prep instead if the resin is known.` };
  try {
    const me = await currentUser();
    const r = await writeOffTankDeficit(tankNo, me?.name || me?.email || "incharge");
    if (!r) return { error: "No open deficit on this tank." };
    revalidatePath(`/resin/${tankNo}`); revalidatePath("/live");
    return { ok: true, message: `✓ Written off ${r.writtenOffKg} kg — tank ${tankNo} starts fresh; ${r.cyclesAffected} old cycle(s) stay marked "composition unknown" and the next prep keeps its full quantity.` };
  } catch (e) { return { error: `Write-off failed: ${(e as Error).message}` }; }
}
