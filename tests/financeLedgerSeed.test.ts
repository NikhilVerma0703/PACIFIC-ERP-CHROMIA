// Pins src/lib/finance/ledgerSeed.ts - the rules that decide what the ledger
// master means once it is in Postgres.
//
// Worth testing precisely because both outputs fail SILENTLY. A claimant not
// marked isPerson simply never appears in the dropdown; an expense head not
// marked isExpense can never be suggested however obvious the bill. Neither
// produces an error anywhere - the screen is just quietly less useful - so the
// only place the rules can be held to account is here.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSeedRows, decideExpense, decidePerson, groupKey, parseLedgersJson,
  parseUsage, sniffPayload,
  type SeedLedgerInput, type SeedRules,
} from "../src/lib/finance/ledgerSeed.ts";

// The live rules: TALLY.peopleGroup + CLASSIFY.allowedNatures/excludedRootGroups.
// Copied rather than imported because config.ts is reached through an
// extensionless specifier chain the test runner cannot resolve; if these drift
// from config.ts the tests below stop describing production, so they are stated
// once, here, where the drift is visible.
const RULES: SeedRules = {
  peopleGroup: "SUNDRY CRS FOR SUNDRY EXPENSES",
  allowedNatures: ["expense", "asset"],
  excludedRootGroups: ["Current Assets"],
};

/** A ledger as loadFromMasterXml produces it. */
function led(over: Partial<SeedLedgerInput> & { name: string }): SeedLedgerInput {
  return {
    parent: null, gstin: null, rootGroup: null, path: null,
    nature: "other", isPostable: true, ...over,
  };
}

/** Claimant under the people group: path is [primary, ..., group, name]. */
function claimant(name: string, gstin: string | null = null): SeedLedgerInput {
  return led({
    name,
    parent: "SUNDRY CRS FOR SUNDRY EXPENSES",
    gstin,
    rootGroup: "Current Liabilities",
    path: ["Current Liabilities", "Sundry Creditors", "SUNDRY CRS FOR SUNDRY EXPENSES", name],
    nature: "liability",
  });
}

// ---------------------------------------------------------------------------
// groupKey
// ---------------------------------------------------------------------------

test("groupKey is case- and whitespace-insensitive but keeps punctuation", () => {
  assert.equal(groupKey("  Sundry   CRS  For Sundry Expenses "), "sundry crs for sundry expenses");
  // Punctuation survives: normalise() in ledgers.ts would strip these and could
  // collide two genuinely different Tally groups.
  assert.equal(groupKey("Misc. Expenses (Asset)"), "misc. expenses (asset)");
  assert.equal(groupKey(null), "");
});

// ---------------------------------------------------------------------------
// decidePerson - the config.yaml rule
// ---------------------------------------------------------------------------

test("a ledger in the people group with no GSTIN is a claimant", () => {
  assert.equal(decidePerson(claimant("VIJAY KIRAN GAUTARAJ"), RULES), true);
});

test("a GST-registered ledger in the same group is a business, not a claimant", () => {
  // This is the whole point of the rule: PESPL files small suppliers in the
  // same group. Without the GSTIN test they flood the claimant dropdown.
  assert.equal(decidePerson(claimant("SRI BALAJI TRADERS", "33AALCP2750N1Z3"), RULES), false);
});

test("a blank or whitespace GSTIN does not make someone a business", () => {
  assert.equal(decidePerson(claimant("MEENA R", "   "), RULES), true);
  assert.equal(decidePerson(claimant("MEENA R", ""), RULES), true);
});

test("group membership is matched through the whole ancestry, not just the parent", () => {
  // Tally companies sub-group claimants. Someone under
  // "...SUNDRY EXPENSES > FACTORY" is still a person.
  const nested = led({
    name: "RAVI K",
    parent: "FACTORY",
    path: ["Current Liabilities", "SUNDRY CRS FOR SUNDRY EXPENSES", "FACTORY", "RAVI K"],
    nature: "liability",
  });
  assert.equal(decidePerson(nested, RULES), true);
});

test("a group name differing only in case or spacing still matches", () => {
  const l = led({
    name: "ANITHA S",
    parent: "Sundry  Crs  For Sundry Expenses",
    nature: "liability",
  });
  assert.equal(decidePerson(l, RULES), true);
});

test("a ledger outside the people group is never a claimant", () => {
  const supplier = led({
    name: "TAMILNADU PETRO",
    parent: "Sundry Creditors",
    path: ["Current Liabilities", "Sundry Creditors", "TAMILNADU PETRO"],
    nature: "liability",
  });
  assert.equal(decidePerson(supplier, RULES), false);
});

