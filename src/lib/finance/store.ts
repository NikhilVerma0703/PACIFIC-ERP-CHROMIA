import "server-only";

// The Prisma adapter for the finance engine.
//
// classify.ts is deliberately pure: it takes a plain `MemoryStore` object and
// has no idea where those rows came from. That is what lets the whole
// classifier be unit-tested against fixtures. This file is the other half - it
// reads those rows out of Postgres and writes the changed ones back, and it is
// the ONLY place in the engine that knows a database exists.
//
// WHAT IS DIFFERENT FROM THE PYTHON
// ---------------------------------
// app/classify.py's Memory issued a SQL query per signal, per bill, against a
// SQLite file on the same disk - microseconds, so nobody cared. Every query
// here crosses the network to Neon, and a serverless function pays that cost
// with the user watching. So reads are SCOPED and BATCHED: one round trip loads
// exactly the vendor row, the person's rows and the token rows this bill needs,
// instead of five queries that each fetch a slice.
//
// That scoping has a consequence the writer has to respect, and it is the one
// trap in this file: `Memory.learn` does read-modify-write on counts it can
// see. A row that was not loaded looks like a row that does not exist, so
// writing it back would replace a hard-won count of 9 with a fresh 1.
// `commitMemory` therefore refuses to write a key that was not in the loaded
// scope, loudly, BEFORE it touches the database. Load what you intend to learn.

import { prisma } from "@/lib/prisma";
import {
  Memory,
  emptyMemoryStore,
  LedgerClassifier,
  type MemoryStore,
  type CorrectionEntry,
} from "./classify";
import { attachAliases, tokenise, type Ledger } from "./ledgers";
import { CLASSIFY, DEDUPE, AGENT } from "./config";
import { isoDate } from "./pipelineRules";
import type { BillFacts } from "./dedupe";

// ---------------------------------------------------------------------------
// Memory: read
// ---------------------------------------------------------------------------

export interface MemoryScope {
  /** vendorKey() of the bill being classified or confirmed. */
  vendorKey?: string | null;
  /** The claimant. */
  person?: string | null;
  /** Tokens whose weights are needed. For classification these are the tokens
   *  of the QUERY text; for learning they are the tokens of the OCR text, and
   *  the two sets are not the same - pass whichever the next step will use. */
  tokens?: readonly string[];
}

interface ResolvedScope {
  vendorKeys: Set<string>;
  persons: Set<string>;
  tokens: Set<string>;
}

/** A MemoryStore plus a record of what was actually read, so the writer can
 *  tell "count is 1 because it is new" from "count is 1 because I never looked". */
export interface ScopedMemoryStore extends MemoryStore {
  readonly scope: ResolvedScope;
}

function resolveScope(scope: MemoryScope): ResolvedScope {
  return {
    vendorKeys: new Set((scope.vendorKey ? [scope.vendorKey] : []).filter(Boolean)),
    persons: new Set((scope.person ? [scope.person.trim()] : []).filter(Boolean)),
    // De-duplicated: SQL's IN-list matches each stored row once however often a
    // token repeats in the bill, and classify.ts's tokenScores collapses
    // duplicates for the same reason.
    tokens: new Set(scope.tokens ?? []),
  };
}

/**
 * Load exactly the memory rows a single bill needs.
 *
 * Three queries in parallel rather than three round trips in series - they are
 * independent, and on a Neon connection the latency is the whole cost.
 */
export async function loadMemory(scope: MemoryScope): Promise<ScopedMemoryStore> {
  const resolved = resolveScope(scope);
  const store = emptyMemoryStore() as ScopedMemoryStore;
  Object.defineProperty(store, "scope", { value: resolved, enumerable: false });

  const vendorKeys = [...resolved.vendorKeys];
  const persons = [...resolved.persons];
  const tokens = [...resolved.tokens];

  const [vendorRows, personRows, tokenRows] = await Promise.all([
    vendorKeys.length
      ? prisma.financeVendorMemory.findMany({ where: { vendorKey: { in: vendorKeys } } })
      : Promise.resolve([]),
    persons.length
      ? prisma.financePersonMemory.findMany({ where: { person: { in: persons } } })
      : Promise.resolve([]),
    tokens.length
      ? prisma.financeTokenWeight.findMany({ where: { token: { in: tokens } } })
      : Promise.resolve([]),
  ]);

  for (const r of vendorRows) {
    (store.vendorMemory[r.vendorKey] ??= {})[r.ledger] = {
      count: r.count,
      lastSeen: r.lastSeen.toISOString(),
    };
  }
  for (const r of personRows) {
    (store.personMemory[r.person] ??= {})[r.ledger] = {
      count: r.count,
      lastSeen: r.lastSeen.toISOString(),
      source: r.source,
    };
  }
  for (const r of tokenRows) {
    (store.tokenWeights[r.token] ??= {})[r.ledger] = r.weight;
  }

  return store;
}

