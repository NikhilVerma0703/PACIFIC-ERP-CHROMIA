import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTdsIndex, sectionOf, summariseTds, tdsCandidates, tdsDeduction,
} from "../src/lib/finance/tds.ts";
import type { Ledger } from "../src/lib/finance/ledgers.ts";

// tds.ts decides which deduction head a vendor invoice is withheld under, and
// it was the last decision-bearing module in lib/finance with no test. Getting
// it wrong is not a journal entry reversed quietly — it is a wrong 26Q return
// filed with the department.
//
// Every fixture below is a REAL ledger name from the company's own Tally master
// (automation/data/MASTER.xml, group "T D S ACCOUNT"), not an invented one.
// Invented names would be tidy, and tidy names are exactly what this parser
// does NOT face: the group carries three different spellings of section 194C,
// two of them only in the pre-renumbering "94C" form.

function led(name: string, parent: string): Ledger {
  return {
    name, parent, rootGroup: parent, path: [parent, name],
    nature: "other", isPostable: true, indent: 1, aliases: [], searchText: "",
  };
}

const G = "T D S ACCOUNT";
const MASTER = [
  led("TDS Payable -Contractors 194C - 0.40%", G),
  led("TDS Payable - Contractors 1024 -(Old Sec.94C)@0.87%", G),
  led("TDS Payable-Contractors -1023(Old Sec.-194C) @1%", G),
  led("TDS Payable -Contractors 194C - 1.35%", G),
  led("TDS Payable -Contractors - 1024 (Old Sec.-194C) @2%", G),
  led("TDS Payable - Professional 1026 (Old Sec-194J) @2%", G),
  led("TDS Payable - Professional 1027 (Old Sec-194J) @10%", G),
  led("TDS Payable - Rent - 1008 (Old Sec.-194I) @ 2%", G),
  led("TDS Payable - Rent - 1009 (Old Sec.-194I) @ 10%", G),
  led("TDS Payable - Commission -1006 (Old Sec.-194H) @ 2%", G),
  led("TDS Payable - Commission 194H @ 5%", G),
  led("TDS Payable - Interest 194A @ 10%", G),
  led("TDS Payable - Purchase -1031(Old Sec.-194Q) @ 0.1%", G),
  led("TDS Payable-Salary - 1002 (Old Sec.-192B)", G),
  led("TDS on Other Sums (Foreign Payment)", G),
  // Settlement and penalty heads, which live elsewhere and must never be
  // offered as a deduction on a purchase voucher.
  led("TDS Paid", "CURRENT ASSETS"),
  led("Interest on TDS", "INDIRECT EXPENSES"),
];

const INDEX = buildTdsIndex(MASTER);

test("only the deduction group is indexed", () => {
  assert.equal(INDEX.length, 15, "the two non-group TDS ledgers must not appear");
  const names = INDEX.map((t) => t.name);
  assert.ok(!names.includes("TDS Paid"), "TDS Paid is settlement, not a deduction");
  assert.ok(!names.includes("Interest on TDS"), "interest is a penalty, not a deduction");
});

test("both spellings of a section decode to the current one", () => {
  // The whole reason OLD_SECTION_RE exists: Tally's own names carry a legacy
  // number one digit short. Without it the 0.87% contractor head indexes with
  // no section at all and vanishes from a section-filtered picker.
  assert.equal(sectionOf("TDS Payable - Contractors 1024 -(Old Sec.94C)@0.87%"), "194C");
  assert.equal(sectionOf("TDS Payable -Contractors - 1024 (Old Sec.-194C) @2%"), "194C");
  assert.equal(sectionOf("TDS Payable -Contractors 194C - 1.35%"), "194C");
});

