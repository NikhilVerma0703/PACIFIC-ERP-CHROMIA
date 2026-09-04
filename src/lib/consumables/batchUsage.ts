// What a batch consumed, station by station, with the name of whoever was
// standing there — the sheet Satya and the store incharge fill in at sign-off.
//
// TWO HALVES THAT MUST NOT BE CONFUSED.
//   The RECORDED half is consumption entries: lines the floor logged through
//   the "+ Consumables" panel, each already carrying its batch, station and
//   operator (scripts/0074).
//   The EXPECTED half is the stations that actually ran the batch, read from
//   the batch's OWN production records — mixer, distributor, kreos, press,
//   oven, jot, polish, QC — with the person each record names.
//
// The screen is the two joined: every station that touched the batch gets a
// block, whether or not anything was logged against it, so a station nobody
// recorded reads as an empty line waiting to be filled rather than as a
// station that consumed nothing. That is the owner's rule (2026-09-04): "if
// nothing is written it should populate empty table with names of operators
// and stations and Satya or store incharge will fill it."
//
// NOTHING HERE PRICES ANYTHING. A line's unitPrice is typed at sign-off and
// stored on the line; this module reports it and never computes a total. That
// is deliberate and it is the same rule the rest of the verify screen obeys —
// see lib/costing/verification.ts: the two verifiers see quantities and unit
// rates, never anything multiplied. Totals live behind the admin-only costing
// gate.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { canonPerson } from "@/lib/shiftScoreMath";
import { MODEL_DEPT } from "./dept";
// The vocabulary and the validation live in a database-free module so tests can
// reach them; re-exported here so every existing caller keeps one import.
import { BATCH_STATIONS, toLine, type UsageLine, type StationUsage } from "./batchUsageRules.ts";

export { BATCH_STATIONS, editProblem, pricePatch, draftChanged, toLine, LINE_SOURCE } from "./batchUsageRules.ts";
export type { UsageLine, StationUsage, UsageEdit, SaveResult, DraftShape } from "./batchUsageRules.ts";

const db = prisma as any;

export interface BatchUsage {
  batchKey: string;
  stations: StationUsage[];
  /** Items the plant knows, for the sheet's own dropdown — the same list the
   *  floor panel offers, so the two cannot name one item two ways. */
  items: { itemName: string; unit: string }[];
  /** Lines whose station is not one of the eight (or is blank). They are shown
   *  rather than dropped: a line nobody can place is still a consumption
   *  somebody recorded against this batch. */
  unplaced: UsageLine[];
}

/**
 * The whole sheet for one batch.
 *
 * Every query is by batchKey, which is indexed on all eight station tables and
 * (since scripts/0074) on the consumption table too — so this is nine indexed
 * reads and no scan, which is what lets the verify screen load it inline.
 */
export async function batchUsage(rawBatch: string): Promise<BatchUsage> {
  const batchKey = normalizeBatch(rawBatch);
  if (!batchKey) return { batchKey: "", stations: [], items: [], unplaced: [] };

  const [entries, items, ...stationRows] = await Promise.all([
    db.consumptionEntry.findMany({
      where: { batchKey },
      orderBy: [{ station: "asc" }, { date: "asc" }],
      select: {
        id: true, itemName: true, quantity: true, unit: true, unitPrice: true,
        pricedBy: true, pricedAt: true, operatorName: true, enteredBy: true, station: true, date: true, source: true,
      },
    }).catch(() => [] as any[]),
    db.inventoryStock.findMany({ select: { itemName: true, unit: true }, orderBy: { itemName: "asc" } }).catch(() => [] as any[]),
    ...BATCH_STATIONS.map((s) =>
      db[s.delegate].findMany({ where: { batchKey }, select: { [s.person]: true }, take: 2000 })
        // A failed read is LOGGED, not swallowed: silently returning [] would
        // turn a renamed column into "this station never ran the batch".
        .catch((e: unknown) => { console.error(`batchUsage: ${s.delegate}.${s.person} read failed`, e); return [] as any[]; })),
  ]);

  const byStation = new Map<string, UsageLine[]>();
  for (const r of entries as any[]) {
    const k = String(r.station ?? "");
    if (!byStation.has(k)) byStation.set(k, []);
    byStation.get(k)!.push(toLine(r));
  }

  const stations: StationUsage[] = BATCH_STATIONS.map((s, i) => {
    const rows = (stationRows[i] ?? []) as any[];
    // canonPerson folds "SURESH"/"suresh" and the known one-person-two-spellings
    // pairs — the same function the scoreboard names people with, so one man is
    // one name on both screens.
    const seen = new Set<string>();
    const operators: string[] = [];
    for (const r of rows) {
      const n = canonPerson(r[s.person]);
      if (n && !seen.has(n)) { seen.add(n); operators.push(n); }
    }
    return {
      station: s.model,
      label: s.label,
      department: MODEL_DEPT[s.model] ?? "Production",
      operators,
      ran: rows.length > 0,
      lines: byStation.get(s.model) ?? [],
    };
  });

  const known = new Set(BATCH_STATIONS.map((s) => s.model));
  const unplaced = [...byStation.entries()]
    .filter(([k]) => !known.has(k))
    .flatMap(([, v]) => v);

  return { batchKey, stations, items: items as any[], unplaced };
}

