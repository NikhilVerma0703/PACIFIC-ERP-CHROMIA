// Delivery challan rules, RUN against real values: the approximate amount a
// line carries, the column totals, the total in words, the tariff head, the
// four copy labels, the filename, and the list's filters. Import-free module
// (sibling pure imports only), so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHALLAN_COPIES, CHALLAN_DEFAULT_PO_REF, CHALLAN_DEFAULT_COMMODITY, CHALLAN_UNITS,
  canEditChallan, canIssueChallan, canCancelChallan, refuseChallanIssue, challanStatusTone,
  challanLineAmount, normaliseChallanItems, challanTotals, challanWords, challanTariffHead,
  challanFilename, challanDate, challanNumberLines, challansWhere, pageArgs,
} from "../src/lib/commercial/challan-rules.ts";
import { fmtIndian } from "../src/lib/commercial/invoice-rules.ts";
import { indianWords } from "../src/lib/commercial/words.ts";
import type { ChallanItem } from "../src/lib/commercial/types.ts";

// ───────────────────────────── constants ─────────────────────────────────────

test("the four copies the reference sheet names, in order, each labelled", () => {
  assert.equal(CHALLAN_COPIES.length, 4);
  assert.deepEqual([...CHALLAN_COPIES], [
    "Original - Buyer Copy",
    "Duplicate - Transporter Copy",
    "Triplicate - Central Excise Copy",
    "Quadruplicate - Assessee Copy",
  ]);
  assert.equal(CHALLAN_DEFAULT_PO_REF, "Verbal", "'Verbal' is a real PO reference on this document");
  assert.equal(CHALLAN_DEFAULT_COMMODITY, "Artificial Quartz Slabs");
  assert.ok(CHALLAN_UNITS.includes("Nos"));
});

test("status: a draft may be edited, issued or cancelled; an issued one only cancelled", () => {
  assert.equal(canEditChallan("DRAFT"), true);
  assert.equal(canEditChallan("ISSUED"), false);
  assert.equal(canIssueChallan("DRAFT"), true);
  assert.equal(canIssueChallan("ISSUED"), false);
  assert.equal(canCancelChallan("ISSUED"), true);
  assert.equal(canCancelChallan("CANCELLED"), false);
  assert.equal(challanStatusTone("ISSUED"), "green");
  assert.equal(challanStatusTone("DRAFT"), "amber");
  assert.equal(challanStatusTone("CANCELLED"), "red");
});

test("refuseChallanIssue names the reason; a lined draft passes", () => {
  assert.match(refuseChallanIssue({ status: "ISSUED", items: [{}] }) ?? "", /Only a draft/);
  assert.match(refuseChallanIssue({ status: "DRAFT", items: [] }) ?? "", /no lines/);
  assert.equal(refuseChallanIssue({ status: "DRAFT", items: [{}] }), null);
  assert.match(refuseChallanIssue({ status: "DRAFT" }) ?? "", /no lines/);
});

// ───────────────────────────── line amounts ──────────────────────────────────

test("challanLineAmount: a typed amount stands; otherwise rate × area, else rate × qty", () => {
  // the PGI sheet: 2 display slabs, 75.16 sqft each, Rs 40 / sqft ≈ 6,012.80
  assert.equal(challanLineAmount({ qty: 2, sqft: 150.32, rate: 40 }), 6012.8);
  assert.equal(challanLineAmount({ qty: 4, sqft: null, rate: 1500 }), 6000, "no area — a per-piece rate");
  assert.equal(challanLineAmount({ qty: 4, sqft: 0, rate: 1500 }), 6000, "zero area is no area");
  assert.equal(challanLineAmount({ qty: 2, sqft: 150.32, rate: 40, amount: 6000 }), 6000, "a typed amount wins");
  assert.equal(challanLineAmount({ qty: 1, sqft: 33.333, rate: 33.333 }), 1111.09, "2 dp");
});