/**
 * A deep copy taken before `Memory.learn` runs, so the writer can diff.
 *
 * Diffing rather than logging intent: `learn` touches a vendor row, a person
 * row, one token row per distinct word and possibly a decayed competitor, and
 * enumerating all of that at the call site would mean re-implementing the
 * learning rules in a second place where they could drift.
 */
export function snapshotMemory(store: MemoryStore): MemoryStore {
  return {
    vendorMemory: Object.fromEntries(
      Object.entries(store.vendorMemory).map(([k, v]) => [k, { ...v }]),
    ),
    personMemory: Object.fromEntries(
      Object.entries(store.personMemory).map(([k, v]) => [k, { ...v }]),
    ),
    tokenWeights: Object.fromEntries(
      Object.entries(store.tokenWeights).map(([k, v]) => [k, { ...v }]),
    ),
    corrections: [...store.corrections],
  };
}

// ---------------------------------------------------------------------------
// Memory: write
// ---------------------------------------------------------------------------

export interface CommitContext {
  /** Recorded on any correction rows this commit creates. */
  billId?: number | null;
  person?: string | null;
  user: string;
}

/**
 * Write back whatever `Memory.learn` changed.
 *
 * Everything goes in ONE interactive transaction: a confirmation that credits
 * the vendor mapping but loses the token weights is worse than one that fails
 * outright, because the failure is visible and the half-learn is not.
 */
export async function commitMemory(
  before: MemoryStore,
  after: ScopedMemoryStore,
  ctx: CommitContext,
): Promise<void> {
  const scope = after.scope;
  const outOfScope: string[] = [];

  interface VendorWrite { vendorKey: string; ledger: string; count: number; lastSeen: Date }
  interface PersonWrite { person: string; ledger: string; count: number; lastSeen: Date; source: string }
  interface TokenWrite { token: string; ledger: string; weight: number }

  const vendorWrites: VendorWrite[] = [];
  for (const [vkey, rows] of Object.entries(after.vendorMemory)) {
    for (const [ledger, row] of Object.entries(rows)) {
      const prev = before.vendorMemory[vkey]?.[ledger];
      if (prev && prev.count === row.count) continue;
      if (!scope.vendorKeys.has(vkey)) { outOfScope.push(`vendorMemory[${vkey}]`); continue; }
      vendorWrites.push({ vendorKey: vkey, ledger, count: row.count, lastSeen: new Date(row.lastSeen) });
    }
  }

  const personWrites: PersonWrite[] = [];
  for (const [person, rows] of Object.entries(after.personMemory)) {
    for (const [ledger, row] of Object.entries(rows)) {
      const prev = before.personMemory[person]?.[ledger];
      if (prev && prev.count === row.count) continue;
      if (!scope.persons.has(person)) { outOfScope.push(`personMemory[${person}]`); continue; }
      personWrites.push({
        person, ledger, count: row.count,
        lastSeen: new Date(row.lastSeen), source: row.source,
      });
    }
  }

  const tokenWrites: TokenWrite[] = [];
  for (const [token, rows] of Object.entries(after.tokenWeights)) {
    for (const [ledger, weight] of Object.entries(rows)) {
      const prev = before.tokenWeights[token]?.[ledger];
      if (prev !== undefined && prev === weight) continue;
      if (!scope.tokens.has(token)) { outOfScope.push(`tokenWeights[${token}]`); continue; }
      tokenWrites.push({ token, ledger, weight });
    }
  }

  // FAIL BEFORE WRITING ANYTHING. An out-of-scope key means the caller learned
  // from data it never read, so the "new" count it computed is fiction and
  // would overwrite a real one. Nothing has been written at this point, so the
  // caller can widen the scope and retry with no half-applied state.
  if (outOfScope.length) {
    throw new Error(
      "commitMemory: refusing to write memory rows that were never loaded - " +
      `the stored counts would be clobbered. Widen the loadMemory() scope for: ${
        [...new Set(outOfScope)].slice(0, 8).join(", ")}`,
    );
  }

  const newCorrections: CorrectionEntry[] = after.corrections.slice(before.corrections.length);

  if (!vendorWrites.length && !personWrites.length && !tokenWrites.length && !newCorrections.length) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const w of vendorWrites) {
      await tx.financeVendorMemory.upsert({
        where: { vendorKey_ledger: { vendorKey: w.vendorKey, ledger: w.ledger } },
        create: w,
        update: { count: w.count, lastSeen: w.lastSeen },
      });
    }
    for (const w of personWrites) {
      await tx.financePersonMemory.upsert({
        where: { person_ledger: { person: w.person, ledger: w.ledger } },
        create: w,
        update: { count: w.count, lastSeen: w.lastSeen, source: w.source },
      });
    }
    for (const w of tokenWrites) {
      await tx.financeTokenWeight.upsert({
        where: { token_ledger: { token: w.token, ledger: w.ledger } },
        create: w,
        update: { weight: w.weight },
      });
    }
    if (newCorrections.length) {
      await tx.financeCorrection.createMany({
        data: newCorrections.map((c) => ({
          billId: ctx.billId ?? null,
          suggested: c.suggested,
          // The SQLite column was `chosen`; the Prisma model calls it
          // `corrected`. Same fact, and the audit trail reads better for it.
          corrected: c.chosen,
          vendorKey: c.vendorKey || null,
          person: ctx.person ?? null,
          createdBy: c.createdBy || ctx.user,
        })),
      });
    }
  });
}

