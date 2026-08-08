// Pins src/lib/finance/ledgers.ts + classify.ts to the behaviour of
// automation/app/ledgers.py, master_xml.py and classify.py, reproducing the
// assertions of automation/tests.py sections:
//
//   "Ledger master"                      (tests.py 55-70)
//   "Person memory"                      (tests.py 195-227)
//   "Reimbursement category coverage"    (tests.py 228-249)
//   "Classification and learning"        (tests.py 339-388)
//   "Tally All Masters parser"           (tests.py 1289-1315)
//   "Claimant allowlist"                 (tests.py 1316-1339)
//
// Same inputs, same expected outputs. The libs stay pure; only this test
// touches the filesystem, to load the same real-world fixtures the Python
// suite reads:
//   - tests/fixtures/trial-balance-rows.json: the raw cells (value, alignment
//     indent, debit, credit) of automation/data/"Trial Balance - PESPL.xlsx",
//     extracted once via openpyxl because the Python reads the sheet through
//     openpyxl and SheetJS CE cannot read alignment indents at all.
//   - automation/data/MASTER.xml, read directly (skipped if absent, exactly
//     like the Python).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  parseTrialBalanceRows, postableForPurchase, loadFromMasterXml, summarise,
  peopleList, type Ledger, type TrialBalanceRow,
} from "../src/lib/finance/ledgers.ts";
import {
  LedgerClassifier, Memory, emptyMemoryStore, buildQueryText, vendorKey,
} from "../src/lib/finance/classify.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRows: TrialBalanceRow[] = JSON.parse(
  readFileSync(path.join(here, "fixtures", "trial-balance-rows.json"), "utf8"),
);
const ls = parseTrialBalanceRows(fixtureRows);
const by = new Map(ls.map((l) => [l.name, l]));

const masterPath = path.join(here, "..", "automation", "data", "MASTER.xml");

// ---------------------------------------------------------------- ledgers
// tests.py 55-70, "Ledger master".

test("parses the trial balance", () => {
  assert.ok(ls.length > 400, String(ls.length));
});

test("finds reimbursement targets", () => {
  const postable = postableForPurchase(ls);
  assert.ok(150 < postable.length && postable.length < 260, String(postable.length));
});

test("group headers are not postable", () => {
  assert.equal(by.get("Laptop")!.isPostable, false);
});

test("leaf ledgers are postable", () => {
  assert.equal(by.get("Boarding & Lodging Expenses")!.isPostable, true);
});

test("hierarchy rebuilt", () => {
  assert.equal(by.get("Boarding & Lodging Expenses")!.parent, "ADMINISTRATION EXPENSES");
});

test("nature derived from root group", () => {
  assert.equal(by.get("Boarding & Lodging Expenses")!.nature, "expense");
});

test("seed aliases attached", () => {
  assert.ok(by.get("Boarding & Lodging Expenses")!.aliases.includes("restaurant"));
});

// ------------------------------------------------------- person memory
// tests.py 195-227, "Person memory".

test("person memory", async (t) => {
  const pmem = new Memory(emptyMemoryStore());
  const pclf = new LedgerClassifier(ls, pmem);
  for (let i = 0; i < 6; i++) pmem.learnPerson("RAJESH KUMAR", "Printing & Stationery");

  const statQ = buildQueryText(
    "SRI VENKATESWARA BOOK DEPOT A4 paper file register pen",
    "SRI VENKATESWARA BOOK DEPOT",
  );
  const without = pclf.classify(statQ, "SRI VENKATESWARA BOOK DEPOT", null);
  const withp = pclf.classify(statQ, "SRI VENKATESWARA BOOK DEPOT", null, {
    person: "RAJESH KUMAR",
  });

  await t.test("person history raises confidence", () => {
    assert.ok(
      withp[0].score > without[0].score,
      `${without[0].score.toFixed(2)} -> ${withp[0].score.toFixed(2)}`,
    );
  });

  await t.test("cites the person in the reason", () => {
    assert.ok(withp[0].reasons.some((r) => r.includes("RAJESH KUMAR")));
  });

  await t.test("unknown person changes nothing", () => {
    const nobody = pclf.classify(statQ, "SRI VENKATESWARA BOOK DEPOT", null, {
      person: "NOBODY",
    });
    assert.equal(nobody[0].score, without[0].score);
  });

  // The guard that matters: history must not override clear bill text.
  await t.test("bill text still wins over person habit", () => {
    const foodQ = buildQueryText(
      "HOTEL SITARA GRAND restaurant chicken biryani curd rice",
      "HOTEL SITARA GRAND",
    );
    for (let i = 0; i < 20; i++) pmem.learnPerson("FUELGUY", "FUEL EXPENSES VEHICLE");
    const hijack = pclf.classify(foodQ, "HOTEL SITARA GRAND", null, { person: "FUELGUY" });
    assert.ok(hijack[0].ledger.includes("Boarding"), hijack[0].ledger);
  });
});

