// The Commercial module's pure rules, RUN against real values — access,
// numbering, stages, the SOP checklist, amounts in words, GST, measurements,
// settings merge. Every module under test is import-free (or imports only
// lib/roles.ts), which is what lets node --test load it without Next or auth.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commercialActorOf, commercialCan, commercialActionsFor, maySeeCommercialModule, isDispatchCheckPath, COMMERCIAL_ACTORS, COMMERCIAL_HOME,
} from "../src/lib/commercial/access-rules.ts";
import { fyLabel, yy, sequenceKey, formatNumber, documentNumber, cleanOverride } from "../src/lib/commercial/numbering.ts";
import { ORDER_STAGES, canEnter, stagePatch, impliedStage, stageIndex, isTerminal } from "../src/lib/commercial/stages.ts";
import { CHECKLIST_POINTS, defaultChecklist, prefillChecklist, outstandingPoints, parseChecklist } from "../src/lib/commercial/checklist.ts";
import type { OrderEventKind } from "../src/lib/commercial/events.ts";
import { foreignWords, inrWords, amountInWords, westernWords, indianWords } from "../src/lib/commercial/words.ts";
import { computeTax, stateCodeFromGstin, looksLikeGstin } from "../src/lib/commercial/tax.ts";
import { inToCm, sqmFromCm, sqftFromSqm, sqftFromIn, slabMeasure, sumTo } from "../src/lib/commercial/measure.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/lib/commercial/settings-defaults.ts";

// ───────────────────────────── access ────────────────────────────────────────
const admin = { role: "ADMIN", branch: "SHOP_FLOOR" };
const commercial = { role: "COMMERCIAL", branch: "OFFICE" };
const store = { role: "STORE", branch: "SHOP_FLOOR" };
const lineManager = { role: "LINE_MANAGER", branch: "SHOP_FLOOR" };
const finance = { role: "FINANCE", branch: "OFFICE" };
const sales = { role: "SALES", branch: "OFFICE" };
const operator = { role: "OPERATOR", branch: "SHOP_FLOOR" };

test("actors: admin, commercial, dispatch checker (store / line manager); nobody else", () => {
  assert.equal(commercialActorOf(admin), "ADMIN");
  assert.equal(commercialActorOf(commercial), "COMMERCIAL");
  assert.equal(commercialActorOf(store), "DISPATCH_CHECKER");
  assert.equal(commercialActorOf(lineManager), "DISPATCH_CHECKER");
  for (const u of [finance, sales, operator, null, undefined, {}]) assert.equal(commercialActorOf(u), null, JSON.stringify(u));
});

test("the action table: commercial writes but does not plan or administer; the checker only verifies", () => {
  assert.deepEqual(commercialActionsFor(admin), ["view", "write", "verify", "plan", "admin"]);
  assert.deepEqual(commercialActionsFor(commercial), ["view", "write", "verify"]);
  assert.deepEqual(commercialActionsFor(store), ["verify"]);
  assert.deepEqual(commercialActionsFor(finance), []);
  assert.equal(commercialCan(commercial, "plan"), false);
  assert.equal(commercialCan(commercial, "admin"), false);
  assert.equal(commercialCan(store, "view"), false);
  // unknown action fails closed, even for admin
  assert.equal(commercialCan(admin, "delete-everything" as never), false);
  // ADMIN is written on every line of the table, not special-cased
  for (const actors of Object.values(COMMERCIAL_ACTORS)) assert.ok(actors.includes("ADMIN"));
});

test("path gate: a checker reaches only the dispatch-check paths; commercial and admin reach the module", () => {
  assert.equal(isDispatchCheckPath("/office/commercial/dispatch-check"), true);
  assert.equal(isDispatchCheckPath("/office/commercial/dispatch-check/abc?x=1"), true);
  assert.equal(isDispatchCheckPath("/api/office/commercial/dispatch-check/abc/verify"), true);
  assert.equal(isDispatchCheckPath("/office/commercial/dispatch-check-admin"), false, "near miss must not open");
  assert.equal(isDispatchCheckPath("/office/commercial/orders"), false);

  assert.equal(maySeeCommercialModule(store, "/office/commercial/dispatch-check"), true);
  assert.equal(maySeeCommercialModule(store, "/api/office/commercial/dispatch-check/x"), true);
  assert.equal(maySeeCommercialModule(store, "/office/commercial"), false);
  assert.equal(maySeeCommercialModule(store, "/api/office/commercial/orders"), false);
  assert.equal(maySeeCommercialModule(commercial, "/office/commercial/settings"), true, "path gate is coarse; the route refuses the action");
  assert.equal(maySeeCommercialModule(admin, "/api/office/commercial/anything"), true);
  assert.equal(maySeeCommercialModule(finance, "/office/commercial"), false, "uncapped office roles are refused by name");
  assert.equal(maySeeCommercialModule(null, "/office/commercial"), false);
  assert.equal(COMMERCIAL_HOME, "/office/commercial");
});

