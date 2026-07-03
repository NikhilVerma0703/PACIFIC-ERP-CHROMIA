// Station-scoped data entry: an operator only sees and uses the form(s) of
// the machine they are appointed to. Incharge and above see everything.
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";
import { OFFICE_MODELS } from "@/lib/branch";

export const STATION_MODELS: Record<string, string[]> = {
  PRESS: ["Press"],
  OVEN: ["Oven"],
  JOT: ["Jot"],
  // Line head: Distributor & Kreos operators are interchangeable — one login
  // may fill BOTH forms and see both tables (the line alternates between them).
  KREOS: ["Kreos", "Distributor"],
  DISTRIBUTOR: ["Distributor", "Kreos"],
  MIXER: ["MixerCycle"], // Daily Resin Tank prep is incharge+ only
  SILO: ["Silo", "SiloEmptyingLog", "Rm"],
  POLISH_QC: ["PolishQc"],
  POLISH_ENTRY: ["PolishEntry"],
  CUTTING: ["CuttingEntry"], // post-QC sample/offcut cutting
};

export interface EntryAccess {
  /** null = unrestricted shop floor (incharge and above); [] = operator with no station. */
  models: string[] | null;
  station: string | null;
  branch: "SHOP_FLOOR" | "OFFICE";
}

export async function entryAccess(): Promise<EntryAccess> {
  const u = await currentUser();
  if (!u) return { models: [], station: null, branch: "SHOP_FLOOR" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (u as any).role as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const station = ((u as any).station as string | undefined) ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const branch = (((u as any).branch as string | undefined) === "OFFICE" ? "OFFICE" : "SHOP_FLOOR") as "SHOP_FLOOR" | "OFFICE";
  // Office branch: finance/dispatch forms only — except Sales, who is
  // summary-only and gets no entry forms at all.
  if (branch === "OFFICE") return { models: role === "SALES" ? [] : [...OFFICE_MODELS], station, branch };
  if (rankOf(role) >= ROLE_RANK.INCHARGE) return { models: null, station, branch };
  return { models: STATION_MODELS[String(station ?? "")] ?? [], station, branch };
}

/** Forms that need a minimum role even among incharge+ users. */
export const MIN_ENTRY_RANK: Record<string, number> = {
  DailyResinTank: ROLE_RANK.INCHARGE, // daily tank prep: Incharge and above (not operators)
};

export async function canUseEntryModel(model: string): Promise<boolean> {
  const u = await currentUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rank = rankOf((u as any)?.role as string | undefined);
  if (MIN_ENTRY_RANK[model] && rank < MIN_ENTRY_RANK[model]) return false;
  const { models } = await entryAccess();
  if (models === null) return !OFFICE_MODELS.has(model); // shop incharge+: everything except office tables
  return models.includes(model);
}

/** Production line order (slots; Distributor/Kreos share the line-head slot). */
const LINE: string[][] = [["SILO"], ["MIXER"], ["DISTRIBUTOR", "KREOS"], ["PRESS"], ["OVEN"], ["JOT"], ["POLISH_ENTRY"], ["POLISH_QC"], ["CUTTING"]];

/** Stations an operator may watch on Live Status: previous · own · next slot. */
export function liveWindow(station: string | null | undefined): Set<string> {
  if (!station) return new Set();
  const i = LINE.findIndex((slot) => slot.includes(station));
  if (i < 0) return new Set([station]);
  const out = new Set<string>();
  for (const j of [i - 1, i, i + 1]) LINE[j]?.forEach((s) => out.add(s));
  return out;
}

/** Map a Station enum value to the live-status station key. */
export const LIVE_KEY: Record<string, string> = {
  PRESS: "press", OVEN: "oven", JOT: "jot", KREOS: "kreos", DISTRIBUTOR: "distributor",
  POLISH_ENTRY: "polishEntry", POLISH_QC: "polishQc",
};

/** The tables an operator may VIEW (read-only): their station's models. */
export function operatorTableModels(station: string | null | undefined): Set<string> {
  return new Set(STATION_MODELS[String(station ?? "")] ?? []);
}
