// The orders area's rules, RUN against real values — the order the routes and
// the order workspace actually take. src/lib/commercial/orders-rules.ts is
// import-free, which is what lets node --test load it without Next, Prisma or
// auth; anything these tests prove is therefore true of the running module,
// not of a copy of it.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/commercialOrders.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_KINDS, PO_EVIDENCE, HEADER_TEXT_FIELDS, HEADER_PARTY_FIELDS,
  defaultsForKind, clientDefaults, splitAddress, partyFromClient, normalizeParty, partiesFromClient,
  itemAmount, orderTotals, changedFields, fmtDateDMY, checklistSourceFromOrder,
  ordersWhere, pageArgs, nextLineNo, renumberLines, canApprove, describeItem, orderWorkspaceView, stageFactsOf, isLiveHold,
  type SettingsLike, type ClientLike, type ClientExtLike,
} from "../src/lib/commercial/orders-rules.ts";
import { canEnter } from "../src/lib/commercial/stages.ts";
import { advanceStatus, effectiveAdvancePct, advancePctChange } from "../src/lib/commercial/receipts-rules.ts";
import { prefillChecklist, parseChecklist, outstandingPoints, CHECKLIST_POINTS } from "../src/lib/commercial/checklist.ts";
import { DEFAULT_SETTINGS } from "../src/lib/commercial/settings-defaults.ts";

const settings = DEFAULT_SETTINGS as unknown as SettingsLike;

// ───────────────────────────── defaults by kind ──────────────────────────────

test("defaultsForKind: EXPORT is USD out of the settings' port; DOMESTIC is INR with the domestic terms", () => {
  const ex = defaultsForKind("EXPORT", settings);
  assert.equal(ex.currency, "USD");
  assert.equal(ex.countryOfOrigin, DEFAULT_SETTINGS.defaults.countryOfOrigin);
  assert.equal(ex.portOfLoading, DEFAULT_SETTINGS.defaults.portOfLoading || null);
  assert.equal(ex.preCarriageBy, DEFAULT_SETTINGS.defaults.preCarriageBy || null);
  assert.equal(ex.countryOfDestination, null, "an export has no destination until the form names one");
  assert.equal(ex.uom, DEFAULT_SETTINGS.defaults.unitExport);

  const dom = defaultsForKind("DOMESTIC", settings);
  assert.equal(dom.currency, "INR");
  assert.equal(dom.portOfLoading, null, "a domestic order does not load at a port");
  assert.equal(dom.preCarriageBy, null);
  assert.equal(dom.deliveryTerms, DEFAULT_SETTINGS.defaults.domesticDeliveryTerms || null);
  assert.equal(dom.paymentTerms, DEFAULT_SETTINGS.defaults.domesticPaymentTerms || null);
  assert.equal(dom.countryOfDestination, dom.countryOfOrigin, "a domestic order ships inside the country of origin");
  assert.equal(dom.uom, DEFAULT_SETTINGS.defaults.unitDomestic);
  assert.equal(dom.hsn, DEFAULT_SETTINGS.company.hsnQuartz);
});

test("defaultsForKind: blank settings still produce a usable order", () => {
  const blank: SettingsLike = {
    defaults: { portOfLoading: "", preCarriageBy: "", countryOfOrigin: "", exportPaymentTerms: "", domesticDeliveryTerms: "", domesticPaymentTerms: "", unitExport: "", unitDomestic: "" },
    company: { hsnQuartz: "" },
  };
  const ex = defaultsForKind("EXPORT", blank);
  assert.equal(ex.countryOfOrigin, "India");
  assert.equal(ex.portOfLoading, null, "an empty string is not a port");
  assert.equal(ex.paymentTerms, null);
  assert.equal(ex.uom, "Square Foot");
  assert.equal(ex.hsn, "68101990");
  assert.equal(defaultsForKind("DOMESTIC", blank).uom, "SQFT");
});

test("clientDefaults: only what the client master actually has, so nothing is blanked", () => {
  const client: ClientLike = {
    name: "JB Homes", country: "India", email: "buy@jbhomes.in", phone: "+91 44 1234",
    contactPerson: "Mr Ravi", defaultCurrency: "inr", defaultPaymentTerms: "30 days from BL",
    defaultDeliveryTerms: null, defaultPortOfDischarge: "Chennai",
  };
  const d = clientDefaults(client, { defaultIncoterm: "FOB", defaultCurrency: null });
  assert.equal(d.currency, "INR", "currency is upper-cased");
  assert.equal(d.incoterm, "FOB");
  assert.equal(d.paymentTerms, "30 days from BL");
  assert.ok(!("deliveryTerms" in d), "a null on the master must not blank the kind default");
  assert.equal(d.portOfDischarge, "Chennai");
  assert.equal(d.customerContact, "Mr Ravi · buy@jbhomes.in · +91 44 1234");

  assert.deepEqual(clientDefaults(null, null), {}, "no client, nothing to say");
  assert.equal(clientDefaults(client, { defaultCurrency: "usd" }).currency, "USD", "the ext wins over the client row");
});