// ───────────────────────────── numbering ─────────────────────────────────────
test("financial year label starts 1 April", () => {
  assert.equal(fyLabel(new Date(2026, 8, 6)), "26-27");   // Sep 2026
  assert.equal(fyLabel(new Date(2026, 3, 1)), "26-27");   // 1 Apr 2026
  assert.equal(fyLabel(new Date(2026, 2, 31)), "25-26");  // 31 Mar 2026
  assert.equal(fyLabel(new Date(2027, 0, 15)), "26-27");  // Jan 2027 still FY 26-27
  assert.equal(yy(new Date(2026, 8, 6)), "26");
});

test("the real document formats come out of the templates", () => {
  const d = new Date(2026, 8, 6);
  assert.equal(documentNumber(DEFAULT_SETTINGS.numbering.order, d, 1404), "SAL-ORD/26-27/01404");
  assert.equal(documentNumber(DEFAULT_SETTINGS.numbering.exportInvoice, d, 2780), "PESPL/2780");
  assert.equal(documentNumber(DEFAULT_SETTINGS.numbering.dtaInvoice, d, 137), "PESPL/0137/26-27");
  assert.equal(documentNumber(DEFAULT_SETTINGS.numbering.challan, d, 20), "PESPL/DC/20/26");
  assert.equal(documentNumber(DEFAULT_SETTINGS.numbering.enquiry, d, 7), "ENQ/26-27/0007");
  // a pad never truncates
  assert.equal(formatNumber("X/{seq:2}", { fy: "", yy: "", seq: 12345 }), "X/12345");
  // a typo'd placeholder stays visible rather than vanishing
  assert.equal(formatNumber("X/{nope}/{seq}", { fy: "26-27", yy: "26", seq: 3 }), "X/{nope}/3");
});

test("per-FY counters get the FY in their key; continuous ones do not", () => {
  const d = new Date(2026, 8, 6);
  assert.equal(sequenceKey(DEFAULT_SETTINGS.numbering.order, d), "SAL-ORD");
  assert.equal(sequenceKey(DEFAULT_SETTINGS.numbering.dtaInvoice, d), "PESPL-DTA:26-27");
  assert.equal(sequenceKey(DEFAULT_SETTINGS.numbering.dtaInvoice, new Date(2027, 3, 2)), "PESPL-DTA:27-28");
});

test("a hand-typed number is trimmed and blank means none", () => {
  assert.equal(cleanOverride("  SAL-ORD/25-26/01499 "), "SAL-ORD/25-26/01499");
  assert.equal(cleanOverride("   "), null);
  assert.equal(cleanOverride(undefined), null);
});

// ───────────────────────────── stages ────────────────────────────────────────
test("stages: no gate between steps, but no leaving a terminal state and no no-op moves", () => {
  assert.equal(canEnter("DRAFT", "PACKING").ok, true, "order of steps is undecided — any forward or backward move is allowed");
  assert.equal(canEnter("PI_ISSUED", "STOCK_CHECKED").ok, true, "backwards too");
  assert.equal(canEnter("CLOSED", "PACKING").ok, false);
  assert.equal(canEnter("CANCELLED", "DRAFT").ok, false);
  assert.equal(canEnter("DRAFT", "DRAFT").ok, false);
  assert.equal(canEnter("DRAFT", "NOPE").ok, false);
  assert.ok(isTerminal("CLOSED") && isTerminal("CANCELLED") && !isTerminal("READY"));
});

test("entering a stage stamps its own timestamp and nothing else", () => {
  const now = new Date("2026-09-06T05:00:00Z");
  assert.deepEqual(stagePatch("PI_ISSUED", now), { status: "PI_ISSUED", piIssuedAt: now });
  assert.deepEqual(stagePatch("DRAFT", now), { status: "DRAFT" });
  assert.deepEqual(stagePatch("CANCELLED", now), { status: "CANCELLED", cancelledAt: now });
  // every step stage but DRAFT has a stamp column
  for (const s of ORDER_STAGES) if (s.status !== "DRAFT") assert.ok(s.stamp, s.status);
});