test("a ledger is not its own ancestor", () => {
  // A ledger that happens to be NAMED like the group must not qualify itself.
  const l = led({
    name: "SUNDRY CRS FOR SUNDRY EXPENSES",
    parent: "Sundry Creditors",
    path: ["Current Liabilities", "Sundry Creditors", "SUNDRY CRS FOR SUNDRY EXPENSES"],
  });
  assert.equal(decidePerson(l, RULES), false);
});

test("an explicit is_person in the payload wins over the derivation", () => {
  const l = { ...claimant("SRI BALAJI TRADERS", "33AALCP2750N1Z3"), isPerson: true };
  assert.equal(decidePerson(l, RULES), true);
  const off = { ...claimant("VIJAY"), isPerson: false };
  assert.equal(decidePerson(off, RULES), false);
});

// ---------------------------------------------------------------------------
// decideExpense - the classifier's vocabulary
// ---------------------------------------------------------------------------

const fuel = led({
  name: "FUEL EXPENSES - VEHICLE",
  parent: "VEHICLE EXPENSES",
  rootGroup: "Indirect Expenses",
  path: ["Indirect Expenses", "VEHICLE EXPENSES", "FUEL EXPENSES - VEHICLE"],
  nature: "expense",
});

test("an expense ledger is part of the vocabulary", () => {
  assert.equal(decideExpense(fuel, RULES, false), true);
});

test("a Fixed Asset ledger is offered - a laptop is not an expense head", () => {
  const laptop = led({
    name: "Computers & Peripherals",
    parent: "COMPUTER",
    rootGroup: "Fixed Assets",
    path: ["Fixed Assets", "COMPUTER", "Computers & Peripherals"],
    nature: "asset",
  });
  assert.equal(decideExpense(laptop, RULES, false), true);
});

test("Current Assets are excluded even though their nature is allowed", () => {
  // 284 customer ledgers, 49 deposits, 9 bank accounts. Scoring every food bill
  // against those is what made the picker open on "4M MARBLE PRIVATE LIMITED".
  const debtor = led({
    name: "4M MARBLE PRIVATE LIMITED",
    parent: "Debtors - Domestic",
    rootGroup: "Current Assets",
    path: ["Current Assets", "Sundry Debtors", "Debtors - Domestic", "4M MARBLE PRIVATE LIMITED"],
    nature: "asset",
  });
  assert.equal(decideExpense(debtor, RULES, false), false);
});

test("rootGroup falls back to the head of the path when it is not stated", () => {
  const debtor = led({
    name: "ACME STONE",
    path: ["Current Assets", "Sundry Debtors", "ACME STONE"],
    nature: "asset",
  });
  assert.equal(decideExpense(debtor, RULES, false), false);
});

test("liability, income and equity ledgers are not codeable", () => {
  for (const nature of ["liability", "income", "equity", "other"]) {
    assert.equal(decideExpense(led({ name: "X", nature }), RULES, false), false, nature);
  }
});

test("a non-postable group header is never codeable", () => {
  assert.equal(decideExpense({ ...fuel, isPostable: false }, RULES, false), false);
});

test("a claimant is never an expense head, whatever the group tree says", () => {
  // The guard matters: a person filed under an expense group would otherwise be
  // both the credit and a debit candidate on the same voucher.
  assert.equal(decideExpense({ ...fuel, nature: "expense" }, RULES, true), false);
});

test("an explicit is_expense in the payload wins over the derivation", () => {
  const l = led({ name: "SOME HEAD", nature: "other", isExpense: true });
  assert.equal(decideExpense(l, RULES, false), true);
});

// ---------------------------------------------------------------------------
// buildSeedRows
// ---------------------------------------------------------------------------

test("buildSeedRows counts what it wrote and normalises blanks to null", () => {
  const { rows, summary } = buildSeedRows([
    claimant("VIJAY KIRAN GAUTARAJ"),
    claimant("SRI BALAJI TRADERS", "33AALCP2750N1Z3"),
    fuel,
    led({ name: "  ", nature: "expense" }),
  ], RULES);

  assert.equal(rows.length, 3);
  assert.equal(summary.parsed, 4);
  assert.equal(summary.unnamed, 1);
  assert.equal(summary.people, 1);
  assert.equal(summary.expense, 1);
  assert.equal(summary.withGstin, 1);
  assert.equal(summary.registeredInPeopleGroup, 1);
  assert.equal(rows.find((r) => r.name === "VIJAY KIRAN GAUTARAJ")?.gstin, null);
  assert.equal(rows.find((r) => r.name === "FUEL EXPENSES - VEHICLE")?.parent, "VEHICLE EXPENSES");
});

test("a name repeated in the export keeps the LAST definition", () => {
  // Matches loadFromMasterXml, which builds a Map and lets later entries win,
  // which in turn matches what a Python dict literal did.
  const { rows, summary } = buildSeedRows([
    led({ name: "DUP", parent: "OLD", nature: "other" }),
    led({ name: "DUP", parent: "NEW", nature: "expense" }),
  ], RULES);
  assert.equal(rows.length, 1);
  assert.equal(summary.duplicates, 1);
  assert.equal(rows[0].parent, "NEW");
  assert.equal(rows[0].isExpense, true);
});

