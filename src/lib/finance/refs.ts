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

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { CLASSIFY, TALLY } from "./config";
import { buildGstIndex, type GstLedger } from "./gst";
import {
  handCreatedLedger, seedRowFor, type SeedLedgerRow, type SeedRules,
} from "./ledgerSeed";
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

// ---------------------------------------------------------------------------
// Writing to the master
// ---------------------------------------------------------------------------

/** The rules the MASTER.xml importer runs under, verbatim
 *  (finance-admin/seed-ledgers/route.ts). A ledger created by hand must be
 *  classified by the same rule as an imported one or the two disagree. */
const RULES: SeedRules = {
  peopleGroup: TALLY.peopleGroup,
  allowedNatures: CLASSIFY.allowedNatures,
  excludedRootGroups: CLASSIFY.excludedRootGroups,
};

export type NewLedgerKind = "ledger" | "expense";

/** Where a new ledger of each kind belongs. The SAME two groups the export
 *  already creates masters under, so a head created by hand this morning and
 *  the same head created by tonight's export land in one place, not two. */
export function defaultParentFor(kind: NewLedgerKind): string {
  return kind === "expense" ? TALLY.newLedgerParent : TALLY.newPersonParent;
}

/** One fin_ledger row for a name that was typed, not imported. */
export function newLedgerRow(input: {
  name: string;
  parent?: string | null;
  gstin?: string | null;
  kind: NewLedgerKind;
}): SeedLedgerRow {
  return seedRowFor(
    handCreatedLedger({
      name: input.name,
      parent: (input.parent ?? "").trim() || defaultParentFor(input.kind),
      gstin: input.gstin ?? null,
      kind: input.kind,
    }),
    RULES,
  );
}

/**
 * Add ledgers to the master. Returns how many rows were actually inserted.
 *
 * The seeding route writes its 2,500 rows as a chunked raw
 * `INSERT ... ON CONFLICT (name) DO UPDATE`; this is the same statement with
 * two deliberate differences, and it is a handful of rows, not thousands:
 *
 *  - DO NOTHING, not DO UPDATE. A MASTER.xml import IS the authority on what a
 *    ledger is. These two callers - a name typed into a picker, and a name an
 *    export had to invent - are not. Both only ever mean "this name should
 *    exist", so re-stating a classification over an imported row is a way to
 *    LOSE one, never to gain one. `skipDuplicates` is exactly ON CONFLICT DO
 *    NOTHING on Postgres.
 *  - createMany rather than $executeRaw, because at this size the raw form buys
 *    nothing and spells the six columns by hand. The insert is complete on its
 *    own either way: `name` is the primary key and every other column has a
 *    default (synced_at included - see the note in masterInfo()).
 *
 * Case matters. `name` IS the key, so "Fuel" and "FUEL" are two rows and two
 * heads in Tally - the duplicate this module's header warns about. Callers
 * canonicalise first: route.ts's POST /ledgers against knownLedgerNames(), and
 * the export while building the batch (exportBatch's `canonical` map).
 */
export async function upsertLedgers(rows: readonly SeedLedgerRow[]): Promise<number> {
  const named = rows.filter((r) => r.name.trim().length > 0);
  if (!named.length) return 0;
  const { count } = await prisma.financeLedger.createMany({
    data: named.map((r) => ({
      name: r.name,
      parent: r.parent,
      gstin: r.gstin,
      isPerson: r.isPerson,
      isExpense: r.isExpense,
    })),
    skipDuplicates: true,
  });
  return count;
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