test("normaliseChallanItems coerces the screen's rows and drops the blank ones", () => {
  const items = normaliseChallanItems([
    { description: " Display slab — Carrara Royale ", qty: "2", unit: "Nos", sqft: "150.32", rate: "40", hsn: "68101990" },
    { description: "", qty: "", rate: "", sqft: "" },
    { description: "Display stand", qty: 1, rate: 1500, amount: 1400 },
    "nonsense",
    null,
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].description, "Display slab — Carrara Royale");
  assert.equal(items[0].qty, 2);
  assert.equal(items[0].sqft, 150.32);
  assert.equal(items[0].amount, 6012.8);
  assert.equal(items[0].hsn, "68101990");
  assert.equal(items[1].unit, "Nos", "the default unit");
  assert.equal(items[1].amount, 1400, "the typed amount survives normalisation");
  assert.equal(items[1].hsn, null);
  assert.deepEqual(normaliseChallanItems("not a list"), []);
  assert.deepEqual(normaliseChallanItems(undefined), []);
});

test("a described zero-rate line — a free sample, which is what a challan carries — is KEPT", () => {
  const items = normaliseChallanItems([
    { description: "Free sample tile — Carrara Royale", qty: 1, unit: "Nos", rate: 0 },
    { description: "Free sample tile", qty: 0, unit: "Nos", rate: 0, sqft: "" },
    { description: "", qty: 0, rate: 0, sqft: 0 },
    { description: "", qty: "", rate: "", sqft: "" },
    { description: "  ", qty: null, rate: null, sqft: null },
  ]);
  assert.equal(items.length, 3, "only a row with nothing at all typed in it is dropped");
  assert.equal(items[0].description, "Free sample tile — Carrara Royale");
  assert.equal(items[0].rate, 0);
  assert.equal(items[0].amount, 0, "worth nothing, and still on the challan");
  assert.equal(items[1].description, "Free sample tile");
  assert.equal(items[2].sqft, 0, "a typed zero area is a typed value, not a blank");

  // and a challan of nothing but free samples can still be issued
  assert.equal(challanTotals(items).totalAmount, 0);
  assert.equal(refuseChallanIssue({ status: "DRAFT", items }), null);
  assert.equal(challanWords(0), "Zero Rupees Only.");
});

// ───────────────────────────── totals & words ────────────────────────────────

const items: ChallanItem[] = [
  { description: "Display slab — Carrara Royale", qty: 2, unit: "Nos", sqft: 150.32, rate: 40, amount: 0, hsn: "68101990" },
  { description: "Display stand", qty: 4, unit: "Nos", sqft: null, rate: 1500, amount: 0, hsn: "73089050" },
];

test("challanTotals settles every line and sums the three columns", () => {
  const t = challanTotals(items);
  assert.equal(t.items[0].amount, 6012.8);
  assert.equal(t.items[1].amount, 6000);
  assert.equal(t.totalQty, 6);
  assert.equal(t.totalSqft, 150.32);
  assert.equal(t.totalAmount, 12012.8);
  const empty = challanTotals([]);
  assert.equal(empty.totalAmount, 0);
  assert.equal(empty.totalSqft, 0);
});

test("challanTotals does not mutate the array it was given", () => {
  const before = JSON.stringify(items);
  challanTotals(items);
  assert.equal(JSON.stringify(items), before);
});

test("challanWords: the Indian grouping the sheet prints, TO THE PAISE", () => {
  // The challan prints its Grand Total to two decimals and has no Round Off row
  // to explain a difference, so the words have to say the same number. Rounding
  // to whole rupees overstated every total with paise on it — on all four
  // copies of a statutory movement document.
  assert.equal(challanWords(48708.75), "Forty Eight Thousand Seven Hundred Eight Rupees and Seventy Five Paise Only.");
  assert.equal(challanWords(6000.5), "Six Thousand Rupees and Fifty Paise Only.", "the paise boundary: it used to say Six Thousand One");
  assert.equal(challanWords(12012.8), "Twelve Thousand Twelve Rupees and Eighty Paise Only.");
  assert.equal(challanWords(6000), "Six Thousand Rupees Only.", "a whole total still reads as one");
  assert.equal(challanWords(0), "Zero Rupees Only.");
  assert.equal(challanWords(150000), "One Lakh Fifty Thousand Rupees Only.");
  assert.equal(challanWords(1), "One Rupees Only.");
});