// ───────────────────────────── party blocks ──────────────────────────────────

test("splitAddress: newlines first, commas when there is only one line", () => {
  assert.deepEqual(splitAddress("12 Main St\nSpringfield\nIL 62704"), ["12 Main St", "Springfield", "IL 62704"]);
  assert.deepEqual(splitAddress("12 Main St, Springfield, IL 62704"), ["12 Main St", "Springfield", "IL 62704"]);
  assert.deepEqual(splitAddress("  \n  "), []);
  assert.deepEqual(splitAddress(null), []);
});

test("partyFromClient: the printed block a client falls back to, with the ext's ids", () => {
  const p = partyFromClient(
    { name: "Vicostone Ltd", address: "Plot 4, Hoa Lac\nHanoi", city: "Hanoi", country: "Vietnam", phone: "+84 1", email: "a@b.c" },
    { gstin: "33AALCP2750N1Z3", stateCode: "33", customerCode: "USA-041" },
  );
  assert.equal(p.name, "Vicostone Ltd");
  assert.deepEqual(p.lines, ["Plot 4, Hoa Lac", "Hanoi"], "the city is already in the address; it must not repeat");
  assert.equal(p.country, "Vietnam");
  assert.equal(p.gstin, "33AALCP2750N1Z3");
  assert.equal(p.code, "USA-041");

  const q = partyFromClient({ name: "X", address: "1 Anna Salai", city: "Chennai", country: "India" });
  assert.deepEqual(q.lines, ["1 Anna Salai", "Chennai"], "a city the address omits is appended");
  assert.equal(q.gstin, null);
});

test("normalizeParty: array lines, newline text, an address string — or null when it names nobody", () => {
  assert.equal(normalizeParty(null), null);
  assert.equal(normalizeParty("Vicostone"), null, "a bare string is not a party block");
  assert.equal(normalizeParty({ name: "", lines: [] }), null, "an empty block is no party at all");
  assert.deepEqual(normalizeParty({ name: "A", lines: ["l1", "", "l2"] })?.lines, ["l1", "l2"]);
  assert.deepEqual(normalizeParty({ name: "A", lines: "l1\nl2" })?.lines, ["l1", "l2"]);
  assert.deepEqual(normalizeParty({ name: "A", address: "l1, l2" })?.lines, ["l1", "l2"]);
  assert.equal(normalizeParty({ name: "A", phone: "+91" })?.tel, "+91", "phone is accepted as tel");
  assert.equal(normalizeParty({ lines: ["Only an address"] })?.name, "", "an address with no name is still a block");
});

test("partiesFromClient: the ext's blocks win; consignee falls back to bill-to; no empty notify party", () => {
  const client: ClientLike = { name: "JB Homes", address: "1 Anna Salai, Chennai", country: "India" };
  const ext: ClientExtLike = {
    gstin: "33AALCP2750N1Z3", stateCode: "33", customerCode: "JB-01",
    billingAddress: { name: "JB Homes Pvt Ltd", lines: ["Regd Office, Chennai"] },
    shippingAddress: null,
    notifyParty: null,
  };
  const p = partiesFromClient(client, ext);
  assert.equal(p.billTo.name, "JB Homes Pvt Ltd");
  assert.equal(p.billTo.gstin, "33AALCP2750N1Z3", "the ext's ids ride along on a printed block that has none");
  assert.deepEqual(p.consignee, p.billTo, "no ship-to on file: the consignee is the buyer");
  assert.equal(p.notifyParty, null, "an empty notify party would print as one — leave it null");

  const q = partiesFromClient(client, { ...ext, shippingAddress: { name: "Site Store", lines: ["Site 4, OMR"] }, notifyParty: { name: "Agent", lines: ["Chennai"] } });
  assert.equal(q.consignee.name, "Site Store");
  assert.equal(q.notifyParty?.name, "Agent");

  const bare = partiesFromClient(client, null);
  assert.equal(bare.billTo.name, "JB Homes");
  assert.deepEqual(bare.consignee, bare.billTo);
});

// ───────────────────────────── line amounts and totals ───────────────────────

test("itemAmount: a typed amount stands; otherwise qty × rate at 3 dp", () => {
  assert.equal(itemAmount(10, 2.5), 25);
  assert.equal(itemAmount("784.8867", "22.5"), 17659.951, "3 dp, the column's precision");
  assert.equal(itemAmount(10, 2.5, 24.999), 24.999, "the figure the customer agreed is not recomputed");
  assert.equal(itemAmount(10, 2.5, 0), 0, "a typed zero is a value, not a blank");
  assert.equal(itemAmount(null, 2.5), null);
  assert.equal(itemAmount(10, null), null);
  assert.equal(itemAmount(10, 2.5, ""), 25, "a blank amount box means 'work it out'");
  assert.equal(itemAmount("1,200", "1.5"), 1800, "a typed thousands separator is not a NaN");
});

