"use server";

import { currentBranchName } from "@/lib/branch";

import { revalidatePath } from "next/cache";
import { canRectify } from "@/lib/rbac";
import { undoLastAction, lastUndoable, type UndoResult, type UndoableInfo } from "@/lib/actionLog";

/** Undo the most recent data-fix action (optionally scoped to a batch). */
export async function undoLast(batch?: string): Promise<UndoResult> {
  if (!(await canRectify())) return { ok: false, message: "Only incharge and above can undo." };
  if ((await currentBranchName()) !== "SHOP_FLOOR") return { ok: false, message: "Undo is only available from the Shop Floor branch." };
  const r = await undoLastAction(batch ? batch.trim() : null);
  revalidatePath("/batch");
  revalidatePath("/batch/slabs");
  return r;
}

/** The most recent not-yet-undone action, for display on the undo bar. */
export async function getLastUndoable(batch?: string): Promise<UndoableInfo | null> {
  if (!(await canRectify())) return null;
  return lastUndoable(batch ? batch.trim() : null);
}
