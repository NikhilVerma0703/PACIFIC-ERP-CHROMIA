// The rules that turn a Tally ledger master into `fin_ledger` rows.
//
// Two questions get answered here, and both of them decide what the rest of the
// engine can ever do:
//
//   isPerson  -> the claimant dropdown. A name that is not marked here cannot be
//                picked, so their bills cannot be filed at all.
//   isExpense -> the classifier's entire vocabulary. LedgerClassifier scores the
//                bill text against these ledgers and no others (store.ts
//                reconstructs `nature` from this one boolean), so a head that is
//                not marked here can never be suggested, however obvious it is.
//
// Getting either wrong is silent: the screen simply never offers the right
// answer and a clerk types around it forever. That is why the decisions live in
// their own module with tests rather than inline in the upload route.
//
// THIS FILE IMPORTS NOTHING, on purpose. `node --test` resolves ESM strictly, so
// a value import of "./ledgers" (extensionless, as the app requires) would make
// the whole module untestable - the same constraint pipelineRules.ts is written
// under. The MASTER.xml parse therefore stays with the caller, which hands the
// already-parsed ledgers in; `Ledger` from ledgers.ts is structurally assignable
// to `SeedLedgerInput` below, so nothing has to be converted.

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What a seeding decision needs to know about one ledger. Deliberately a
 *  superset with everything optional: `Ledger` (from ledgers.ts, via
 *  loadFromMasterXml) satisfies it, and so does a hand-written JSON row that
 *  carries only a name and a parent. */
export interface SeedLedgerInput {
  name: string;
  parent?: string | null;
  /** From MASTER.xml's <PARTYGSTIN>. Its PRESENCE is the signal - see below. */
  gstin?: string | null;
  rootGroup?: string | null;
  /** Full ancestry, outermost group first, ending with the ledger itself. */
  path?: readonly string[] | null;
  nature?: string | null;
  isPostable?: boolean | null;
  /** Explicit overrides. A curated JSON payload may state these outright, in
   *  which case they win over the derivation - somebody who took the trouble to
   *  say so knows something the group tree does not record. */
  isPerson?: boolean | null;
  isExpense?: boolean | null;
  /** Journal-line count, if the payload carries usage alongside the master. */
  usage?: number | null;
}

/** One `fin_ledger` row, ready to write. */
export interface SeedLedgerRow {
  name: string;
  parent: string | null;
  gstin: string | null;
  isPerson: boolean;
  isExpense: boolean;
}

export interface SeedRules {
  /** TALLY.peopleGroup - the Tally group holding staff who can be reimbursed. */
  peopleGroup: string;
  /** CLASSIFY.allowedNatures - which natures a bill may be coded to. */
  allowedNatures: readonly string[];
  /** CLASSIFY.excludedRootGroups - primary groups to keep out of the picker
   *  even though their nature is allowed (284 customer ledgers are "asset"). */
  excludedRootGroups: readonly string[];
}