test("inline usage counts are collected and non-positive ones dropped", () => {
  const { usage } = buildSeedRows([
    { ...fuel, usage: 521 },
    led({ name: "IDLE HEAD", nature: "expense", usage: 0 }),
    led({ name: "ODD HEAD", nature: "expense", usage: -3 }),
  ], RULES);
  assert.deepEqual(usage, { "FUEL EXPENSES - VEHICLE": 521 });
});

test("an empty master is reported as such rather than returning silently", () => {
  const { summary } = buildSeedRows([], RULES);
  assert.equal(summary.kept, 0);
  assert.match(summary.notes.join(" "), /No ledgers were found/i);
});

test("a master with no claimants says the dropdown will be empty", () => {
  const { summary } = buildSeedRows([fuel], RULES);
  assert.equal(summary.people, 0);
  assert.match(summary.notes.join(" "), /person dropdown will be empty/i);
});

test("a master with no expense heads says the classifier has nothing", () => {
  const { summary } = buildSeedRows([claimant("VIJAY")], RULES);
  assert.equal(summary.expense, 0);
  assert.match(summary.notes.join(" "), /classifier has nothing to suggest/i);
});

test("a GSTIN-less payload warns that suppliers cannot be told from people", () => {
  // ledgers.json (the Python's own dump) carries no GST numbers at all, so
  // every ledger in the group becomes a claimant. That is usable, but the admin
  // has to know it happened.
  const { summary } = buildSeedRows([claimant("VIJAY"), fuel], RULES);
  assert.equal(summary.withGstin, 0);
  assert.match(summary.notes.join(" "), /records no GST numbers/i);
});

// ---------------------------------------------------------------------------
// Payload sniffing and JSON parsing
// ---------------------------------------------------------------------------

test("sniffPayload reads past a BOM and leading whitespace", () => {
  assert.equal(sniffPayload("﻿\n  <ENVELOPE><LEDGER/></ENVELOPE>"), "xml");
  assert.equal(sniffPayload("  \n[{}]"), "json");
  assert.equal(sniffPayload('{"ledgers":[]}'), "json");
  assert.equal(sniffPayload("name,parent\nA,B"), "unknown");
  assert.equal(sniffPayload(""), "unknown");
});

test("parseLedgersJson accepts a bare array in the Python's snake_case", () => {
  const { ledgers } = parseLedgersJson(JSON.stringify([{
    name: "FUEL EXPENSES", parent: "VEHICLE EXPENSES", root_group: "Indirect Expenses",
    path: ["Indirect Expenses", "VEHICLE EXPENSES", "FUEL EXPENSES"],
    nature: "expense", is_postable: true, aliases: [], search_text: "fuel",
  }]));
  assert.equal(ledgers.length, 1);
  assert.equal(ledgers[0].rootGroup, "Indirect Expenses");
  assert.equal(ledgers[0].isPostable, true);
  assert.equal(decideExpense(ledgers[0], RULES, false), true);
});

test("parseLedgersJson accepts camelCase and an object wrapper with usage", () => {
  const { ledgers, usage } = parseLedgersJson(JSON.stringify({
    ledgers: [{ name: "RENT", rootGroup: "Indirect Expenses", nature: "expense", isPostable: true }],
    usage: { RENT: 42, IGNORED: 0 },
  }));
  assert.equal(ledgers[0].rootGroup, "Indirect Expenses");
  assert.deepEqual(usage, { RENT: 42 });
});

test("parseLedgersJson drops entries with no name rather than writing blanks", () => {
  const { ledgers } = parseLedgersJson(JSON.stringify([{ name: "" }, { parent: "X" }, { name: "OK" }]));
  assert.deepEqual(ledgers.map((l) => l.name), ["OK"]);
});

test("parseLedgersJson fails loudly on junk instead of importing nothing", () => {
  // "0 ledgers imported" and "that was not JSON" need different actions from
  // the admin, so they must not look the same.
  assert.throws(() => parseLedgersJson("not json at all"), /not valid JSON/i);
  assert.throws(() => parseLedgersJson('{"foo":1}'), /array of ledgers/i);
});

test("parseUsage takes a map or a list of rows", () => {
  assert.deepEqual(parseUsage({ A: 3, B: "7", C: 0, "": 9 }), { A: 3, B: 7 });
  assert.deepEqual(
    parseUsage([{ ledger: "A", count: 3 }, { name: "B", usage: 2 }, { ledger: "C" }]),
    { A: 3, B: 2 },
  );
  assert.deepEqual(parseUsage(null), {});
});
