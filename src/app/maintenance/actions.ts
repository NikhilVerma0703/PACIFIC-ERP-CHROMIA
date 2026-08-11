"use server";

import { revalidatePath } from "next/cache";
import { canRectify, canRespondDowntime, currentUser } from "@/lib/rbac";
import { answerTicket, raiseTicket, type NewTicket } from "@/lib/maintenanceLog";

export interface ActionRes { ok: boolean; message: string }

/** The signed-in person's display name, for the audit line on the ticket. */
async function actor(): Promise<string | null> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((u as any)?.name as string | undefined) || ((u as any)?.email as string | undefined) || null;
}

/**
 * Raise a fault. INCHARGE AND ABOVE, via canRectify().
 *
 * Not every authenticated user: a maintenance queue is only useful if the
 * entries are worth a fitter walking to the machine for, and the incharge is
 * the person who already owns that judgement on the floor.
 *
 * Note this excludes the Maintenance Manager themselves, whose rank is 1 — they
 * ANSWER this queue rather than fill it. If maintenance need to raise their own
 * work, that is a deliberate decision to make, not a gap to paper over here.
 */
export async function raise(input: NewTicket): Promise<ActionRes> {
  if (!(await canRectify())) return { ok: false, message: "Only an incharge and above can raise a maintenance request." };
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, message: "Give it a one-line summary." };
  if (title.length > 200) return { ok: false, message: "Keep the summary under 200 characters — put the rest in the details." };
  try {
    const t = await raiseTicket({ ...input, title }, await actor());
    if (!t) return { ok: false, message: "The maintenance log table is not set up on this deployment yet." };
    revalidatePath("/maintenance");
    return { ok: true, message: `Raised as ${t.ref}.` };
  } catch (e) {
    return { ok: false, message: `Could not raise it: ${String((e as Error)?.message ?? e)}` };
  }
}

/**
 * Answer a fault. MAINTENANCE MANAGER OR ADMIN — the same gate as the downtime
 * response on the MIS page, because through the two-way link this writes that
 * response too. A weaker gate here would be a way around the stricter one there.
 */
export async function answer(id: string, status: string, response: string): Promise<ActionRes> {
  if (!(await canRespondDowntime())) return { ok: false, message: "Only Maintenance Manager or Admin can respond." };
  if (!id) return { ok: false, message: "Missing ticket reference." };
  try {
    await answerTicket(id, status, response, await actor());
  } catch (e) {
    return { ok: false, message: `Save failed: ${String((e as Error)?.message ?? e)}` };
  }
  revalidatePath("/maintenance");
  // The other half of the link: answering here may have written the downtime
  // response, so the MIS card is now stale in the cache.
  revalidatePath("/mis");
  return { ok: true, message: "Saved." };
}
