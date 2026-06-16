"use server";

import { canUseEntryModel } from "@/lib/stationAccess";
import { recordDefaults } from "@/lib/recordSmart";

export async function getRecordDefaults(model: string, key?: string) {
  if (!(await canUseEntryModel(model))) return null;
  if (!model) return { values: {}, increments: {} };
  return await recordDefaults(model, key);
}