test("implied stages only move an order forward", () => {
  assert.equal(impliedStage("DRAFT", "STOCK_CHECKED"), "STOCK_CHECKED");
  assert.equal(impliedStage("INVOICED", "STOCK_CHECKED"), null, "a hold on an invoiced order does not drag it back");
  assert.equal(impliedStage("CLOSED", "DISPATCHED"), null);
  assert.ok(stageIndex("DISPATCHED") > stageIndex("PACKING"));
  assert.equal(stageIndex("CANCELLED"), -1);
});

// ───────────────────────────── checklist ─────────────────────────────────────
test("the SOP sheet's 22 points, in its numbering, blank by default", () => {
  assert.equal(CHECKLIST_POINTS.length, 22);
  assert.deepEqual(CHECKLIST_POINTS.slice(0, 4).map((p) => p.no), ["1", "1a", "1b", "1c"]);
  assert.equal(CHECKLIST_POINTS[CHECKLIST_POINTS.length - 1].no, "19");
  const blank = defaultChecklist();
  assert.ok(blank.every((i) => i.value === "" && i.ok === false));
});

test("prefill answers what the order knows and never overwrites a human answer", () => {
  const src = {
    customerPoNumber: "PO-4068622", customerPoDate: "2026-07-03", poEvidence: "PO",
    currency: "USD", incoterm: "FREE ON BOARD-KATTUPALLI PORT",
    items: [
      { description: "Artificial Quartz Slabs", design: "Oasis", thickness: "3 cm", sizeLabel: "Super Jumbo", qtySlabs: 47, qty: 327.81, uom: "SQMT", rate: 55.9728, amount: 18348.494 },
      { description: "Free Trade Samples", design: "Oasis", thickness: "2 cm", qtySlabs: 400, qty: 0, uom: "NOS", rate: 0, amount: 0, isSample: true },
    ],
    billTo: { name: "Ciot Inc" }, consignee: { name: "Ciot Inc" }, notifyParty: { name: "Naturoc Division DE Ciot" },
    portOfDischarge: "MONTREAL, QC, CANADA", paymentTerms: "100% Cash Against Documents (CAD)", paymentMode: "CAD",
  };
  const list = prefillChecklist(null, src);
  const by = Object.fromEntries(list.map((i) => [i.key, i]));
  assert.equal(by.poReference.value, "PO-4068622 Dt: 2026-07-03");
  assert.equal(by.evidencePo.value, "YES");
  assert.equal(by.evidencePiAck.value, "N/A");
  assert.equal(by.uom.value, "SQMT");
  assert.equal(by.samples.value, "400 × Free Trade Samples");
  assert.equal(by.shipTo.value, "Ciot Inc / Naturoc Division DE Ciot");
  assert.equal(by.totalValue.value, "USD 18348.494");
  assert.equal(by.totalValue.ok, true);
  assert.equal(by.forwarder.ok, false, "the forwarder is not on the order; a human answers it");
  // a human answer stands on re-run
  by.forwarder.value = "N/A"; by.forwarder.ok = true;
  by.uom.value = "Square Metre"; // human corrected
  const again = prefillChecklist(list, { ...src, items: [{ ...src.items[0], uom: "SQFT" }] });
  const by2 = Object.fromEntries(again.map((i) => [i.key, i]));
  assert.equal(by2.forwarder.value, "N/A");
  assert.equal(by2.uom.value, "Square Metre", "prefill fills blanks only");
  assert.deepEqual(outstandingPoints(again).map((i) => i.key).includes("deliverySchedule"), true);
});

test("a malformed checklist column becomes a full blank list, never a crash", () => {
  assert.equal(parseChecklist(null).length, 22);
  assert.equal(parseChecklist("garbage").length, 22);
  const partial = parseChecklist([{ key: "uom", value: "SQFT", ok: true }, { nonsense: 1 }, null]);
  assert.equal(partial.length, 22);
  assert.equal(partial.find((i) => i.key === "uom")?.value, "SQFT");
  assert.equal(partial.find((i) => i.key === "uom")?.label, CHECKLIST_POINTS.find((p) => p.key === "uom")?.label, "labels come from code, not the row");
});

// ───────────────────────────── words ─────────────────────────────────────────
test("the PI's own wording: Western grouping, Title Case, cents named", () => {
  assert.equal(foreignWords(17324.657, "USD"), "USD Seventeen Thousand, Three Hundred And Twenty Four and Sixty Six Cent only.");
  assert.equal(foreignWords(1200, "EUR"), "EUR One Thousand, Two Hundred only.");
  assert.equal(foreignWords(0, "USD"), "USD Zero only.");
  assert.equal(foreignWords(1000000.05, "USD"), "USD One Million and Five Cent only.");
  assert.equal(westernWords(115), "One Hundred And Fifteen");
});

