"use server";

import { revalidatePath } from "next/cache";
import { isAdmin, currentUser } from "@/lib/rbac";
import { setSource } from "@/lib/airtableSync";

/** Manual override only — normal cutover happens automatically once a table's
 * three signals hold (Airtable quiet 48h + parity verified + ERP activity). */
export async function cutOver(model: string, toErp: boolean): Promise<{ ok: boolean; message: string }> {
  if (!(await isAdmin())) return { ok: false, message: "Admin only." };
  const me = await currentUser();
  await setSource(model, toErp ? "ERP" : "AIRTABLE", me?.name || me?.email || "admin");
  revalidatePath("/admin/migration");
  return { ok: true, message: toErp ? `${model} is now LIVE in the ERP — the automatic sync will never touch it again.` : `${model} is back to Airtable as source — automatic sync resumes.` };
}
