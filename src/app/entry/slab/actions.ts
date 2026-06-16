"use server";

import { canUseEntryModel } from "@/lib/stationAccess";
import { smartDefaults, batchForSlab } from "@/lib/smartEntry";

export async function getSmartDefaults(model: string, batch: string) {
  if (!(await canUseEntryModel(model))) return null;
  if (!model || !batch?.trim()) return { values: {}, slabAutofill: null };
  return await smartDefaults(model, batch.trim());
}

export async function getBatchForSlab(model: string, slab: string) {
  if (!(await canUseEntryModel(model))) return null;
  const n = parseFloat(slab);
  if (!Number.isFinite(n)) return { batch: null, defaults: { values: {}, slabAutofill: null } };
  const batch = await batchForSlab(n);
  const defaults = batch ? await smartDefaults(model, batch) : { values: {}, slabAutofill: null };
  return { batch, defaults };
}
