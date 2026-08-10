import "server-only";

// Reference data the HTTP layer needs: the chart of accounts, in the three
// different shapes the endpoints ask for it in.
//
// main.py held these as module-level lists rebuilt at startup, because the
// engine was a process that stayed alive. There is no startup here, so each is
// a query. They are small (names only) and every caller needs at most one.
//
// THE THREE SHAPES ARE NOT INTERCHANGEABLE, and mixing them up is how a
// duplicate ledger gets created in a live chart of accounts:
//
//   postableLedgerNames()  what a bill may be CODED to. Narrow: expense heads.
//   knownLedgerNames()     what already EXISTS in Tally. Wide - includes bank
//                          accounts and group totals nobody codes to. This is
//                          what decides whether the export creates a master,
//                          and creating a duplicate of a ledger that exists but
//                          is not offered for coding is a real mess to unpick.
//   loadPeople() (store)   who can be reimbursed.

import { prisma } from "@/lib/prisma";
import { CLASSIFY } from "./config";
import { buildGstIndex, type GstLedger } from "./gst";
import { buildTdsIndex, type TdsLedger } from "./tds";
import { loadLedgers } from "./store";

/**
 * Every ledger name in the Tally master.
 *
 * Wider than the pickable set on purpose - see the header. `main.py`'s
 * `_known_ledgers()` unioned in `ledgers_cache`, the rows a live Tally sync
 * added between master exports; there is no live gateway here, so fin_ledger is
 * the single source and MASTER.xml import is the only way in.
 */
export async function knownLedgerNames(): Promise<string[]> {
  const rows = await prisma.financeLedger.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
}

/**
 * What a reimbursement may be coded to.
 *
 * main.py:139 filtered LEDGERS by `allowed_natures` minus `excluded_root_groups`.
 * fin_ledger flattens nature to two booleans, so "expense" is `isExpense` and
 * the "asset" half of allowed_natures has nowhere to come from - a Fixed Asset
 * head a laptop should be coded to is only offered if the MASTER.xml import
 * marked it isExpense. That divergence is store.ts's (loadLedgers), documented
 * there; this function inherits it.
 *
 * The root-group exclusion still runs. It is cheap and it is the guard that
 * kept 284 customer ledgers out of the picker, so it stays even though the
 * flattening makes it unlikely to fire.
 */
export async function postableLedgerNames(): Promise<string[]> {
  const rows = await prisma.financeLedger.findMany({
    where: { isExpense: true },
    select: { name: true, parent: true },
    orderBy: { name: "asc" },
  });
  const excluded = new Set(CLASSIFY.excludedRootGroups.map((g) => g.trim().toLowerCase()));
  return rows
    .filter((r) => !excluded.has((r.parent ?? "").trim().toLowerCase()))
    .map((r) => r.name);
}

/** ledger -> times used in Tally's Journal Register, strongest first. Backs the
 *  no-query ledger picker: what the company actually uses beats the alphabet,
 *  which opened on "2000 LTR TANK" because capital items sort first. */
export async function popularLedgers(limit: number): Promise<string[]> {
  const rows = await prisma.financeLedgerUsage.findMany({
    where: { count: { gt: 0 } },
    orderBy: { count: "desc" },
    take: limit,
  });
  return rows.map((r) => r.ledger);
}

/** What THIS person has claimed before, most-used first. For a driver that is
 *  fuel and tolls, which is usually the answer before anyone types. */
export async function personLedgers(person: string, limit: number): Promise<string[]> {
  const rows = await prisma.financePersonMemory.findMany({
    where: { person: person.trim() },
    orderBy: { count: "desc" },
    take: limit,
    select: { ledger: true },
  });
  return rows.map((r) => r.ledger);
}

/**
 * The GST and TDS indexes, decoded from the chart of accounts.
 *
 * Both need the full `Ledger` shape (parent group and name), so they pay for
 * loadLedgers() rather than a names-only query. Only /gst, /tds and
 * /vendor/suggest call them - the reimbursement path never does.
 */
export async function loadTaxIndexes(): Promise<{ gst: GstLedger[]; tds: TdsLedger[] }> {
  const ledgers = await loadLedgers();
  return { gst: buildGstIndex(ledgers), tds: buildTdsIndex(ledgers) };
}

export interface MasterInfo {
  source: string;
  exported_at: string | null;
  age_days: number | null;
  ledgers: number;
}

/**
 * How old the chart of accounts is.
 *
 * A ledger created in Tally this morning is invisible here until someone
 * re-imports MASTER.xml, and the only thing worse than a stale master is a
 * stale master nobody can see the age of. main.py read the file's mtime; the
 * equivalent here is the newest `synced_at`, which the importer stamps.
 */
export async function masterInfo(): Promise<MasterInfo> {
  const [count, newest] = await Promise.all([
    prisma.financeLedger.count(),
    prisma.financeLedger.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
  ]);
  if (!newest) {
    // Not an error state to hide: the finance tables ship empty and stay that
    // way until MASTER.xml is imported. /health saying so is how an admin finds
    // out why every suggestion is "none".
    return { source: "not imported", exported_at: null, age_days: null, ledgers: 0 };
  }
  const ms = Date.now() - newest.syncedAt.getTime();
  return {
    source: "MASTER.xml import",
    exported_at: newest.syncedAt.toISOString().slice(0, 10),
    age_days: Math.max(0, Math.floor(ms / 86_400_000)),
    ledgers: count,
  };
}