test("the leading account number is not mistaken for a section", () => {
  // "1024", "1026", "1031" are PESPL's own head numbers, not sections. A looser
  // pattern reads one of them as the section and files the return under it.
  assert.equal(sectionOf("TDS Payable - Professional 1026 (Old Sec-194J) @2%"), "194J");
  assert.equal(sectionOf("TDS Payable - Purchase -1031(Old Sec.-194Q) @ 0.1%"), "194Q");
  assert.equal(sectionOf("TDS Payable-Salary - 1002 (Old Sec.-192B)"), "192B");
  assert.equal(sectionOf("TDS Payable - Interest 194A @ 10%"), "194A");
});

test("a head that states no section says so, rather than guessing one", () => {
  assert.equal(sectionOf("TDS on Other Sums (Foreign Payment)"), "");
  const foreign = INDEX.find((t) => t.name.startsWith("TDS on Other Sums"));
  assert.ok(foreign);
  assert.equal(foreign.section, "");
  assert.equal(foreign.rate, null, "no percentage in the name means no rate");
  assert.equal(foreign.nature, "");
});

test("all five 194C heads are found under one section", () => {
  // The docstring's own example: the rate turns on whether the payee is an
  // individual or a company and whether a lower-deduction certificate applies
  // — none of which is on the bill, which is why a human picks.
  const c = tdsCandidates(INDEX, { section: "194C" });
  assert.deepEqual(c.map((t) => t.rate), [0.4, 0.87, 1, 1.35, 2],
    "lowest rate first, and all five spellings present");
});

test("filtering by nature finds heads whichever way the section is spelled", () => {
  const contractors = tdsCandidates(INDEX, { nature: "contractors" });
  assert.equal(contractors.length, 5);
  const rent = tdsCandidates(INDEX, { nature: "rent" });
  assert.deepEqual(rent.map((t) => t.rate), [2, 10]);
  // Case and padding are the reviewer's, not the data's.
  assert.equal(tdsCandidates(INDEX, { nature: "  RENT " }).length, 2);
  assert.equal(tdsCandidates(INDEX, { nature: "landlord" }).length, 0);
});

test("filters combine, and an empty filter returns the whole picker", () => {
  const both = tdsCandidates(INDEX, { nature: "professional", rate: 10 });
  assert.equal(both.length, 1);
  assert.equal(both[0].name, "TDS Payable - Professional 1027 (Old Sec-194J) @10%");
  assert.equal(tdsCandidates(INDEX).length, INDEX.length);
});

test("a rate filter never matches a head that carries no rate", () => {
  // Salary has no percentage in its name. Treating a missing rate as 0 would
  // surface it under every rate filter.
  const salary = INDEX.find((t) => t.nature === "salary");
  assert.ok(salary);
  assert.equal(salary.rate, null);
  assert.equal(tdsCandidates(INDEX, { rate: 0 }).length, 0);
  assert.ok(!tdsCandidates(INDEX, { nature: "salary", rate: 10 }).length);
});

test("the deduction is on the taxable value and rounds to the rupee", () => {
  // 10,000 at 10% — the docstring's worked example.
  assert.equal(tdsDeduction(10000, 10), 1000);
  // The department's utilities round; a paise mismatch against the 26Q return
  // is a reconciliation item somebody has to chase.
  assert.equal(tdsDeduction(10000, 0.87), 87);
  assert.equal(tdsDeduction(33333.33, 2), 667);
  assert.equal(tdsDeduction(12345.67, 1.35), 167);
  assert.equal(tdsDeduction(0, 10), 0);
});

test("the summary reports what the chart of accounts can actually withhold", () => {
  const s = summariseTds(INDEX);
  assert.equal(s.total, 15);
  assert.deepEqual(s.sections, ["192B", "194A", "194C", "194H", "194I", "194J", "194Q"]);
  assert.deepEqual(s.ratesByNature.contractors, [0.4, 0.87, 1, 1.35, 2]);
  // Salary's rateless head is counted in `total` but contributes no rate.
  assert.deepEqual(s.ratesByNature.salary, []);
  assert.ok("(unspecified)" in s.ratesByNature, "the foreign-payment head is not silently dropped");
});
