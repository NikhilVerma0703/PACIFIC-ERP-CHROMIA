"use server";

import { canUseEntryModel } from "@/lib/stationAccess";
import { tableMeta, delegateOf } from "@/lib/tables";
import { normalizeBatch } from "@/lib/normalizeBatch";

// Clone the previous cycle of a batch: copy all editable values, bump Cycle by 1,
// keep the Mixer-used flags so the form re-selects the same mixers.
export async function getMixerDefaults(batch: string) {
  if (!(await canUseEntryModel("MixerCycle"))) return null;
  const key = normalizeBatch(batch);
  const meta = tableMeta("MixerCycle");
  if (!meta) return { values: { batch }, found: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prev: any = await delegateOf("MixerCycle").findFirst({ where: { batchKey: key }, orderBy: [{ cycle: "desc" }] });
  if (!prev) return { values: { batch, cycle: 1 }, found: false };

  const values: Record<string, unknown> = {};
  for (const f of meta.fields) {
    if (!f.editable) continue;
    const v = prev[f.prismaField];
    if (v === null || v === undefined) continue;
    values[f.prismaField] = v instanceof Date ? v.toISOString().slice(0, 16) : v;
  }
  values.batch = batch;
  values.cycle = (typeof prev.cycle === "number" ? prev.cycle : 0) + 1;
  return { values, found: true };
}
