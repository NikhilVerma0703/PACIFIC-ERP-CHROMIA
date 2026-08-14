"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/rbac";
import { undoLastFor } from "@/lib/actionLog";

/**
 * Restore the most recently deleted robo slab, with its delay logs.
 *
 * ADMIN ONLY, and deliberately narrower than the delete itself. The tablet may
 * remove the slab it just mis-keyed — that is the mistake worth fixing in
 * seconds — but deciding that a deletion was wrong and putting the row back is
 * a supervisory act, and an undo the operator can also press is just a second
 * button to mis-tap.
 *
 * This is the half of the decision that makes the widened delete safe: the
 * handler writes its reversal payload into action_log inside the same
 * transaction, and until this existed nothing could read it back — the rows
 * were recoverable in principle and unreachable in practice.
 */
export async function undoLastRoboSlabDelete(): Promise<{ ok: boolean; message: string }> {
  if (!(await isAdmin())) {
    return { ok: false, message: "Only an administrator can restore a deleted slab." };
  }
  const r = await undoLastFor("RoboProductionRecord");
  if (r.ok) {
    revalidatePath("/robo/slabs");
    revalidatePath("/robo");
  }
  return r;
}