test("orderTotals: slabs, quantity per unit, money, and the sample flag", () => {
  const t = orderTotals([
    { qtySlabs: 47, qty: 784.887, uom: "Square Foot", amount: 17659.951 },
    { qtySlabs: 12, qty: 200.5, uom: "Square Foot", amount: 4511.25 },
    { qtySlabs: null, qty: 4, uom: "NOS", amount: 0, isSample: true },
  ]);
  assert.equal(t.lines, 3);
  assert.equal(t.goodsLines, 2);
  assert.equal(t.sampleLines, 1);
  assert.equal(t.slabs, 59);
  assert.deepEqual(t.qtyByUom, { "Square Foot": 985.387, NOS: 4 });
  assert.equal(t.amount, 22171.201);
  assert.equal(t.hasSamples, true);

  const empty = orderTotals([]);
  assert.equal(empty.amount, 0);
  assert.equal(empty.slabs, 0);
  assert.equal(empty.hasSamples, false);
  assert.deepEqual(empty.qtyByUom, {});

  assert.deepEqual(orderTotals([{ qty: 1 }]).qtyByUom, { "—": 1 }, "a line with no unit is still counted, under a visible label");
});

// ───────────────────────────── what an edit changed ──────────────────────────

test("changedFields: only keys the patch carries, and only real differences", () => {
  const before = { customerPoNumber: "PO-1", incoterm: "FOB", notes: null, exchangeRate: 88.5, customerPoDate: new Date("2026-07-03T00:00:00.000Z") };
  assert.deepEqual(changedFields(before, { customerPoNumber: "PO-1" }), [], "same value, no event");
  assert.deepEqual(changedFields(before, { customerPoNumber: "PO-2" }), ["customerPoNumber"]);
  assert.deepEqual(changedFields(before, { notes: undefined }), [], "undefined and null read the same");
  assert.deepEqual(changedFields(before, { notes: "" }), ["notes"], "a blank string is a change from null");
  assert.deepEqual(changedFields(before, { deliveryTerms: null }), [], "a key that was already absent is not a change");
  assert.deepEqual(changedFields(before, { customerPoDate: "2026-07-03T00:00:00.000Z" }), [], "a Date and its ISO string are one value");
  assert.deepEqual(changedFields(before, { customerPoDate: "2026-07-04T00:00:00.000Z" }), ["customerPoDate"]);
});

test("changedFields: a Date and an ISO instant written any legal way are one value", () => {
  // The fixture above uses the canonical ISO form, which JSON.stringify alone
  // already matches — so it cannot tell whether the normalisation is there.
  // A JSON body carries whatever the client serialised: an instant with no
  // milliseconds, or with more than three, is the SAME MOMENT as the stored
  // Date, and an edit that changes nothing must not log an "edited" event or
  // stamp the order as touched.
  const stored = new Date("2026-07-03T00:00:00.000Z");
  const before = { customerPoDate: stored, deliveredAt: stored };
  for (const same of [
    "2026-07-03T00:00:00Z",           // no milliseconds — what most clients send
    "2026-07-03T00:00:00.0Z",
    "2026-07-03T00:00:00.000Z",
    "2026-07-03T00:00:00.000000Z",    // microseconds, as Postgres writes them
  ]) {
    assert.deepEqual(changedFields(before, { customerPoDate: same }), [], `${same} is the same instant as the stored Date`);
  }
  for (const other of ["2026-07-03T00:00:01Z", "2026-07-04T00:00:00Z", "2026-07-03T00:00:00.001Z"]) {
    assert.deepEqual(changedFields(before, { customerPoDate: other }), ["customerPoDate"], `${other} is a real change`);
  }
  // both directions: a Date arriving where a string is stored reads the same too
  assert.deepEqual(changedFields({ customerPoDate: "2026-07-03T00:00:00Z" }, { customerPoDate: stored }), []);
  // and a plain date-only string is text, not an instant — it is not a Date's twin
  assert.deepEqual(changedFields(before, { customerPoDate: "2026-07-03" }), ["customerPoDate"]);
});

test("changedFields: two party blocks typed in a different key order are the same block", () => {
  const before = { billTo: { name: "A", lines: ["l1"], country: "India", tel: null } };
  assert.deepEqual(changedFields(before, { billTo: { lines: ["l1"], country: "India", name: "A" } }), []);
  assert.deepEqual(changedFields(before, { billTo: { name: "A", lines: ["l1", "l2"], country: "India" } }), ["billTo"]);
  assert.deepEqual(changedFields(before, { billTo: null }), ["billTo"]);
});

