// Smart slab entry — batch-constant "parameter" prefill + per-station behaviour
// of the slab-number field.
import { prisma } from "@/lib/prisma";
import { tableMeta, delegateOf } from "@/lib/tables";
import { normalizeBatch } from "@/lib/normalizeBatch";

// Slab machines -> their Change Parameters table (null = prefill from the
// previous slab of the batch instead, e.g. Jot / Polish).
export const SMART: Record<string, string | null> = {
  Press: "ChangeParametersPress",
  Oven: "ChangeParametersOven",
  Distributor: "ChangeParametersDistributor",
  Kreos: "ChangeParametersKreos",
  Jot: null,
  PolishEntry: null,
  PolishQc: null,
};

// How the slab-number field behaves per station:
//   increment — autofill THIS station's last slab IN THIS BATCH + 1 (blank for
//               the first slab of a batch — typed manually).
//   manual    — no autofill (Polish Entry receives random numbers).
//   dropdown  — searchable list of all Polish Entry slabs (Polish QC).
export type SlabMode = "increment" | "manual" | "dropdown";
export const SLAB_MODE: Record<string, SlabMode> = {
  Distributor: "increment", Kreos: "increment", Press: "increment", Oven: "increment", Jot: "increment",
  PolishEntry: "manual",
  PolishQc: "dropdown",
};

// Batch-constant fields for models without a Change Parameters table where
// "everything" would over-lock (polish stations measure per slab).
const PARAM_OVERRIDE: Record<string, string[]> = {
  PolishEntry: ["design", "sku", "slabThickness"],
  PolishQc: ["design", "sku", "slabThickness"],
};

// Batch-constant fields that are NOT in the (retired) ChangeParameters tables
// but should still clone from the previous record of the batch.
const PARAM_EXTRA: Record<string, string[]> = {
  Kreos: ["loadOnMobileRollerRxSideKg", "loadOnMobileRollerLxSideKg"],
};

const CONTROL = new Set(["effectiveFromSlabNumber", "effectiveFromSlabCount", "slabNumber", "batch", "batchKey", "airtableId", "id", "importedAt", "syncedAt"]);

/** The batch-constant parameter fields for a smart model. */
export function paramFields(model: string): string[] {
  const meta = tableMeta(model);
  if (!meta) return [];
  const editable = meta.fields.filter((f) => f.editable).map((f) => f.prismaField);
  const override = PARAM_OVERRIDE[model];
  if (override) return editable.filter((f) => override.includes(f));
  const change = SMART[model];
  if (!change) return editable.filter((f) => f !== "slabNumber"); // Jot: everything but slab #
  const changeMeta = tableMeta(change);
  const changeSet = new Set((changeMeta?.fields ?? []).map((f) => f.prismaField));
  const extra = new Set(PARAM_EXTRA[model] ?? []);
  return editable.filter((f) => (changeSet.has(f) || extra.has(f)) && !CONTROL.has(f));
}

function iso(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  return v;
}

export interface SmartDefaults { values: Record<string, unknown>; slabAutofill: number | null; lineThickness?: string | null; }

/** Prefill batch parameters + the slab-number autofill for a given batch. */
export async function smartDefaults(model: string, batch: string): Promise<SmartDefaults> {
  const key = normalizeBatch(batch);
  const d = delegateOf(model);
  const pf = paramFields(model);

  // param source: latest Change Parameters row for the batch, else the most
  // recent existing slab of the batch.
  let source: Record<string, unknown> | null = null;
  const change = SMART[model];
  if (change) source = await delegateOf(change).findFirst({ where: { batchKey: key }, orderBy: { effectiveFromSlabNumber: "desc" } });
  if (!source) source = await d.findFirst({ where: { batchKey: key }, orderBy: { importedAt: "desc" } });

  const values: Record<string, unknown> = {};
  if (source) for (const f of pf) { const v = (source as Record<string, unknown>)[f]; if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) values[f] = iso(v); }

  // slab autofill — this station's last slab in THIS batch + 1 (blank if first).
  let slabAutofill: number | null = null;
  if (SLAB_MODE[model] === "increment") {
    try {
      const agg = await d.aggregate({ where: { batchKey: key }, _max: { slabNumber: true } });
      const last = agg?._max?.slabNumber;
      slabAutofill = typeof last === "number" ? last + 1 : null;
    } catch { /* table may lack slabNumber */ }
  }
  // Press shows the thickness set at the line head (Distributor/Kreos), read-only
  let lineThickness: string | null = null;
  if (model === "Press" && key) {
    try {
      for (const m of ["distributor", "kreos"]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = await delegateOf(m[0].toUpperCase() + m.slice(1)).findFirst({ where: { batchKey: key, slabThickness: { not: null } }, orderBy: { importedAt: "desc" }, select: { slabThickness: true } });
        if (r?.slabThickness) { lineThickness = String(r.slabThickness); break; }
      }
    } catch { /* optional */ }
  }
  return { values, slabAutofill, lineThickness };
}

/** Polish Entry slab numbers AWAITING QC, in entry order (for the Polish QC
 * dropdown). A slab is "done" once a Polish QC row with the same slab number
 * exists — the shared slab number is our cross-station link (no Airtable-style
 * linked field needed), so QC'd slabs drop off the list automatically. */
export async function polishEntrySlabOptions(): Promise<number[]> {
  try {
    // anti-join in the database: returns ONLY the awaiting slab numbers
    // (first occurrence in entry order), instead of every polish row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: { slab_number: number }[] = await (prisma as any).$queryRaw`
      SELECT pe.slab_number FROM (
        SELECT DISTINCT ON (slab_number) slab_number, imported_at
        FROM polish_entry WHERE slab_number IS NOT NULL
        ORDER BY slab_number, imported_at ASC
      ) pe
      WHERE NOT EXISTS (SELECT 1 FROM polish_qc pq WHERE pq.slab_number = pe.slab_number)
      ORDER BY pe.imported_at ASC`;
    return rows.map((r) => Number(r.slab_number)).filter((n) => Number.isFinite(n));
  } catch { return []; }
}