// ------------------------------------------------- keyword coverage
// tests.py 228-249, "Reimbursement category coverage (text only, no history)".

test("reimbursement category coverage (text only, no history)", async (t) => {
  const kclf = new LedgerClassifier(ls);
  const cases: Array<[string, string, string]> = [
    ["fuel", "BALAKRISHNALAH Nozzle Preset Volume DIESEL Density Rate Vehicle No",
      "FUEL EXPENSES VEHICLE"],
    ["restaurant", "HOTEL SITARA GRAND Restaurant Chicken Apollo Fish Curd Rice Covers",
      "Boarding & Lodging"],
    ["toll", "NHAI TOLL PLAZA FASTAG vehicle class LMV single journey",
      "Travelling Expenses"],
    ["cab", "OLA CABS trip receipt pickup drop distance kms fare",
      "Travelling Expenses"],
    ["courier", "PROFESSIONAL COURIER consignment AWB docket parcel",
      "Courier Charges"],
    ["stationery", "BOOK DEPOT A4 paper file register pen stapler",
      "Printing & Stationery"],
  ];
  for (const [label, text, want] of cases) {
    await t.test(`${label} -> right ledger`, () => {
      const top = kclf.classify(buildQueryText(text, text.split(" ")[0]), null, null);
      assert.ok(
        top.length > 0 && top[0].ledger.toLowerCase().includes(want.toLowerCase()),
        top.length ? top[0].ledger : "(no result)",
      );
    });
  }
});

// ------------------------------------------------------- classify + learn
// tests.py 339-388, "Classification and learning". `bill` is the same OCR
// text tests.py builds at lines 95-106.

const bill = [
  "HOTEL SITARA GRAND",
  "Phone: 04024112221/9246569444",
  "FSSAI No. 13623012000760",
  "7039 Date 29-06-26 Time 22.40",
  "Chicken 555 1 445.00 445.00",
  "Total Amcunt 2108 28",
  "State GST @ 2.5% 52.72",
  "Central GST @ 2.5% 52.72",
  "Rounc Off 0.28",
  "Net Amount 2214.00",
].join("\n");

test("classification and learning", async (t) => {
  const store = emptyMemoryStore();
  const mem = new Memory(store);
  const clf = new LedgerClassifier(ls, mem);

  const q = buildQueryText(bill, "HOTEL SITARA GRAND");
  await t.test("query drops boilerplate", () => {
    assert.ok(!q.includes("fssai") && !q.includes("phone"), q);
  });
  await t.test("query keeps the vendor", () => {
    assert.ok(q.includes("sitara"), q);
  });

  let s = clf.classify(q, "HOTEL SITARA GRAND", null);
  await t.test("ranks the correct ledger first", () => {
    assert.ok(s.length > 0);
    assert.equal(s[0].ledger, "Boarding & Lodging Expenses");
  });

  const cold = s[0].score;
  // What matters is that a bill with NO history never reaches the "high"
  // band, because that band means "pre-filled, confirm with one click".
  await t.test("cold-start never auto-fills", () => {
    assert.notEqual(s[0].band, "high", `${cold.toFixed(2)} / ${s[0].band}`);
  });
  await t.test("cold-start still leaves room to improve", () => {
    assert.ok(cold < 0.85, String(Math.round(cold * 100) / 100));
  });

  const vk = vendorKey("HOTEL SITARA GRAND", null);
  let prev = cold;
  for (let i = 1; i <= 3; i++) {
    mem.learn(vk, "Boarding & Lodging Expenses", bill);
    s = clf.classify(q, "HOTEL SITARA GRAND", null);
    const score = s[0].score;
    const band = s[0].band;
    const was = prev;
    await t.test(`confidence rises after confirmation ${i}`, () => {
      assert.ok(score > was, `${was.toFixed(2)} -> ${score.toFixed(2)}`);
    });
    prev = score;
    if (i < 3) {
      await t.test(`still capped below 'high' at ${i} confirmation(s)`, () => {
        assert.notEqual(band, "high", band);
      });
    }
  }
  await t.test("reaches 'high' at 3 confirmations", () => {
    assert.equal(s[0].band, "high");
  });

  mem.learn(vk, "Courier Charges", bill, "Boarding & Lodging Expenses");
  await t.test("a correction decays the old mapping", () => {
    const rows = store.vendorMemory[vk];
    assert.ok(
      rows["Boarding & Lodging Expenses"].count < 3,
      JSON.stringify(Object.fromEntries(
        Object.entries(rows).map(([k, v]) => [k, v.count]),
      )),
    );
  });
  await t.test("a correction is logged for audit", () => {
    assert.equal(store.corrections.length, 1);
  });

  mem.forget(vk, "Courier Charges");
  await t.test("mappings can be forgotten", () => {
    assert.ok(!("Courier Charges" in store.vendorMemory[vk]));
  });
});