/**
 * Everything the classifier has learned about vendors, strongest first.
 *
 * Backs the admin "what has it learned" view. Ordered in SQL rather than by
 * loading the table and sorting in JS, which is the only difference from
 * `Memory.learnedMappings()`.
 */
export async function loadVendorMappings(limit = 500): Promise<
  Array<{ vendorKey: string; ledger: string; count: number; lastSeen: string }>
> {
  const rows = await prisma.financeVendorMemory.findMany({
    orderBy: [{ count: "desc" }, { lastSeen: "desc" }],
    take: limit,
  });
  return rows.map((r) => ({
    vendorKey: r.vendorKey, ledger: r.ledger, count: r.count,
    lastSeen: r.lastSeen.toISOString(),
  }));
}

/** Admin override. Everything the system infers must be undoable. */
export async function forgetVendorMapping(vendorKey: string, ledger: string): Promise<void> {
  await prisma.financeVendorMemory.deleteMany({ where: { vendorKey, ledger } });
}

// ---------------------------------------------------------------------------
// The chart of accounts
// ---------------------------------------------------------------------------

/**
 * The Tally ledger master, as the classifier's `Ledger` shape.
 *
 * DIVERGENCE, and it matters: `fin_ledger` stores two booleans where
 * ledgers.ts models a `nature` string derived from the Tally group tree. The
 * MASTER.xml import is what decides those booleans, so `isExpense` is the
 * classifier's whole vocabulary - a Fixed Asset ledger a capital purchase
 * should be coded to (Computers & Peripherals) is only offered if the import
 * marked it. Nature is reconstructed here as expense / liability / other rather
 * than round-tripping the original group nature, which the table does not keep.
 *
 * `path` is [parent, name] rather than the full ancestry, because the parent is
 * the only ancestor the table stores. searchText therefore carries one level of
 * context instead of three - enough to disambiguate "Insurance" under
 * "ADMINISTRATION EXPENSES", which was the case the ancestry existed for.
 */
export async function loadLedgers(): Promise<Ledger[]> {
  const rows = await prisma.financeLedger.findMany({ orderBy: { name: "asc" } });
  const ledgers: Ledger[] = rows.map((r) => {
    const path = r.parent ? [r.parent, r.name] : [r.name];
    return {
      name: r.name,
      parent: r.parent,
      rootGroup: path[0],
      path,
      nature: r.isExpense ? "expense" : r.isPerson ? "liability" : "other",
      // Every LEDGER in Tally is postable by definition - groups are separate
      // <GROUP> elements and are not imported into this table at all.
      isPostable: true,
      indent: path.length - 1,
      aliases: [],
      searchText: "",
      ...(r.gstin ? { gstin: r.gstin } : {}),
    };
  });
  attachAliases(ledgers); // also fills searchText
  return ledgers;
}

