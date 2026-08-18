// Smart record entry — clone-from-last prefills, auto increments and date
// defaults for the non-slab forms (SILO bag dump, RM, Daily Resin Tank,
// Shipping & Invoice, MIS). Driven per model by RECORD_SMART.
import { tableMeta, delegateOf } from "@/lib/tables";
import { normalizeBatch } from "@/lib/normalizeBatch";

export interface RecordSmartConfig {
  title: string;
  description: string;
  /** Field the operator fills first; scopes the clone lookup. */
  keyField?: string;
  keyLabel?: string;
  keyHint?: string;
  /** Match the key through batchKey normalisation (batch-like keys). */
  normalizeKey?: boolean;
  /** Render the key as the silo picker with live status. */
  silo?: boolean;
  /** Fields prefilled from the last matching record. */
  cloneFields?: string[];
  /** Fields set to max + 1 (perKey: max within the key, e.g. bag no per invoice). */
  increments?: { field: string; perKey?: boolean }[];
  /** Date fields defaulting to now (set client-side in local time). */
  nowFields?: string[];
}

export const RECORD_SMART: Record<string, RecordSmartConfig> = {
  Silo: {
    title: "Silo filling — dump a bag in",
    description: "Pick the silo you are filling — live status shows what is already inside; the increment and date are automatic and the batch carries over from the last bag.",
    keyField: "siloNo", keyLabel: "Silo number", keyHint: "live status shows below", silo: true,
    cloneFields: ["batch", "weight"],
    increments: [{ field: "siloIncrement" }],
    nowFields: ["date"],
  },
  SiloEmptyingLog: {
    title: "Silo emptying — manual",
    description: "Pick the silo being emptied — live status shows what is inside; enter the bag weight removed. The log number and time are automatic.",
    keyField: "siloNo", keyLabel: "Silo number", keyHint: "live status shows below", silo: true,
    cloneFields: [],
    increments: [{ field: "incrementNumber" }],
    nowFields: ["dateTime"],
  },
  Rm: {
    title: "RM — bag testing",
    description: "Type the invoice number and press Tab — material details prefill from the previous bag of the invoice and the bag number advances by one.",
    keyField: "invNo", keyLabel: "Invoice number", keyHint: "Tab — previous bag of this invoice is cloned",
    cloneFields: ["type", "size", "grade", "status", "availability"],
    increments: [{ field: "bagNo", perKey: true }],
    nowFields: ["date"],
  },
  DailyResinTank: {
    title: "Daily Resin Tank",
    description: "Pick the daily tank and the storage tank the resin comes from — the kg you enter are deducted from that storage tank and linked. Additives prefill from the last preparation; the resin id advances automatically.",
    keyField: "dailyTankNo", keyLabel: "Daily tank", keyHint: "Tab — last preparation of this tank is cloned",
    cloneFields: ["silane", "cobalt", "preparationDurationMins"],
    increments: [{ field: "dailyResinId" }],
    nowFields: ["date"],
  },
  ShippingInvoice: {
    title: "Shipping & Invoice",
    description: "Type the consignee and press Tab — bank details, ports and terms prefill from their last invoice.",
    keyField: "consignee", keyLabel: "Consignee", keyHint: "Tab — their last invoice is cloned",
    cloneFields: ["notifyParty", "notifyPartyAddress", "portOfDischarge", "portOfLoading", "finalDestination", "paymentTerms", "deliveryTerms", "ourBankDetails", "itemCode", "rateUnit", "ratePer", "conversionRateToUsd", "conversionRateToInr"],
    nowFields: ["invDate"],
  },
  Mis: {
    title: "MIS shift log",
    description: "Type the batch and press Tab — design and production type carry over from the previous shift and the starting slab continues where the last shift ended.",
    keyField: "batch", keyLabel: "Batch", keyHint: "Tab — previous shift of this batch is cloned", normalizeKey: true,
    cloneFields: ["design", "productionType", "shift"],
    nowFields: ["date", "dateAndTime"],
  },
};

function iso(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  return v;
}

export interface RecordDefaults { values: Record<string, unknown>; increments: Record<string, number>; }

/** max(field) + 1 over the rows matching `where`, or null when the lookup
 * fails (caller leaves the field unset). Shared by the smart-form defaults
 * below and by server-side increment stamping in the create action. */
export async function nextIncrementValue(model: string, field: string, where: Record<string, unknown>): Promise<number | null> {
  try {
    const agg = await delegateOf(model).aggregate({ where, _max: { [field]: true } });
    const max = agg?._max?.[field];
    return (typeof max === "number" ? Math.floor(max) : 0) + 1;
  } catch { return null; }
}

export async function recordDefaults(model: string, key?: string): Promise<RecordDefaults> {
  const cfg = RECORD_SMART[model];
  const meta = tableMeta(model);
  const out: RecordDefaults = { values: {}, increments: {} };
  if (!cfg || !meta) return out;
  const d = delegateOf(model);
  const k = key?.trim();

  // clone source: latest record matching the key (or latest overall if keyless)
  // — fetched in PARALLEL with the increment lookups (independent queries).
  const where = cfg.keyField && k
    ? (cfg.normalizeKey ? { batchKey: normalizeBatch(k) } : { [cfg.keyField]: k })
    : cfg.keyField ? undefined : {};
  const sourceP: Promise<Record<string, unknown> | null> = where === undefined
    ? Promise.resolve(null)
    : Promise.resolve().then(() => d.findFirst({ where, orderBy: { importedAt: "desc" } }) as Promise<Record<string, unknown> | null>).catch(() => null);
  const incrementsP = Promise.all((cfg.increments ?? []).map(async (inc) => {
    const incWhere = inc.perKey && cfg.keyField && k ? { [cfg.keyField]: k } : {};
    return [inc.field, await nextIncrementValue(model, inc.field, incWhere)] as const;
  }));

  const source = await sourceP;
  if (source) {
    const editable = new Set(meta.fields.filter((f) => f.editable).map((f) => f.prismaField));
    for (const f of cfg.cloneFields ?? []) {
      if (!editable.has(f)) continue;
      const v = (source as Record<string, unknown>)[f];
      if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) out.values[f] = iso(v);
    }
    // MIS: continue slab numbering from the previous shift
    if (model === "Mis") {
      const end = (source as Record<string, unknown>).endingSlabNumber;
      if (typeof end === "number") out.values.startingSlabNumber = end + 1;
    }
  }

  for (const [field, v] of await incrementsP) if (v != null) out.increments[field] = v;
  return out;
}