// ---------------------------------------- master xml parser
// tests.py 1289-1315, "Tally All Masters parser". Skipped when the export is
// not present, exactly like the Python.

test("tally all masters parser", { skip: !existsSync(masterPath) }, async (t) => {
  // errors="replace" in the Python; Node's utf8 decoding replaces invalid
  // sequences with U+FFFD the same way.
  const ml = loadFromMasterXml(readFileSync(masterPath, "utf8"));
  const s2 = summarise(ml);
  const by2 = new Map(ml.map((l) => [l.name, l]));

  await t.test("parses the full chart of accounts", () => {
    assert.equal(s2.total, 2538, String(s2.total));
  });

  // These exist in Tally but were ABSENT from the trial balance report.
  for (const name of ["Staff Welfare Expenses", "Medical Expenses",
    "Canteen Expenses", "Fuel Expenses - Varun Mundra"]) {
    await t.test(`finds '${name}' (missing from the trial balance)`, () => {
      assert.ok(by2.has(name));
    });
  }

  await t.test("nature resolved through nested groups", () => {
    assert.equal(by2.get("Staff Welfare Expenses")!.nature, "expense");
  });

  await t.test("every LEDGER is postable (groups are separate elements)", () => {
    assert.ok(ml.every((l) => l.isPostable));
  });

  await t.test("people group holds the claimants", () => {
    const n = ml.filter(
      (l) => (l.parent ?? "").toUpperCase() === "SUNDRY CRS FOR SUNDRY EXPENSES",
    ).length;
    assert.ok(n > 300, String(n));
  });

  // tests.py 1331-1334: an empty allowlist falls back to the people group.
  await t.test("empty list falls back to the Tally group", () => {
    const got = peopleList({
      configured: [],
      ledgers: ml,
      peopleGroup: "SUNDRY CRS FOR SUNDRY EXPENSES",
    });
    assert.ok(got.length > 3, String(got.length));
  });
});

// ---------------------------------------------------- claimant allowlist
// tests.py 1316-1339, "Claimant allowlist (tally.people)". The configured
// list wins outright, trimmed, de-duplicated and sorted; the 608 Tally
// creditors are not offered.

test("claimant allowlist", async (t) => {
  const got = peopleList({
    configured: ["VARUN MUNDRA", "  SHALMAN  ", "VARUN MUNDRA", "", "   ", "aarti k"],
  });

  await t.test("allowlist replaces the Tally group", () => {
    assert.deepEqual(got, ["aarti k", "SHALMAN", "VARUN MUNDRA"]);
  });
  await t.test("blank entries are dropped", () => {
    assert.ok(!got.includes("") && !got.includes("   "));
  });
  await t.test("duplicates collapse", () => {
    assert.equal(got.filter((n) => n === "VARUN MUNDRA").length, 1);
  });
  await t.test("spelling is preserved exactly", () => {
    assert.ok(got.includes("SHALMAN") && got.includes("aarti k"));
  });
});