test("changedFields: a Decimal column compares by its number", () => {
  const decimal = { toNumber: () => 88.5, toFixed: (n: number) => (88.5).toFixed(n) };
  assert.deepEqual(changedFields({ exchangeRate: decimal }, { exchangeRate: 88.5 }), []);
  assert.deepEqual(changedFields({ exchangeRate: decimal }, { exchangeRate: 88.6 }), ["exchangeRate"]);
});

// ───────────────────────────── the checklist source ──────────────────────────

test("fmtDateDMY: the way the documents write a PO date", () => {
  assert.equal(fmtDateDMY("2026-07-03"), "03/07/2026");
  assert.equal(fmtDateDMY(new Date(Date.UTC(2026, 6, 3))), "03/07/2026");
  assert.equal(fmtDateDMY("2026-07-03T18:30:00.000Z"), "03/07/2026");
  assert.equal(fmtDateDMY(null), "");
  assert.equal(fmtDateDMY("not a date"), "");
});

test("checklistSourceFromOrder feeds prefillChecklist: an order with everything settles every point it can answer", () => {
  const order = {
    customerPoNumber: "PO-4068622",
    customerPoDate: new Date(Date.UTC(2026, 6, 3)),
    poEvidence: "PO",
    currency: "USD",
    incoterm: "FOB",
    billTo: { name: "Vicostone Ltd", lines: ["Hanoi"] },
    consignee: { name: "Vicostone Ltd", lines: ["Hanoi"] },
    notifyParty: { name: "Agent Co", lines: ["Chennai"] },
    portOfDischarge: "Haiphong",
    finalDestination: "Vietnam",
    paymentTerms: "30 days from BL",
    paymentMode: "CAD",
    forwarderDetails: "Ace Forwarders, Chennai",
    receiverDetails: "N/A",
    customerContact: "Mr Ravi · buy@x.com",
    deliverySchedule: "Two containers, Aug and Sep",
    specialPacking: "Fumigated crates",
  };
  const items = [
    { description: "CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium", design: "CARRARA ROYALE", thickness: "3 cm", sizeLabel: "Super Jumbo", qtySlabs: 47, qty: 784.887, uom: "Square Foot", rate: 22.5, amount: 17659.951, isSample: false },
    { description: "Display stand", qty: 4, uom: "NOS", rate: 0, amount: 0, isSample: true },
  ];
  const src = checklistSourceFromOrder(order, items);
  assert.equal(src.customerPoDate, "03/07/2026", "the PO date reaches the sheet as DD/MM/YYYY");
  assert.deepEqual(src.billTo, { name: "Vicostone Ltd" }, "only the name goes on the sheet");

  const list = prefillChecklist(null, src as never);
  assert.equal(list.length, CHECKLIST_POINTS.length, "always the full 22-point sheet");
  const by = new Map(list.map((i) => [i.key, i]));
  assert.equal(by.get("poReference")?.value, "PO-4068622 Dt: 03/07/2026");
  assert.equal(by.get("evidencePo")?.value, "YES");
  assert.equal(by.get("evidencePiAck")?.value, "N/A");
  assert.equal(by.get("shipTo")?.value, "Vicostone Ltd / Agent Co");
  assert.equal(by.get("samples")?.value, "4 × Display stand", "the SOP's point 8 asks for the samples");
  assert.equal(by.get("totalValue")?.value, "USD 17659.951");
  assert.equal(outstandingPoints(list).length, 0, "an order with every answer leaves nothing for Commercial to chase");
});

test("checklistSourceFromOrder: a bare order leaves the points it cannot answer outstanding", () => {
  const list = prefillChecklist(null, checklistSourceFromOrder({ currency: "INR" }, []) as never);
  const open = outstandingPoints(list).map((i) => i.key);
  assert.ok(open.includes("poReference"), "no PO number: the point stays open");
  assert.ok(open.includes("deliverySchedule"));
  assert.ok(open.includes("customerContact"));
  assert.equal(open.length, CHECKLIST_POINTS.length, "nothing can be settled from an empty order");
});

test("re-running the prefill after an edit never overwrites a hand-typed answer", () => {
  const first = prefillChecklist(null, checklistSourceFromOrder({ deliverySchedule: null }, []) as never);
  const typed = first.map((i) => (i.key === "deliverySchedule" ? { ...i, value: "Whenever the buyer calls", ok: true } : i));
  const after = prefillChecklist(parseChecklist(typed), checklistSourceFromOrder({ deliverySchedule: "Two containers" }, []) as never);
  assert.equal(after.find((i) => i.key === "deliverySchedule")?.value, "Whenever the buyer calls");
});

// ───────────────────────────── list filters and paging ───────────────────────