/** The claimant dropdown. Sourced from the ledger master, so a name chosen here
 *  always exists in Tally and the import cannot fail on it. */
export async function loadPeople(): Promise<string[]> {
  const rows = await prisma.financeLedger.findMany({
    where: { isPerson: true },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
}

/** ledger -> journal-line count, from Tally's Journal Register. The classifier
 *  uses it as a bounded tie-breaker, never as a signal. */
export async function loadLedgerUsage(): Promise<Record<string, number>> {
  const rows = await prisma.financeLedgerUsage.findMany({ where: { count: { gt: 0 } } });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.ledger] = r.count;
  return out;
}

export interface ClassifierBundle {
  classifier: LedgerClassifier;
  memory: Memory;
  store: ScopedMemoryStore;
  ledgers: Ledger[];
}

/**
 * Everything needed to classify one bill, in two round trips.
 *
 * The TF-IDF indexes are rebuilt on every invocation because a serverless
 * function has nowhere to keep them. On PESPL's 2,500-ledger master that is
 * tens of milliseconds against a multi-second OCR call, so it is not worth the
 * cache-invalidation problem a module-level cache would create - a ledger added
 * in Tally this morning must be offerable this afternoon.
 */
export async function buildClassifier(scope: MemoryScope): Promise<ClassifierBundle> {
  const [ledgers, usage, store] = await Promise.all([
    loadLedgers(),
    loadLedgerUsage(),
    loadMemory(scope),
  ]);
  const memory = new Memory(store);
  const classifier = new LedgerClassifier(ledgers, memory, {
    weights: { ...CLASSIFY.weights },
    bands: { ...CLASSIFY.bands },
    memoryTrustCount: CLASSIFY.memoryTrustCount,
    usage,
  });
  return { classifier, memory, store, ledgers };
}

// ---------------------------------------------------------------------------
// Reads the pipeline needs
// ---------------------------------------------------------------------------

export interface RecentBillFacts extends BillFacts {
  billId: number;
  filename: string;
  createdAt: string;
}

/**
 * Recent extractions to score a new bill against for the business-key
 * duplicate check (dedupe.ts layer 3).
 *
 * Bounded by DEDUPE.recentWindow because these rows cross the network; the
 * Python scanned the whole SQLite table. Rejected bills are excluded - a bill
 * someone already said is not a company expense cannot be the original of a
 * duplicate - which is the same filter the Python's `check_business_key` used.
 */
export async function loadRecentBillFacts(
  excludeBillId: number,
  limit = DEDUPE.recentWindow,
): Promise<RecentBillFacts[]> {
  const rows = await prisma.financeExtraction.findMany({
    where: {
      billId: { not: excludeBillId },
      bill: { status: { notIn: ["rejected", "error", "duplicate"] } },
    },
    orderBy: { id: "desc" },
    take: limit,
    select: {
      billId: true, vendorName: true, vendorGstin: true, invoiceNo: true,
      netAmount: true, invoiceDate: true, createdAt: true,
      bill: { select: { filename: true } },
    },
  });
  return rows.map((r) => ({
    billId: r.billId,
    filename: r.bill?.filename ?? "",
    createdAt: r.createdAt.toISOString(),
    vendorName: r.vendorName,
    vendorGstin: r.vendorGstin,
    invoiceNo: r.invoiceNo,
    netAmount: r.netAmount,
    invoiceDate: isoDate(r.invoiceDate),
  }));
}

/**
 * This person's previous CONFIRMED claim amounts, newest first.
 *
 * Only `approved` and `posted` count: the sentinel's baseline has to be what a
 * human accepted, otherwise a run of misread bills teaches it that 40,000 is
 * this person's normal Tuesday.
 */
export async function loadPersonAmountHistory(
  person: string,
  excludeBillId: number,
  limit = AGENT.anomalyHistoryLimit,
): Promise<number[]> {
  const rows = await prisma.financeExtraction.findMany({
    where: {
      person,
      netAmount: { gt: 0 },
      billId: { not: excludeBillId },
      bill: { status: { in: ["approved", "posted"] } },
    },
    orderBy: { id: "desc" },
    take: limit,
    select: { netAmount: true },
  });
  return rows.map((r) => r.netAmount as number);
}

/** The most recent extraction for a bill - the one every screen means when it
 *  says "the extraction". Re-processing appends a row rather than replacing
 *  one, so the history of what the engine read stays intact. */
export async function latestExtraction(billId: number) {
  return prisma.financeExtraction.findFirst({
    where: { billId },
    orderBy: { id: "desc" },
  });
}

// ---------------------------------------------------------------------------
// The agent journal
// ---------------------------------------------------------------------------

/**
 * Everything the agent does on its own initiative gets written down.
 *
 * Autonomy without a journal is unaccountable: when a clerk asks "why is this
 * bill already approved?", the answer must be one screen away, not a shrug.
 *
 * NEVER THROWS, and never rejects - pipeline.py:85 swallows the same failure
 * for the same reason. A journal write failing must not fail the bill that was
 * being processed; losing the note is bad, losing the work is worse. Callers
 * may `void logEvent(...)` without an await and nothing will surface as an
 * unhandled rejection.
 */
export async function logEvent(
  kind: string,
  message: string,
  billId?: number | null,
): Promise<void> {
  try {
    await prisma.financeAgentEvent.create({
      data: { kind, billId: billId ?? null, message: String(message).slice(0, 500) },
    });
  } catch {
    // Deliberately silent. See above.
  }
}

/** The journal, newest first. Backs the "what has the agent been doing" panel. */
export async function loadAgentEvents(limit = 100, billId?: number | null) {
  return prisma.financeAgentEvent.findMany({
    where: billId ? { billId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// The bill list projection - api.py:190
// ---------------------------------------------------------------------------

export interface BillSuggestionSummary {
  ledger: string;
  score: number;
  band: string;
}

/** Exactly the keys api.py's `bill_summary` returns, snake_case included: the
 *  ERP components were written against this contract and are unchanged by the
 *  port. */
export interface BillSummary {
  id: number;
  filename: string;
  page_no: number;
  status: string;
  error: string | null;
  person: string | null;
  vendor: string | null;
  amount: number | null;
  date: string | null;
  ledger: string | null;
  ledger_confirmed: boolean;
  confidence: number;
  suggestion: BillSuggestionSummary | null;
  auto_approved: boolean;
  exported: boolean;
  created_at: string;
}

/** The stored `suggestions_json`, defensively read: it is a Json column, so a
 *  hand-edited row or an older shape must degrade to "no suggestion" rather
 *  than throw inside a list endpoint. */
function topSuggestion(raw: unknown): BillSuggestionSummary | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const top = raw[0] as { ledger?: unknown; score?: unknown; band?: unknown };
  if (!top || typeof top.ledger !== "string") return null;
  const score = typeof top.score === "number" ? top.score : 0;
  return {
    ledger: top.ledger,
    // api.py rounds to 4 places; the UI renders a percentage from it.
    score: Math.round(score * 10000) / 10000,
    band: typeof top.band === "string" ? top.band : "none",
  };
}

/** A coding somebody (or the auto-approval guard) has accepted. `posted` means
 *  it is already in an exported voucher, which is acceptance by definition. */
const ACCEPTED_STATUSES = new Set(["approved", "posted"]);

/** The row shape `billSummary` projects from. Kept explicit so the Prisma
 *  select below and any future caller cannot silently drift apart. */
export interface BillSummarySource {
  id: number;
  filename: string;
  pageNo: number;
  status: string;
  error: string | null;
  person: string | null;
  ocrConfidence: number | null;
  autoApproved: boolean;
  createdAt: Date;
  extractions: Array<{
    vendorName: string | null;
    netAmount: number | null;
    invoiceDate: string | null;
    ledger: string | null;
    suggestionsJson: unknown;
  }>;
}

/**
 * The shape a list row needs - deliberately small.
 *
 * A hundred of these go over the wire at once, so OCR text and per-field
 * confidence are excluded; they belong to the detail endpoint.
 *
 * `ledger` falls back to the top suggestion so the UI can pre-fill, and
 * `ledger_confirmed` is what tells the two apart - a suggestion shown as a
 * confirmed coding is how a wrong ledger gets exported without anyone noticing.
 *
 * DIVERGENCE from api.py:209, deliberate. There `ledger_confirmed` was simply
 * `bool(extraction.ledger)`, but the pipeline pre-fills that column for any
 * high- or medium-band suggestion before a human has seen the bill - so a
 * machine guess reported itself as confirmed. Here the bill also has to have
 * been accepted (approved or posted, whether by a clerk or by auto-approval)
 * before the flag is true. Nothing in the ERP read the old value; a field whose
 * name is a claim about human review has to be honest.
 */
export function billSummary(row: BillSummarySource, exported: boolean): BillSummary {
  const ex = row.extractions[0];
  const top = topSuggestion(ex?.suggestionsJson);
  return {
    id: row.id,
    filename: row.filename,
    page_no: row.pageNo,
    status: row.status,
    error: row.error,
    person: row.person,
    vendor: ex?.vendorName ?? null,
    amount: ex?.netAmount ?? null,
    date: isoDate(ex?.invoiceDate),
    ledger: ex?.ledger ?? top?.ledger ?? null,
    ledger_confirmed: Boolean(ex?.ledger) && ACCEPTED_STATUSES.has(row.status),
    confidence: Math.round(row.ocrConfidence ?? 0),
    suggestion: top,
    auto_approved: row.autoApproved,
    exported,
    created_at: row.createdAt.toISOString(),
  };
}

const BILL_SUMMARY_SELECT = {
  id: true, filename: true, pageNo: true, status: true, error: true,
  person: true, ocrConfidence: true, autoApproved: true, createdAt: true,
  extractions: {
    orderBy: { id: "desc" as const },
    take: 1,
    select: {
      vendorName: true, netAmount: true, invoiceDate: true,
      ledger: true, suggestionsJson: true,
    },
  },
} as const;

export interface BillListFilter {
  status?: readonly string[];
  person?: string | null;
  batchId?: string | null;
  /** true = only bills already in an export; false = only bills not yet in one. */
  exported?: boolean | null;
  limit?: number;
  offset?: number;
}

/**
 * List rows with their latest extraction and their export state.
 *
 * Two queries, not a join: `fin_export_bill` has no relation back to
 * `fin_bill` (the export is keyed by its own ref), so export membership is
 * looked up for the page of ids that was actually returned. That keeps the cost
 * proportional to the page rather than to the export history.
 */
export async function loadBillSummaries(
  filter: BillListFilter = {},
): Promise<{ bills: BillSummary[]; total: number }> {
  const where = {
    ...(filter.status?.length ? { status: { in: [...filter.status] } } : {}),
    ...(filter.person ? { person: filter.person } : {}),
    ...(filter.batchId ? { batchId: filter.batchId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.financeBill.findMany({
      where,
      orderBy: { id: "desc" },
      take: Math.min(filter.limit ?? 100, 500),
      skip: filter.offset ?? 0,
      select: BILL_SUMMARY_SELECT,
    }),
    prisma.financeBill.count({ where }),
  ]);

  const exportedIds = await loadExportedBillIds(rows.map((r) => r.id));
  let bills = rows.map((r) => billSummary(r, exportedIds.has(r.id)));

  // Applied after the projection because "exported" lives in another table;
  // filtering it in SQL would need the join this function deliberately avoids.
  // The trade is that an `exported` filter thins the page rather than filling
  // it, which the ERP handles - it asks for approved+unexported, and an
  // approved bill that is already exported is a rarity by construction.
  if (filter.exported === true) bills = bills.filter((b) => b.exported);
  if (filter.exported === false) bills = bills.filter((b) => !b.exported);

  return { bills, total };
}

/** Which of these bills are already in an exported batch. A bill exported once
 *  is `posted` and permanently excluded from later batches - with Tally's
 *  standard Journal type this table is one of only two duplicate defences. */
export async function loadExportedBillIds(billIds: readonly number[]): Promise<Set<number>> {
  if (!billIds.length) return new Set();
  const rows = await prisma.financeExportBill.findMany({
    where: { billId: { in: [...billIds] } },
    select: { billId: true },
  });
  return new Set(rows.map((r) => r.billId));
}

/** One bill's summary, or null. */
export async function loadBillSummary(billId: number): Promise<BillSummary | null> {
  const row = await prisma.financeBill.findUnique({
    where: { id: billId },
    select: BILL_SUMMARY_SELECT,
  });
  if (!row) return null;
  const exported = await loadExportedBillIds([row.id]);
  return billSummary(row, exported.has(row.id));
}

/** Tokens of a bill's OCR text - the scope `loadMemory` needs before learning
 *  from a confirmation. Exported so the confirm route cannot get it subtly
 *  wrong by tokenising the query text instead. */
export function learningTokens(ocrText: string | null | undefined): string[] {
  return [...new Set(tokenise(ocrText ?? ""))];
}