test("the DTA's own wording: lakh and crore, whole rupees", () => {
  assert.equal(inrWords(3749231.7), "Thirty Seven Lakh Forty Nine Thousand Two Hundred Thirty Two Rupees Only.");
  assert.equal(inrWords(6000), "Six Thousand Rupees Only.");
  assert.equal(inrWords(12345678), "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only.");
  assert.equal(inrWords(100.5, { withPaise: true }), "One Hundred Rupees and Fifty Paise Only.");
  assert.equal(indianWords(100000), "One Lakh");
  assert.equal(amountInWords(6000, "INR"), inrWords(6000));
  assert.equal(amountInWords(5.4, "usd"), foreignWords(5.4, "USD"));
});

// ───────────────────────────── tax ───────────────────────────────────────────
test("GST: IGST across states, CGST+SGST within Tamil Nadu, none on export, whole-rupee round-off on DTA", () => {
  const base = { igstRate: 18, cgstRate: 9, sgstRate: 9, supplierStateCode: "33" };
  const jb = computeTax({ ...base, subtotal: 3177315, kind: "DOMESTIC", buyerStateCode: "27" });
  assert.equal(jb.taxType, "IGST");
  assert.equal(jb.igst, 571916.7);
  assert.equal(jb.grandTotal, 3749232);
  assert.equal(jb.roundOff, 0.3);
  assert.equal(jb.warning, null);

  const tn = computeTax({ ...base, subtotal: 1000, kind: "DOMESTIC", buyerStateCode: "33" });
  assert.equal(tn.taxType, "CGST_SGST");
  assert.equal(tn.cgst, 90); assert.equal(tn.sgst, 90); assert.equal(tn.igst, 0);
  assert.equal(tn.grandTotal, 1180);

  const ex = computeTax({ ...base, subtotal: 18348.494, kind: "EXPORT", buyerStateCode: null });
  assert.equal(ex.taxType, "NONE");
  assert.equal(ex.taxTotal, 0);
  assert.equal(ex.grandTotal, 18348.49, "export keeps its decimals");
  assert.equal(ex.roundOff, 0);

  const unknown = computeTax({ ...base, subtotal: 100, kind: "DOMESTIC", buyerStateCode: "" });
  assert.equal(unknown.taxType, "IGST");
  assert.match(unknown.warning ?? "", /state code missing/);
});

test("GSTIN helpers", () => {
  assert.equal(stateCodeFromGstin("27AAACJ2549J1ZG"), "27");
  assert.equal(stateCodeFromGstin("AALCP2750N"), null);
  assert.equal(looksLikeGstin("33AALCP2750N1Z3"), true);
  assert.equal(looksLikeGstin("33AAFCP5374A1ZQ"), true);
  assert.equal(looksLikeGstin("9876543210"), false);
});

// ───────────────────────────── measure ───────────────────────────────────────
test("measurements agree with the CIOT list and with the inventory page", () => {
  assert.equal(sqmFromCm(347, 201), 6.9747);
  assert.equal(sqftFromSqm(6.9747), 75.076);
  assert.equal(sqftFromIn(137, 79), 75.16, "the inventory module's own figure");
  assert.equal(inToCm(137), 348);
  assert.equal(inToCm(79), 201);
  const m = slabMeasure(137, 79);
  assert.deepEqual(m, { lengthCm: 348, widthCm: 201, sqm: 6.9948, sqft: 75.292 });
  const measured = slabMeasure(137, 79, { lengthCm: 347, widthCm: 201 });
  assert.equal(measured.sqm, 6.9747, "a measured size overrides the nominal one");
  assert.equal(sumTo([75.0756708, 75.0756708, 75.0756708], 4), 225.227);
});

// ───────────────────────────── settings ──────────────────────────────────────
test("settings merge: overrides win by type, arrays replace, junk is ignored", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    holdDays: 7,
    numbering: { order: { template: "SO/{fy}/{seq:5}" } },
    company: { addressLines: ["Line 1"], gstin: 12345 },
    tax: { igstRate: "eighteen" },
    unknownSection: { x: 1 },
  });
  assert.equal(merged.holdDays, 7);
  assert.equal(merged.numbering.order.template, "SO/{fy}/{seq:5}");
  assert.equal(merged.numbering.order.key, "SAL-ORD", "untouched keys keep their default");
  assert.deepEqual(merged.company.addressLines, ["Line 1"]);
  assert.equal(merged.company.gstin, DEFAULT_SETTINGS.company.gstin, "a number is not a GSTIN");
  assert.equal(merged.tax.igstRate, 18, "a string is not a rate");
  assert.equal("unknownSection" in merged, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, null), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.holdDays, 5, "owner's ruling");
});