test("ordersWhere: status, kind, client and the free-text search", () => {
  assert.deepEqual(ordersWhere({}), {});
  assert.deepEqual(ordersWhere({ status: "draft" }), { status: "DRAFT" });
  assert.deepEqual(ordersWhere({ status: "DRAFT,CONFIRMED" }), { status: { in: ["DRAFT", "CONFIRMED"] } });
  assert.deepEqual(ordersWhere({ kind: "export" }), { kind: "EXPORT" });
  assert.deepEqual(ordersWhere({ kind: "banana" }), {}, "an unknown kind is dropped, not sent to Postgres as a bad enum");
  assert.deepEqual(ordersWhere({ clientId: "c1" }), { clientId: "c1" });

  const q = ordersWhere({ q: "1404" }) as { OR: Array<Record<string, unknown>> };
  assert.equal(q.OR.length, 3, "number, customer PO and client name");
  assert.deepEqual(q.OR[0], { number: { contains: "1404", mode: "insensitive" } });
  assert.deepEqual(q.OR[2], { client: { name: { contains: "1404", mode: "insensitive" } } });
  assert.deepEqual(ordersWhere({ q: "   " }), {}, "a blank search is no filter");
});

test("pageArgs: 1 / 50 by default, never a negative skip, capped at 500", () => {
  assert.deepEqual(pageArgs(null, null), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs("3", "20"), { page: 3, limit: 20, skip: 40, take: 20 });
  assert.deepEqual(pageArgs("0", "0"), { page: 1, limit: 1, skip: 0, take: 1 });
  assert.deepEqual(pageArgs("-5", "9999"), { page: 1, limit: 500, skip: 0, take: 500 });
  assert.deepEqual(pageArgs("abc", "abc"), { page: 1, limit: 50, skip: 0, take: 50 });
});

// ───────────────────────────── line numbering ────────────────────────────────

test("nextLineNo: one past the highest, 1 on an empty order", () => {
  assert.equal(nextLineNo([]), 1);
  assert.equal(nextLineNo([{ lineNo: 1 }, { lineNo: 4 }]), 5, "a gap does not get reused mid-order");
});

test("renumberLines: 1..n after a delete, and only the rows that move", () => {
  assert.deepEqual(renumberLines([{ id: "a", lineNo: 1 }, { id: "c", lineNo: 3 }]), [{ id: "c", lineNo: 2 }]);
  assert.deepEqual(renumberLines([{ id: "a", lineNo: 1 }, { id: "b", lineNo: 2 }]), [], "nothing to write when the numbers are already right");
  assert.deepEqual(
    renumberLines([{ id: "c", lineNo: 5 }, { id: "a", lineNo: 2 }]),
    [{ id: "a", lineNo: 1 }, { id: "c", lineNo: 2 }],
    "renumbered in line order, not in the order the rows arrived",
  );
});

// ───────────────────────────── approval and log text ─────────────────────────

test("canApprove: the Commercial Manager and admins (answer 10); never Commercial or the dispatch checker", () => {
  assert.equal(canApprove("ADMIN"), true);
  assert.equal(canApprove("COMMERCIAL_MANAGER"), true);
  assert.equal(canApprove("COMMERCIAL"), false, "Commercial prepares the checklist; the manager approves it");
  assert.equal(canApprove("DISPATCH_CHECKER"), false);
  assert.equal(canApprove(null), false);
  assert.equal(canApprove(undefined), false);
});

test("describeItem: what the order log says about a line", () => {
  assert.equal(
    describeItem({ lineNo: 1, design: "CARRARA ROYALE", thickness: "3 cm", qtySlabs: 47 }),
    "Line 1: CARRARA ROYALE 3 cm × 47 slabs",
  );
  assert.equal(describeItem({ lineNo: 2, description: "Display stand", qty: 4, uom: "NOS", isSample: true }), "Line 2: Display stand × 4 NOS (sample)");
  assert.equal(describeItem({}), "line", "a line with nothing on it still logs readably");
});

// ───────────────────────────── the shared field lists ────────────────────────

test("the header field lists cover the order form and overlap nothing", () => {
  for (const k of ["customerPoNumber", "incoterm", "deliveryTerms", "paymentTerms", "paymentMode", "portOfLoading", "portOfDischarge", "finalDestination", "deliverySchedule", "specialPacking", "forwarderDetails", "receiverDetails", "customerContact", "notes"]) {
    assert.ok(HEADER_TEXT_FIELDS.includes(k), `${k} must be editable`);
  }
  assert.deepEqual([...HEADER_PARTY_FIELDS], ["billTo", "consignee", "notifyParty", "buyerIfNotConsignee"]);
  for (const k of HEADER_PARTY_FIELDS) assert.ok(!HEADER_TEXT_FIELDS.includes(k), `${k} is a party block, not text`);
  assert.deepEqual([...ORDER_KINDS], ["DOMESTIC", "EXPORT"]);
  assert.deepEqual([...PO_EVIDENCE], ["PO", "PI_ACKNOWLEDGED", "EMAIL"]);
});