test("the words and the printed Grand Total name the same number, to the paise", () => {
  // fmtIndian(total, 2) is what pdf/challan.ts prints in the Grand Total cell,
  // on every one of the four copies.
  for (const total of [48708.75, 6000.5, 12012.8, 6012.8, 42695.95, 6000, 0, 999999.99, 100.01]) {
    const printed = fmtIndian(total, 2).replace(/,/g, "");
    const [rupees, paise] = printed.split(".");
    const words = challanWords(total);
    assert.ok(
      words.startsWith(`${indianWords(Number(rupees))} Rupees`),
      `${printed} → "${words}" does not open with the rupees the figure shows`,
    );
    assert.equal(/ and .+ Paise Only\.$/.test(words), Number(paise) !== 0, `${printed} → "${words}" — paise in the words iff paise in the figure`);
  }
});

test("challanTariffHead takes the first line's HSN, else the company's quartz head", () => {
  assert.equal(challanTariffHead(items, "68101990"), "68101990");
  assert.equal(challanTariffHead([{ ...items[1], hsn: "73089050" }], "68101990"), "73089050");
  assert.equal(challanTariffHead([{ ...items[0], hsn: null }], "68101990"), "68101990");
  assert.equal(challanTariffHead([], "68101990"), "68101990");
});

// ───────────────────────────── printing ──────────────────────────────────────

test("challanFilename and challanDate print the reference's forms", () => {
  assert.equal(challanFilename("PESPL/DC/20/26"), "PESPL-DC-20-26.pdf");
  assert.equal(challanFilename(""), "challan.pdf");
  assert.equal(challanDate("2026-08-20"), "20/08/2026");
  assert.equal(challanDate("2026-08-20T06:30:00.000Z"), "20/08/2026");
  assert.equal(challanDate(null), "");
  assert.equal(challanDate("nonsense"), "");
});

test("the date prints DIRECTLY UNDER the challan number (answer 6), on the page and in the book", () => {
  assert.deepEqual(challanNumberLines("PESPL/DC/N3/26", "2026-08-20"), ["PESPL/DC/N3/26", "Dated: 20/08/2026"]);
  assert.deepEqual(challanNumberLines("PESPL/DC/N3/26", "2026-08-20T06:30:00.000Z"), ["PESPL/DC/N3/26", "Dated: 20/08/2026"], "an @db.Date arrives as an instant");
  assert.deepEqual(challanNumberLines("PESPL/DC/N3/26", null), ["PESPL/DC/N3/26"], "no date, no bare 'Dated:'");
  assert.deepEqual(challanNumberLines(null, "2026-08-20"), ["Dated: 20/08/2026"]);
  assert.deepEqual(challanNumberLines("", "nonsense"), []);
});

// ───────────────────────────── list filters ──────────────────────────────────

test("challansWhere: status, order, a date window and a free-text search", () => {
  assert.deepEqual(challansWhere({}), {});
  assert.deepEqual(challansWhere({ status: "issued" }), { status: "ISSUED" });
  assert.deepEqual(challansWhere({ status: "DRAFT,ISSUED" }), { status: { in: ["DRAFT", "ISSUED"] } });
  assert.deepEqual(challansWhere({ status: "nonsense" }), {}, "an unknown status is ignored, not sent to Postgres");
  assert.deepEqual(challansWhere({ orderId: "ord1" }), { orderId: "ord1" });
  const w = challansWhere({ from: "2026-08-01", to: "2026-08-31" });
  assert.equal((w.challanDate as { gte: Date }).gte.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal((w.challanDate as { lte: Date }).lte.toISOString(), "2026-08-31T00:00:00.000Z");
  const q = challansWhere({ q: "PGI" });
  assert.equal((q.OR as unknown[]).length, 3);
});

test("pageArgs: 1/50 by default, clamped, skip worked out", () => {
  assert.deepEqual(pageArgs(null, null), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs("2", "25"), { page: 2, limit: 25, skip: 25, take: 25 });
  assert.deepEqual(pageArgs(0, 0), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs(1, 9999), { page: 1, limit: 500, skip: 0, take: 500 });
});