// ───────────────────── review fixes (2026-09-06) ─────────────────────────────
// Findings from the module's adversarial review that landed in the foundation
// files. Each test fails against the behaviour that shipped before it.

test("a zero is not an answer: an unpriced order leaves Quantity, Rate and Total open", () => {
  // The prefill ran every figure through a numeric coercion that turns null
  // into 0, and "0" is a non-empty string, so an order whose lines carry no
  // prices yet came back with points 4, 6 and 7 PREFILLED AND TICKED — the SOP
  // sheet claiming Commercial had confirmed a rate nobody had typed.
  const unpriced = prefillChecklist(null, {
    currency: "USD",
    items: [{ description: "Carrara Royale", design: "Carrara Royale", thickness: "3 cm", uom: "SQFT" }],
  });
  const by = Object.fromEntries(unpriced.map((i) => [i.key, i]));
  for (const key of ["quantity", "rate", "totalValue"]) {
    assert.equal(by[key].value, "", `${key} must stay blank on an unpriced order`);
    assert.equal(by[key].ok, false, `${key} must not read as answered`);
  }
  assert.ok(outstandingPoints(unpriced).some((i) => i.key === "rate"), "rate belongs on the outstanding list");

  // ...and a priced order still answers all three.
  const priced = prefillChecklist(null, {
    currency: "USD",
    items: [{ description: "Carrara Royale", thickness: "3 cm", qtySlabs: 43, qty: 3208.273, uom: "SQFT", rate: 5.4, amount: 17324.657 }],
  });
  const byP = Object.fromEntries(priced.map((i) => [i.key, i]));
  assert.equal(byP.quantity.ok, true);
  assert.equal(byP.rate.value, "5.4");
  assert.equal(byP.totalValue.value, "USD 17324.657");

  // A free line is not an unpriced order: the 1404 PI's sample row really is
  // 0.0, and the priced line beside it must still answer the three points.
  const withFreeSample = prefillChecklist(null, {
    currency: "USD",
    items: [
      { description: "Carrara Royale", qtySlabs: 43, qty: 3208.273, uom: "SQFT", rate: 5.4, amount: 17324.657 },
      { description: "Samples", qtySlabs: 25, qty: 0, rate: 0, amount: 0, isSample: true },
    ],
  });
  const byF = Object.fromEntries(withFreeSample.map((i) => [i.key, i]));
  assert.equal(byF.rate.ok, true);
  assert.equal(byF.samples.value, "25 × Samples");
});

test("a dispatch checker on a branch with its own middleware block is not a checker at all", () => {
  // The branch blocks in middleware.ts run AFTER this module's block and they
  // return, so a STORE or LINE_MANAGER login sitting on FABRICATION,
  // INTERNATIONAL_SALES or CHROMIA was refused the dispatch-check PAGE while
  // still being admitted to every dispatch-check API call (those blocks pass
  // /api straight through). An API a person can drive but a screen they cannot
  // open is wider than the screen would ever have been.
  for (const branch of ["FABRICATION", "INTERNATIONAL_SALES", "CHROMIA"]) {
    for (const role of ["STORE", "LINE_MANAGER"]) {
      const u = { role, branch };
      assert.equal(commercialActorOf(u), null, `${role}/${branch}`);
      assert.equal(commercialCan(u, "verify"), false, `${role}/${branch} must not verify`);
      assert.equal(maySeeCommercialModule(u, "/api/office/commercial/dispatch-check"), false, `${role}/${branch} must not reach the API`);
    }
  }
  // The branches middleware leaves to the role caps still work.
  for (const branch of ["SHOP_FLOOR", "OFFICE"]) {
    assert.equal(commercialActorOf({ role: "STORE", branch }), "DISPATCH_CHECKER", `STORE/${branch}`);
    assert.equal(commercialCan({ role: "LINE_MANAGER", branch }, "verify"), true, `LINE_MANAGER/${branch}`);
  }
  // An admin is exempt from every branch block, so the branch never demotes one.
  assert.equal(commercialActorOf({ role: "ADMIN", branch: "FABRICATION" }), "ADMIN");
});

test("every event kind a document's story needs exists, so nothing has to log as a note", () => {
  // The first cut carried only each document's milestone, so drafting, editing
  // and cancelling logged as "note" and read in the log as somebody's comment.
  const kinds: OrderEventKind[] = [
    "pi_drafted", "pi_edited", "pi_cancelled",
    "invoice_created", "invoice_edited",
    "challan_created", "challan_issued", "challan_cancelled",
    "export_docs",
  ];
  assert.equal(new Set(kinds).size, kinds.length);
});