// ───────────────────────────── the pipeline's facts ──────────────────────────
// order-stage.loadStageFacts (server) and OrderWorkspace's strip (client) both
// run stageFactsOf and hand the result to canEnter, so the reason a stage is
// greyed on screen is the reason the route 409s with.

test("stageFactsOf: every fact is a definite boolean — an undefined would slip past canEnter's gates", () => {
  const none = stageFactsOf({});
  assert.deepEqual(none, { stockChecked: false, approved: false, advanceReceived: false });
  for (const v of Object.values(none)) assert.equal(typeof v, "boolean");
});

test("stageFactsOf: stockChecked needs the stamp AND a live hold — a lapsed hold sends the order back (answer 11)", () => {
  const stamped = "2026-09-01T10:00:00.000Z";
  assert.equal(stageFactsOf({ stockCheckedAt: stamped, holds: [{ status: "ACTIVE" }] }).stockChecked, true);
  assert.equal(stageFactsOf({ stockCheckedAt: stamped, holds: [{ status: "EXPIRED" }] }).stockChecked, false, "the stamp alone is history");
  assert.equal(stageFactsOf({ stockCheckedAt: stamped, holds: [{ status: "RELEASED" }, { status: "ACTIVE" }] }).stockChecked, true, "one live hold among old ones is enough");
  assert.equal(stageFactsOf({ stockCheckedAt: null, holds: [{ status: "ACTIVE" }] }).stockChecked, false, "a hold without the stamp is not a stock check either");
  assert.equal(stageFactsOf({ stockCheckedAt: new Date(stamped), holds: [{ status: "ACTIVE" }] }).stockChecked, true, "a Date from Prisma counts as set");
  assert.equal(stageFactsOf({ stockCheckedAt: "", holds: [{ status: "ACTIVE" }] }).stockChecked, false);
});

test("isLiveHold / stageFactsOf: an ACTIVE hold past its expiry is not a live stock check, even before the sweep marks it EXPIRED", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  const stamped = "2026-09-01T10:00:00.000Z";
  // the sweep (reconcileHold) runs after the lapse; between the two the row still says ACTIVE
  assert.equal(isLiveHold({ status: "ACTIVE", expiresAt: "2026-09-08T11:59:59.000Z" }, now), false, "lapsed a second ago");
  assert.equal(isLiveHold({ status: "ACTIVE", expiresAt: "2026-09-08T12:00:00.000Z" }, now), false, "expiring exactly now is not live (gt, matching the server probe)");
  assert.equal(isLiveHold({ status: "ACTIVE", expiresAt: "2026-09-12T12:00:00.000Z" }, now), true, "still inside its window");
  assert.equal(isLiveHold({ status: "ACTIVE", expiresAt: new Date("2026-09-12T12:00:00.000Z") }, now), true, "a Date from Prisma reads the same as the ISO the detail carries");
  assert.equal(isLiveHold({ status: "EXPIRED", expiresAt: "2026-09-12T12:00:00.000Z" }, now), false, "a status other than ACTIVE is never live, whatever the date says");
  assert.equal(isLiveHold({ status: "ACTIVE" }, now), true, "no expiresAt: the server probe already filtered on it");
  assert.equal(isLiveHold({ status: "ACTIVE", expiresAt: "not a date" }, now), false, "an unreadable expiry is not proof of a held slab");
  // and through stageFactsOf, which is what canEnter's PI gate reads (answers 1, 11)
  assert.equal(stageFactsOf({ stockCheckedAt: stamped, holds: [{ status: "ACTIVE", expiresAt: "2026-09-07T00:00:00.000Z" }] }, now).stockChecked, false, "the stamp plus a lapsed-but-unswept hold is history");
  assert.equal(stageFactsOf({ stockCheckedAt: stamped, holds: [{ status: "ACTIVE", expiresAt: "2026-09-07T00:00:00.000Z" }, { status: "ACTIVE", expiresAt: "2026-09-20T00:00:00.000Z" }] }, now).stockChecked, true, "one live hold among lapsed ones is enough");
  const lapsed = stageFactsOf({ stockCheckedAt: stamped, approvedAt: stamped, holds: [{ status: "ACTIVE", expiresAt: "2026-09-07T00:00:00.000Z" }], advance: { satisfied: false } }, now);
  const pi = canEnter("CONFIRMED", "PI_ISSUED", lapsed);
  assert.equal(pi.ok, false, "the PI gate shuts on a lapsed hold");
  assert.match((pi as { reason: string }).reason, /Stock check first/);
});