export interface SeedSummary {
  /** Rows in the payload, before de-duplication. */
  parsed: number;
  /** Rows that will be written. */
  kept: number;
  /** Rows dropped for a blank name. */
  unnamed: number;
  /** Names that appeared more than once; the last one wins. */
  duplicates: number;
  people: number;
  expense: number;
  withGstin: number;
  /** Ledgers under the people group that DO carry a GSTIN, so were classed as
   *  businesses rather than claimants. Reported because it is the one number
   *  that shows the rule actually discriminated. */
  registeredInPeopleGroup: number;
  byNature: Record<string, number>;
  /** Human-readable warnings for the admin card. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Comparison key
// ---------------------------------------------------------------------------

/**
 * Case- and whitespace-insensitive key for comparing GROUP names.
 *
 * Deliberately gentler than ledgers.ts `normalise`, which also strips
 * punctuation: these are Tally's own group names ("Misc. Expenses (Asset)",
 * "Bank OD A/c") and two distinct groups could collide once the punctuation is
 * gone. Case and stray double spaces are the only variation a Tally export
 * actually produces.
 */
export function groupKey(text: string | null | undefined): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every group above this ledger, as comparison keys. The ledger's own name is
 *  excluded - a group named after a person would otherwise make that person
 *  their own parent. */
function ancestryKeys(l: SeedLedgerInput): Set<string> {
  const out = new Set<string>();
  const path = l.path ?? [];
  // The last element of `path` is the ledger itself (both loadFromMasterXml and
  // parseTrialBalanceRows build it that way).
  for (let i = 0; i < path.length - 1; i++) {
    const k = groupKey(path[i]);
    if (k) out.add(k);
  }
  const p = groupKey(l.parent);
  if (p) out.add(p); // covers a payload that has a parent but no path
  return out;
}

/** A GSTIN is present. Not validated: a malformed registration number is still
 *  a registration, and gstin.ts's checksum rules are about invoices, not about
 *  whether a ledger belongs to a business. */
function hasGstin(l: SeedLedgerInput): boolean {
  return String(l.gstin ?? "").trim().length > 0;
}

// ---------------------------------------------------------------------------
// The two decisions
// ---------------------------------------------------------------------------

/**
 * Is this ledger a person who can be reimbursed?
 *
 * config.yaml's rule, stated exactly: a ledger under the people group WITHOUT a
 * GST registration. The group is shared - PESPL files both staff claimants and
 * small suppliers under "SUNDRY CRS FOR SUNDRY EXPENSES" - and the GSTIN is what
 * tells them apart. A business that invoices PESPL is registered; someone
 * claiming a taxi fare is not. Group membership alone would put 200-odd
 * suppliers in the claimant dropdown, which is precisely the "pick a name out of
 * 608 creditors" problem the group exists to avoid.
 *
 * ANCESTRY, not just the direct parent. peopleList() in ledgers.ts matches on
 * `parent` because it works from a flat list, but a Tally company is free to
 * sub-group claimants ("SUNDRY CRS FOR SUNDRY EXPENSES > FACTORY"), and those
 * people are still people. Matching anywhere in the chain is strictly more
 * inclusive and the GSTIN test still keeps the businesses out.
 */
export function decidePerson(l: SeedLedgerInput, rules: SeedRules): boolean {
  if (typeof l.isPerson === "boolean") return l.isPerson;
  const group = groupKey(rules.peopleGroup);
  if (!group) return false;
  return ancestryKeys(l).has(group) && !hasGstin(l);
}

/**
 * May a bill be coded to this ledger?
 *
 * Three conditions, all necessary:
 *   - postable. Tally rejects a voucher posted to a group.
 *   - an allowed nature (expense or asset - a laptop is Computers &
 *     Peripherals, not an expense head).
 *   - not under an excluded ROOT group. "asset" also means Current Assets,
 *     which at PESPL is 284 customer ledgers, 49 deposits and 9 bank accounts.
 *     None of those is ever the answer, and offering them made the picker open
 *     on "4M MARBLE PRIVATE LIMITED".
 *
 * A claimant is never an expense head, whatever the group tree says.
 */
export function decideExpense(
  l: SeedLedgerInput,
  rules: SeedRules,
  isPerson: boolean,
): boolean {
  if (isPerson) return false;
  if (typeof l.isExpense === "boolean") return l.isExpense;
  if (l.isPostable === false) return false;
  const nature = groupKey(l.nature);
  if (!nature || !rules.allowedNatures.some((n) => groupKey(n) === nature)) return false;
  const root = groupKey(l.rootGroup ?? l.path?.[0]);
  if (root && rules.excludedRootGroups.some((g) => groupKey(g) === root)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// One ledger at a time
// ---------------------------------------------------------------------------

/**
 * Both decisions applied to a SINGLE ledger.
 *
 * buildSeedRows() does this per row for a whole MASTER.xml; a ledger created by
 * hand in the picker, or by an export that had to invent one, gets here instead
 * - and must be classified by the same two rules, not by a second copy of them
 * written next to the INSERT. A hand-created head that never gets isExpense is
 * a head the classifier can never suggest, and nobody would ever see why.
 */
export function seedRowFor(l: SeedLedgerInput, rules: SeedRules): SeedLedgerRow {
  const isPerson = decidePerson(l, rules);
  return {
    name: String(l.name ?? "").trim(),
    parent: String(l.parent ?? "").trim() || null,
    gstin: String(l.gstin ?? "").trim() || null,
    isPerson,
    isExpense: decideExpense(l, rules, isPerson),
  };
}

/**
 * A ledger nobody imported, described the way the rules above expect.
 *
 * MASTER.xml carries a nature and a full group path; a name typed into a picker
 * carries neither, and decideExpense() correctly refuses to guess - with no
 * nature it returns false for everything. The one thing we DO know is which of
 * the two fields the name was typed into, so that stands in for the nature:
 *
 *   kind "expense"  the Expense Ledger field -> nature "expense", which is an
 *                   allowed nature, so the row is postable unless its parent is
 *                   an excluded root group.
 *   kind "ledger"   the Ledger field -> no nature, so never an expense head.
 *                   decidePerson() then does the real work: under the people
 *                   group without a GSTIN it is a claimant, with one it is a
 *                   registered business and is neither.
 *
 * The parent doubles as the root group because a hand-created ledger has no
 * ancestry beyond it - which keeps "Current Assets" excluded exactly as an
 * imported row would be.
 */
export function handCreatedLedger(input: {
  name: string;
  parent: string;
  gstin?: string | null;
  kind: "ledger" | "expense";
}): SeedLedgerInput {
  return {
    name: input.name,
    parent: input.parent,
    gstin: input.gstin ?? null,
    rootGroup: input.parent,
    nature: input.kind === "expense" ? "expense" : null,
  };
}

// ---------------------------------------------------------------------------
// Payload -> rows
// ---------------------------------------------------------------------------

/**
 * Apply both decisions across a whole master.
 *
 * De-duplicates by exact name (the `fin_ledger` primary key), LAST occurrence
 * winning, which is what a Python dict literal - and loadFromMasterXml - already
 * do for a Tally export that lists a ledger twice.
 */
export function buildSeedRows(
  ledgers: readonly SeedLedgerInput[],
  rules: SeedRules,
): { rows: SeedLedgerRow[]; usage: Record<string, number>; summary: SeedSummary } {
  const byName = new Map<string, SeedLedgerRow>();
  const usage: Record<string, number> = {};
  const byNature: Record<string, number> = {};
  let unnamed = 0;
  let duplicates = 0;
  let withGstin = 0;
  let registeredInPeopleGroup = 0;

  const group = groupKey(rules.peopleGroup);

  for (const l of ledgers) {
    const name = String(l.name ?? "").trim();
    if (!name) { unnamed++; continue; }
    if (byName.has(name)) duplicates++;

    const isPerson = decidePerson(l, rules);
    const row: SeedLedgerRow = {
      name,
      parent: String(l.parent ?? "").trim() || null,
      gstin: String(l.gstin ?? "").trim() || null,
      isPerson,
      isExpense: decideExpense(l, rules, isPerson),
    };
    byName.set(name, row);

    const nature = groupKey(l.nature) || "unknown";
    byNature[nature] = (byNature[nature] ?? 0) + 1;
    if (row.gstin) withGstin++;
    if (group && row.gstin && ancestryKeys(l).has(group)) registeredInPeopleGroup++;

    if (typeof l.usage === "number" && Number.isFinite(l.usage) && l.usage > 0) {
      usage[name] = Math.trunc(l.usage);
    }
  }

  const rows = [...byName.values()];
  const people = rows.filter((r) => r.isPerson).length;
  const expense = rows.filter((r) => r.isExpense).length;

  // The notes are the difference between "the import worked" and "the import
  // worked and here is why the screen is still empty". Each one names a state
  // that produces a silently useless master.
  const notes: string[] = [];
  if (!rows.length) {
    notes.push("No ledgers were found in this file. Is it a Tally All Masters export?");
  }
  if (rows.length && !people) {
    notes.push(
      `No claimants found: no ledger sits under "${rules.peopleGroup}" without a GST ` +
      "registration. The person dropdown will be empty. Check the group name in Tally.",
    );
  }
  if (rows.length && !expense) {
    notes.push(
      "No expense ledgers found, so the classifier has nothing to suggest. " +
      "Every ledger's nature came out as " +
      `${Object.keys(byNature).join(", ") || "unknown"}.`,
    );
  }
  if (rows.length && !withGstin && people) {
    notes.push(
      "This file records no GST numbers, so every ledger under " +
      `"${rules.peopleGroup}" was treated as a person - including any suppliers ` +
      "filed there. Re-import from MASTER.xml (which carries PARTYGSTIN) to " +
      "separate them.",
    );
  }

  return {
    rows,
    usage,
    summary: {
      parsed: ledgers.length,
      kept: rows.length,
      unnamed,
      duplicates,
      people,
      expense,
      withGstin,
      registeredInPeopleGroup,
      byNature,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// JSON payloads
// ---------------------------------------------------------------------------

/** What kind of ledger master this text is, decided from the first meaningful
 *  character rather than from the filename - a clerk renames files. */
export function sniffPayload(text: string): "xml" | "json" | "unknown" {
  // Strip a UTF-8 BOM and any leading whitespace before looking.
  const head = text.replace(/^﻿/, "").trimStart().slice(0, 1);
  if (head === "<") return "xml";
  if (head === "[" || head === "{") return "json";
  return "unknown";
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function count(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Accepts snake_case (ledgers.json, written by the Python) and camelCase (a
 *  payload built from this codebase's own `Ledger`), because both will be
 *  handed to this endpoint and neither is wrong. */
function toInput(raw: unknown): SeedLedgerInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;
  const path = Array.isArray(o.path) ? o.path.map((p) => String(p)) : null;
  return {
    name,
    parent: str(o.parent),
    gstin: str(o.gstin),
    rootGroup: str(o.root_group ?? o.rootGroup),
    path,
    nature: str(o.nature),
    isPostable: bool(o.is_postable ?? o.isPostable),
    isPerson: bool(o.is_person ?? o.isPerson),
    isExpense: bool(o.is_expense ?? o.isExpense),
    usage: count(o.usage ?? o.usage_count ?? o.usageCount ?? o.count),
  };
}

/** `{ "Ledger": 12 }` or `[{ ledger, count }]`, either of which a Journal
 *  Register import could plausibly produce. Zero and negative counts are
 *  dropped: loadLedgerUsage filters them out anyway, and a zero row is just a
 *  row to store. */
export function parseUsage(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = str(o.ledger ?? o.name);
      const n = count(o.count ?? o.usage);
      if (name && n !== null && n > 0) out[name] = Math.trunc(n);
    }
    return out;
  }
  if (typeof raw === "object") {
    for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = count(v);
      const key = name.trim();
      if (key && n !== null && n > 0) out[key] = Math.trunc(n);
    }
  }
  return out;
}

export interface ParsedJsonPayload {
  ledgers: SeedLedgerInput[];
  usage: Record<string, number>;
}

/**
 * A ledgers.json body: either a bare array (what automation/data/ledgers.json
 * is) or `{ ledgers: [...], usage: {...} }`.
 *
 * Throws with a message a human can act on rather than returning an empty list -
 * "0 ledgers imported" and "that file was not JSON" call for different actions.
 */
export function parseLedgersJson(text: string): ParsedJsonPayload {
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(
      `That file is not valid JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }

  let rawLedgers: unknown;
  let rawUsage: unknown;
  if (Array.isArray(doc)) {
    rawLedgers = doc;
  } else if (doc && typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    rawLedgers = o.ledgers ?? o.masters ?? o.data;
    rawUsage = o.usage ?? o.ledger_usage ?? o.ledgerUsage;
  }

  if (!Array.isArray(rawLedgers)) {
    throw new Error(
      'Expected a JSON array of ledgers, or an object with a "ledgers" array.',
    );
  }

  const ledgers: SeedLedgerInput[] = [];
  for (const raw of rawLedgers) {
    const item = toInput(raw);
    if (item) ledgers.push(item);
  }

  return { ledgers, usage: parseUsage(rawUsage) };
}
