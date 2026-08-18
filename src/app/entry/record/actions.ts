"use server";

import { canUseEntryModel } from "@/lib/stationAccess";
import { recordDefaults } from "@/lib/recordSmart";
import { searchAvailableRmBags } from "@/lib/silo";
import type { RmBagOption } from "@/lib/silo";

export async function getRecordDefaults(model: string, key?: string) {
  if (!(await canUseEntryModel(model))) return null;
  if (!model) return { values: {}, increments: {} };
  return await recordDefaults(model, key);
}

/** Server-side bag search for the silo fill form's picker (gated like the form). */
export async function searchRmBags(q: string): Promise<RmBagOption[]> {
  if (!(await canUseEntryModel("Silo"))) return [];
  return await searchAvailableRmBags(q);
}