test("stageFactsOf: approved is the approval stamp (answer 10); the advance is handed in, never guessed (round two, answer 11)", () => {
  assert.equal(stageFactsOf({ approvedAt: "2026-09-02T00:00:00.000Z" }).approved, true);
  assert.equal(stageFactsOf({ approvedAt: null }).approved, false);
  // the order detail carries advanceStatus's answer; the strip reads it
  assert.equal(stageFactsOf({ advance: { satisfied: true } }).advanceReceived, true);
  assert.equal(stageFactsOf({ advance: { satisfied: false } }).advanceReceived, false);
  // and the explicit boolean, when a caller has already reduced it
  assert.equal(stageFactsOf({ advanceReceived: true, advance: { satisfied: false } }).advanceReceived, true);
  assert.equal(stageFactsOf({ advanceReceived: false, advance: { satisfied: true } }).advanceReceived, false);
  // ROUND TWO CHANGED THIS: a bare ADVANCE receipt of any size used to open
  // dispatch. It no longer can — the gate is arithmetic over the order
  // total (advanceStatus), so a source that says nothing about the advance
  // fails closed rather than guessing from a list of receipts.
  assert.equal(stageFactsOf({ approvedAt: null }).advanceReceived, false);
  assert.equal(stageFactsOf({ advance: null }).advanceReceived, false);
  assert.equal(stageFactsOf({ advance: { satisfied: null } }).advanceReceived, false);
});

test("the strip's reasons: the three gates refuse with a named reason, and nothing else is gated", () => {
  const bare = stageFactsOf({ stockCheckedAt: null, approvedAt: null, holds: [], advance: { satisfied: false } });
  const pi = canEnter("CONFIRMED", "PI_ISSUED", bare);
  assert.equal(pi.ok, false);
  assert.match((pi as { reason: string }).reason, /Stock check first/);
  const inv = canEnter("READY", "INVOICED", bare);
  assert.equal(inv.ok, false);
  assert.match((inv as { reason: string }).reason, /approved before the final invoice/);
  const disp = canEnter("INVOICED", "DISPATCHED", bare);
  assert.equal(disp.ok, false);
  assert.match((disp as { reason: string }).reason, /advance has not been received/);
  // packing, the dispatch check and readiness happen before the money (answer 2)
  for (const to of ["CONFIRMED", "STOCK_CHECKED", "PACKING", "DISPATCH_CHECK", "READY", "CLOSED"]) {
    assert.equal(canEnter("DRAFT", to, bare).ok, true, `${to} is not gated`);
  }
  const full = stageFactsOf({ stockCheckedAt: "2026-09-01T00:00:00.000Z", approvedAt: "2026-09-02T00:00:00.000Z", holds: [{ status: "ACTIVE" }], advance: { satisfied: true } });
  assert.equal(canEnter("CONFIRMED", "PI_ISSUED", full).ok, true);
  assert.equal(canEnter("READY", "INVOICED", full).ok, true);
  assert.equal(canEnter("INVOICED", "DISPATCHED", full).ok, true);
  // cancelling is never gated on a fact — only on who asks (answer 24, the route's commercialGate("cancel"))
  assert.equal(canEnter("PACKING", "CANCELLED", bare).ok, true);
});

// ───────────────────────── the advance gate's own total ──────────────────────
// There is no total column on an order: the figure the advance percentage is
// taken of is orderTotals(items).amount, and BOTH sides must use it — the
// server (loadStageFacts, the order detail, the dispatch route) and the card.
// This test is here rather than in the receipts file because it is the join
// between the two modules that can silently drift.

test("the advance is a share of orderTotals(items).amount, and the two modules agree on that figure (round two, answer 11)", () => {
  const items = [
    { qtySlabs: 20, qty: 1200, uom: "SQFT", amount: 24000, isSample: false },
    { qtySlabs: 5, qty: 300, uom: "SQFT", amount: 6000, isSample: false },
    { qtySlabs: 1, qty: 1, uom: "NOS", amount: null, isSample: true },   // a free sample prices nothing
  ];
  const total = orderTotals(items).amount;
  assert.equal(total, 30000);

  const pct = effectiveAdvancePct(null, "EXPORT", { domestic: 100, export: 30 });
  const short = advanceStatus({ receipts: [{ kind: "ADVANCE", amount: 3000, currency: "USD" }], orderTotal: total, currency: "USD", advancePct: pct });
  assert.equal(short.required, 9000, "30% of the summed line amounts");
  assert.equal(short.satisfied, false);
  assert.match(short.reason ?? "", /USD 30,000\.00/, "the refusal names the same total the items tab shows");

  // an order with lines but no prices is not a priced order, and the gate says so
  const unpriced = orderTotals([{ qtySlabs: 20, qty: 1200, uom: "SQFT", amount: null, isSample: false }]).amount;
  assert.equal(unpriced, 0);
  assert.equal(advanceStatus({ receipts: [], orderTotal: unpriced, currency: "USD", advancePct: pct }).satisfied, false);

  // a DOMESTIC order asks for the whole of it (the terms on file read "100% Advance Payment")
  const dom = effectiveAdvancePct(null, "DOMESTIC", { domestic: 100, export: 30 });
  const paid = advanceStatus({ receipts: [{ kind: "ADVANCE", amount: 30000, currency: "INR" }], orderTotal: total, currency: "INR", advancePct: dom });
  assert.equal(paid.required, 30000);
  assert.equal(paid.satisfied, true);
});

