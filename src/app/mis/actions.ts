"use server";

import { revalidatePath } from "next/cache";
import { canRespondDowntime, currentUser } from "@/lib/rbac";
import { writeDowntimeResponse, DOWNTIME_STATUSES } from "@/lib/downtimeResponse";

export interface RespondRes { ok: boolean; message: string }

/** Maintenance Manager / Admin records how the team responded to a downtime incident. */
export async function respondToDowntime(misId: string, status: string, note: string): Promise<RespondRes> {
  if (!(await canRespondDowntime())) return { ok: false, message: "Only Maintenance Manager or Admin can respond." };
  if (!misId) return { ok: false, message: "Missing incident reference." };
  if (!DOWNTIME_STATUSES.includes(status as (typeof DOWNTIME_STATUSES)[number])) return { ok: false, message: "Unknown status." };
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = ((u as any)?.name as string | undefined) || ((u as any)?.email as string | undefined) || null;
  try {
    await writeDowntimeResponse(misId, status, (note ?? "").trim() || null, by);
  } catch (e) {
    return { ok: false, message: `Save failed: ${String((e as Error)?.message ?? e)}` };
  }
  revalidatePath("/mis");
  return { ok: true, message: "Saved." };
}
