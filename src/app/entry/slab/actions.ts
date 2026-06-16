"use server";

import { canUseEntryModel } from "@/lib/stationAccess";
import { smartDefaults } from "@/lib/smartEntry";

export async function getSmartDefaults(model: string, batch: string) {
  if (!(await canUseEntryModel(model))) return null;
  if (!model || !batch?.trim()) return { values: {}, slabAutofill: null };
  return await smartDefaults(model, batch.trim());
}