test("the header edit that lowers the advance is the same act as a waiver, and PATCH asks the same desk (answers 11, 12)", () => {
  // The join: changedFields decides that advancePct moved, advancePctChange
  // decides whether a write-level login may move it that way, and advanceStatus
  // shows what the move would have done to the truck. PATCH …/orders/[id]
  // composes exactly these three, so they are checked together here.
  const d = { domestic: 100, export: 30 };
  const order = { kind: "EXPORT", advancePct: 30, currency: "USD" };
  const items = [{ qtySlabs: 20, qty: 1200, uom: "SQFT", amount: 30000, isSample: false }];
  const total = orderTotals(items).amount;
  const receipts = [{ kind: "ADVANCE", amount: 0, currency: "USD" }];

  const before = advanceStatus({ receipts, orderTotal: total, currency: "USD", advancePct: effectiveAdvancePct(order.advancePct, order.kind, d) });
  assert.equal(before.satisfied, false, "USD 9,000 is asked and nothing has arrived");

  // what the clerk typed: 0 in the header box. It is a change …
  assert.deepEqual(changedFields(order, { advancePct: 0 }), ["advancePct"]);
  // … and it is the change that takes the manager
  const move = advancePctChange(
    effectiveAdvancePct(order.advancePct, order.kind, d),
    effectiveAdvancePct(0, order.kind, d),
  );
  assert.equal(move.ok, false, "a write-level login gets this sentence as a 403");
  // because had it landed, the gate would have opened with no money in
  const after = advanceStatus({ receipts, orderTotal: total, currency: "USD", advancePct: effectiveAdvancePct(0, order.kind, d) });
  assert.equal(after.satisfied, true);
  assert.equal(after.receivedAdvance, 0, "and not one rupee more would have arrived");

  // raising it is an ordinary edit and stays one
  assert.deepEqual(advancePctChange(effectiveAdvancePct(order.advancePct, order.kind, d), effectiveAdvancePct(50, order.kind, d)), { ok: true });
  // a PATCH that does not name advancePct at all never reaches the question
  assert.deepEqual(changedFields(order, { incoterm: "FOB" }), ["incoterm"]);
});

// ───────────────────────── the workspace's own state ─────────────────────────
// OrderWorkspace fetches the order once and hands it to whichever tab is open.
// refresh() re-reads after every write and whenever a tab asks. What the
// screen must NOT do is throw the workspace away when one of those reads
// fails: the open tab is unmounted with it, and the PI tab's draft edit or the
// items tab's half-typed line goes with it — over a background 500 the user
// never asked for.

test("orderWorkspaceView: a failed refresh keeps the last good order, the open tab and the draft on screen", () => {
  const order = { id: "o1", number: "SAL-ORD/26-27/01642" };

  // first read in flight: nothing to show, nothing wrong
  assert.deepEqual(orderWorkspaceView({ order: null, error: null }), { showWorkspace: false, fatal: null, stale: null, loading: true });
  assert.deepEqual(orderWorkspaceView({ order: null }), { showWorkspace: false, fatal: null, stale: null, loading: true });

  // first read failed: there is nothing to show, so the message owns the page
  assert.deepEqual(orderWorkspaceView({ order: null, error: "Could not read this order." }), {
    showWorkspace: false, fatal: "Could not read this order.", stale: null, loading: false,
  });

  // loaded and healthy
  assert.deepEqual(orderWorkspaceView({ order, error: null }), { showWorkspace: true, fatal: null, stale: null, loading: false });

  // THE ONE THAT MATTERS: a refresh failed after the order had loaded
  const stale = orderWorkspaceView({ order, error: "Session expired" });
  assert.equal(stale.showWorkspace, true, "the workspace stays mounted, so the open tab keeps its unsaved draft");
  assert.equal(stale.fatal, null, "a failed refresh never takes over the page");
  assert.equal(stale.stale, "Session expired", "but the failure is shown, not swallowed");
  assert.equal(stale.loading, false);

  // and it recovers: the next good read clears the banner without remounting
  assert.deepEqual(orderWorkspaceView({ order, error: null }), { showWorkspace: true, fatal: null, stale: null, loading: false });

  // a blank message is no message
  assert.deepEqual(orderWorkspaceView({ order, error: "   " }), { showWorkspace: true, fatal: null, stale: null, loading: false });
  assert.equal(orderWorkspaceView({ order: null, error: "  " }).loading, true, "a blank error is not a reason to stop waiting");
});
