// The enquiry rules, RUN against real values: which status moves are allowed
// and what each one writes, what a header and a line must carry, whether an
// enquiry may become an order, and how its lines and its client's defaults
// turn into the DRAFT order the Convert button creates.
//
// enquiries-rules imports lib/thickness.ts and clients-rules.ts, both pure, so
// node --test loads the lot bare. The checklist prefill is the foundation's
// own module and is exercised here against the draft this area builds, because
// the point of the convert path is that the SOP sheet arrives half-answered.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENQUIRY_STATUSES, OPEN_ENQUIRY_STATUSES, ENQUIRY_SOURCES, isEnquiryStatus, enquiryStatusChange,
  parseWhen, parseEnquiryHeader, hasCounterparty, parseEnquiryItem, parseEnquiryItems, nextLineNo,
  parseOrderKind, defaultOrderKind, convertGuard, mapEnquiryItemsToOrderItems, contactLine,
  buildOrderFromEnquiry, checklistSourceFromDraft, enquiryListWhere, enquiryParty,
  type ClientForOrder, type EnquiryForOrder, type EnquiryLine,
} from "../src/lib/commercial/enquiries-rules.ts";
import { prefillChecklist } from "../src/lib/commercial/checklist.ts";

// ───────────────────────────────── statuses ──────────────────────────────────

test("the five statuses, and which of them count as open", () => {
  assert.deepEqual([...ENQUIRY_STATUSES], ["NEW", "QUOTED", "ORDERED", "LOST", "CLOSED"]);
  assert.deepEqual([...OPEN_ENQUIRY_STATUSES], ["NEW", "QUOTED"]);
  assert.ok(ENQUIRY_SOURCES.includes("EMAIL"), "enquiries arrive by e-mail (owner, 2026-09-05)");
  assert.equal(isEnquiryStatus("QUOTED"), true);
  assert.equal(isEnquiryStatus("quoted"), false);
  assert.equal(isEnquiryStatus(null), false);
});

test("LOST needs a reason; nothing else does", () => {
  const no = enquiryStatusChange("NEW", "LOST");
  assert.equal(no.ok, false);
  assert.match(no.ok === false ? no.reason : "", /why the enquiry was lost/i);
  assert.equal(enquiryStatusChange("NEW", "LOST", { lostReason: "  " }).ok, false);

  const yes = enquiryStatusChange("QUOTED", "LOST", { lostReason: " price " });
  assert.ok(yes.ok);
  assert.deepEqual(yes.ok && yes.patch, { status: "LOST", lostReason: "price" });
});

test("ORDERED is never set by hand, and an ordered enquiry stops moving", () => {
  const byHand = enquiryStatusChange("QUOTED", "ORDERED");
  assert.equal(byHand.ok, false);
  assert.match(byHand.ok === false ? byHand.reason : "", /Convert to order/);

  const after = enquiryStatusChange("ORDERED", "LOST", { lostReason: "changed their mind" });
  assert.equal(after.ok, false);
  assert.equal(after.ok === false && after.status, 409);
  assert.match(after.ok === false ? after.reason : "", /follows the order/);
});

test("reopening clears the lost reason; closing does not need one; a no-op move is refused", () => {
  const back = enquiryStatusChange("LOST", "QUOTED");
  assert.deepEqual(back.ok && back.patch, { status: "QUOTED", lostReason: null });
  assert.deepEqual(enquiryStatusChange("NEW", "CLOSED").ok && enquiryStatusChange("NEW", "CLOSED"), { ok: true, patch: { status: "CLOSED" } });

  const same = enquiryStatusChange("NEW", "NEW");
  assert.equal(same.ok, false);
  assert.match(same.ok === false ? same.reason : "", /Already New/);
  assert.equal(enquiryStatusChange("NEW", "SOLD").ok, false);
});

// ────────────────────────────────── header ──────────────────────────────────

test("parseWhen: a date, a YYYY-MM-DD, an ISO string — or null", () => {
  assert.equal(parseWhen("2026-09-06")?.toISOString(), "2026-09-06T00:00:00.000Z");
  assert.equal(parseWhen("2026-09-06T08:30:00.000Z")?.toISOString(), "2026-09-06T08:30:00.000Z");
  const d = new Date("2026-01-02T03:04:05.000Z");
  assert.equal(parseWhen(d), d);
  assert.equal(parseWhen("not a date"), null);
  assert.equal(parseWhen(""), null);
  assert.equal(parseWhen(new Date("nope")), null);
});

test("create: somebody must be named, source defaults to EMAIL, receivedAt to now", () => {
  const now = new Date("2026-09-06T10:00:00.000Z");
  const nobody = parseEnquiryHeader({ subject: "quartz" }, "create", now);
  assert.equal(nobody.ok, false);
  assert.match(nobody.ok === false ? nobody.error : "", /client or give the prospect/i);

  const r = parseEnquiryHeader({ prospectName: " Stonewright LLC ", subject: " 2cm quartz " }, "create", now);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.data.prospectName, "Stonewright LLC");
  assert.equal(r.data.source, "EMAIL");
  assert.equal((r.data.receivedAt as Date).toISOString(), now.toISOString());
  assert.equal(r.data.clientId, null);

  const withClient = parseEnquiryHeader({ clientId: "c1", source: "phone", receivedAt: "2026-08-01" }, "create", now);
  assert.equal(withClient.ok && withClient.data.source, "PHONE");
  assert.equal(withClient.ok && (withClient.data.receivedAt as Date).toISOString(), "2026-08-01T00:00:00.000Z");
});

test("a contact e-mail that is not an e-mail is refused; a bad received date is refused", () => {
  const bad = parseEnquiryHeader({ clientId: "c1", contactEmail: "not-an-email" }, "create");
  assert.equal(bad.ok, false);
  assert.match(bad.ok === false ? bad.error : "", /is not an e-mail address/);
  assert.equal(parseEnquiryHeader({ clientId: "c1", contactEmail: "buyer@x.example" }, "create").ok, true);

  const badDate = parseEnquiryHeader({ receivedAt: "last Tuesday" }, "patch");
  assert.equal(badDate.ok, false);
  assert.match(badDate.ok === false ? badDate.error : "", /not a date/);
});

test("patch: only the keys the body carries; the counterparty check is the route's", () => {
  const r = parseEnquiryHeader({ subject: "revised" }, "patch");
  assert.ok(r.ok);
  assert.deepEqual(r.ok ? Object.keys(r.data) : [], ["subject"]);

  const detach = parseEnquiryHeader({ clientId: "" }, "patch");
  assert.equal(detach.ok && detach.data.clientId, null);
  assert.equal(hasCounterparty({ clientId: null, prospectName: null }), false);
  assert.equal(hasCounterparty({ clientId: null, prospectName: "  " }), false);
  assert.equal(hasCounterparty({ clientId: "c1", prospectName: null }), true);
  assert.equal(hasCounterparty({ clientId: null, prospectName: "Stonewright" }), true);
});

// ─────────────────────────────────── lines ───────────────────────────────────

test("a line must name the design or the customer's SKU, and thickness is canonical", () => {
  const empty = parseEnquiryItem({ qtySlabs: 4 }, "create");
  assert.equal(empty.ok, false);
  assert.match(empty.ok === false ? empty.error : "", /design or the customer's SKU/);

  const r = parseEnquiryItem({ design: " Carrara Royale ", thickness: "20mm", qtySlabs: "12", qtySqft: "784.8867", finish: "Polish" }, "create");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.data.design, "Carrara Royale");
  assert.equal(r.data.thickness, "2 cm", "stored canonical; the documents print 20mm / 2 CM themselves");
  assert.equal(r.data.qtySlabs, 12);
  assert.equal(r.data.qtySqft, 784.887, "sq ft keeps 3 decimals");
  assert.equal(r.data.customerSku, null);

  assert.equal(parseEnquiryItem({ customerSku: "VGWT10301A" }, "create").ok, true, "the customer's SKU alone is enough");
  assert.equal(parseEnquiryItem({ design: "X", thickness: "" }, "create").ok && (parseEnquiryItem({ design: "X", thickness: "" }, "create") as { data: Record<string, unknown> }).data.thickness, null);
});

test("quantities: slabs are whole and non-negative, sq ft is non-negative, junk is refused", () => {
  assert.equal(parseEnquiryItem({ design: "X", qtySlabs: "4.5" }, "create").ok, false);
  assert.equal(parseEnquiryItem({ design: "X", qtySlabs: -1 }, "create").ok, false);
  assert.equal(parseEnquiryItem({ design: "X", qtySlabs: "many" }, "create").ok, false);
  assert.equal(parseEnquiryItem({ design: "X", qtySqft: -2 }, "create").ok, false);
  assert.equal(parseEnquiryItem({ design: "X", qtySlabs: "" }, "create").ok, true, "a blank quantity is not a bad one");
  const blank = parseEnquiryItem({ design: "X", qtySlabs: "" }, "create");
  assert.equal(blank.ok && blank.data.qtySlabs, null);
  assert.equal(parseEnquiryItem({ design: "X", qtySqft: "1,024.5" }, "create").ok, true, "thousands separators are typed by people");
});

test("junk in the sq ft box is refused, exactly as junk in the slabs box is", () => {
  // Both guards matter for the same reason: what the customer ASKED FOR is the
  // whole content of an enquiry line. If unreadable sq ft fell through to null
  // instead of a 400, the area they asked for would vanish silently and the
  // quote would be built from a line that no longer says how much.
  for (const junk of ["many", "a lot", "12 sqft", "abc", "-", "NaN", {}]) {
    const r = parseEnquiryItem({ design: "X", qtySqft: junk }, "create");
    assert.equal(r.ok, false, `qtySqft ${JSON.stringify(junk)} should be refused`);
    assert.equal(r.ok === false && r.status, 400);
    assert.equal(r.ok === false && r.error, "Sq ft must be a number.");
    // the twin guard, on the same values
    const twin = parseEnquiryItem({ design: "X", qtySlabs: junk }, "create");
    assert.equal(twin.ok, false, `qtySlabs ${JSON.stringify(junk)} should be refused`);
    assert.equal(twin.ok === false && twin.error, "Slabs must be a number.");
  }
  // a patch may not smuggle it in either
  const patched = parseEnquiryItem({ qtySqft: "many" }, "patch");
  assert.equal(patched.ok, false);
  assert.equal(patched.ok === false && patched.error, "Sq ft must be a number.");
  // and the readable ones still land
  const good = parseEnquiryItem({ design: "X", qtySqft: "784.8867" }, "create");
  assert.equal(good.ok && good.data.qtySqft, 784.887);
  const blank = parseEnquiryItem({ design: "X", qtySqft: "" }, "create");
  assert.equal(blank.ok, true, "a blank box is 'not said', not junk");
  assert.equal(blank.ok && blank.data.qtySqft, null);
  const none = parseEnquiryItem({ design: "X", qtySqft: null }, "create");
  assert.equal(none.ok && none.data.qtySqft, null);
});

test("patch on a line touches only what it names", () => {
  const r = parseEnquiryItem({ notes: "same batch please" }, "patch");
  assert.ok(r.ok);
  assert.deepEqual(r.ok ? Object.keys(r.data) : [], ["notes"]);
  assert.equal(parseEnquiryItem({}, "patch").ok, true, "a patch that names nothing is not an error");
});

test("parseEnquiryItems: the whole table, numbered 1..n, and the first bad line stops the save", () => {
  const r = parseEnquiryItems([{ design: "A", thickness: "30mm" }, { customerSku: "B", qtySlabs: 3 }]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => i.lineNo), [1, 2]);
  assert.equal(r.items[0].thickness, "3 cm");

  const bad = parseEnquiryItems([{ design: "A" }, { qtySlabs: 3 }]);
  assert.equal(bad.ok, false);
  assert.match(bad.ok === false ? bad.error : "", /^Line 2: /, "the message names the row the typist has to fix");

  assert.deepEqual(parseEnquiryItems(undefined), { ok: true, items: [] });
  assert.equal(parseEnquiryItems("not a list").ok, false);
});

test("nextLineNo: one past the highest, 1 on an empty list", () => {
  assert.equal(nextLineNo([]), 1);
  assert.equal(nextLineNo([{ lineNo: 1 }, { lineNo: 4 }, { lineNo: 2 }]), 5);
});

// ─────────────────────────────── the conversion ──────────────────────────────

test("parseOrderKind and the kind offered when the body names none", () => {
  assert.equal(parseOrderKind(" export "), "EXPORT");
  assert.equal(parseOrderKind("domestic"), "DOMESTIC");
  assert.equal(parseOrderKind("sample"), null);
  assert.equal(parseOrderKind(undefined), null);

  assert.equal(defaultOrderKind({ country: "India" }), "DOMESTIC");
  assert.equal(defaultOrderKind({ country: " india " }), "DOMESTIC");
  assert.equal(defaultOrderKind({ country: "USA" }), "EXPORT");
  assert.equal(defaultOrderKind({ country: "" }), "EXPORT");
  assert.equal(defaultOrderKind(null), "EXPORT");
});

test("convertGuard: no client is the refusal that has to explain itself", () => {
  const prospect = convertGuard({ status: "NEW", clientId: null, number: "ENQ/26-27/0004" });
  assert.equal(prospect.ok, false);
  assert.equal(prospect.ok === false && prospect.status, 400);
  assert.match(prospect.ok === false ? prospect.reason : "", /Attach a client/);
  assert.match(prospect.ok === false ? prospect.reason : "", /then convert/, "the message is a set of instructions, not a complaint");

  const already = convertGuard({ status: "ORDERED", clientId: "c1", orderId: "o1", number: "ENQ/26-27/0004" }, "SAL-ORD/26-27/01642");
  assert.equal(already.ok === false && already.status, 409);
  assert.match(already.ok === false ? already.reason : "", /already order SAL-ORD\/26-27\/01642/);

  for (const st of ["LOST", "CLOSED"]) {
    const r = convertGuard({ status: st, clientId: "c1", number: "E1" });
    assert.equal(r.ok, false, st);
    assert.equal(r.ok === false && r.status, 409);
    assert.match(r.ok === false ? r.reason : "", /set it back to New/);
  }
  assert.equal(convertGuard({ status: "NEW", clientId: "c1", number: "E1" }).ok, true);
  assert.equal(convertGuard({ status: "QUOTED", clientId: "c1", number: "E1" }).ok, true);
});

test("enquiry lines become order lines: renumbered, canonical, qtySqft as SQFT quantity", () => {
  const lines: EnquiryLine[] = [
    { lineNo: 3, design: " Carrara Royale ", finish: "Polish", thickness: "30mm", qtySlabs: 12, qtySqft: "784.8867", notes: "same batch" },
    { lineNo: 1, customerSku: "VGWT10301A", thickness: "20mm", qtySlabs: 4, qtySqft: 260.5 },
  ];
  const out = mapEnquiryItemsToOrderItems(lines);
  assert.deepEqual(out.map((o) => o.lineNo), [1, 2], "sorted by the enquiry's numbering, then renumbered without gaps");
  assert.equal(out[0].customerSku, "VGWT10301A");
  assert.equal(out[0].thickness, "2 cm");
  assert.equal(out[0].qty, 260.5);
  assert.equal(out[0].uom, "SQFT");
  assert.equal(out[0].design, null);
  assert.equal(out[0].description, "2 cm", "a line with only a SKU still describes its thickness");

  assert.equal(out[1].design, "Carrara Royale");
  assert.equal(out[1].description, "Carrara Royale-Polish-3 cm");
  assert.equal(out[1].qtySlabs, 12);
  assert.equal(out[1].qty, 784.887);
  assert.equal(out[1].notes, "same batch");
  assert.deepEqual(mapEnquiryItemsToOrderItems([]), []);
});

test("contactLine: the enquiry's own contact, else the client's", () => {
  const client = { contactPerson: "Priya", email: "po@jb.example", phone: "+91 20 555" };
  assert.equal(contactLine({ contactName: "Ravi", contactEmail: "ravi@x.example", contactPhone: null }, client), "Ravi · ravi@x.example");
  assert.equal(contactLine({ contactName: null, contactEmail: null, contactPhone: null }, client), "Priya · po@jb.example · +91 20 555");
  assert.equal(contactLine({}, { contactPerson: null, email: null, phone: null }), null);
});

const client: ClientForOrder = {
  id: "c1", name: "JB Homes Pvt Ltd", email: "po@jb.example", phone: "+91 20 555",
  address: "12 MG Road\nShivajinagar", city: "Pune", country: "India", contactPerson: "Priya",
  defaultCurrency: "INR", defaultPaymentTerms: "30 days from invoice", defaultDeliveryTerms: "Ex-Works",
  defaultPortOfDischarge: "Pune",
  commercialExt: {
    customerCode: "IND-012", gstin: "27AAFCP5374A1ZQ", stateCode: "27",
    billingAddress: { name: "JB Homes Pvt Ltd", lines: ["12 MG Road", "Pune 411005"], gstin: "27AAFCP5374A1ZQ", stateCode: "27" },
    shippingAddress: null, notifyParty: null, defaultIncoterm: "Ex-Works", defaultCurrency: null,
  },
};
const enquiry: EnquiryForOrder = {
  id: "e1", number: "ENQ/26-27/0004", clientId: "c1", subject: "2cm quartz for the Baner site",
  contactName: "Ravi", contactEmail: "ravi@jb.example", contactPhone: null,
};

test("buildOrderFromEnquiry: the client's defaults, the ext's winning where it has one", () => {
  const draft = buildOrderFromEnquiry(enquiry, client, "DOMESTIC");
  assert.equal(draft.kind, "DOMESTIC");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.clientId, "c1");
  assert.equal(draft.enquiryId, "e1");
  assert.equal(draft.currency, "INR");
  assert.equal(draft.incoterm, "Ex-Works", "the ext's incoterm — it was set for this module");
  assert.equal(draft.paymentTerms, "30 days from invoice");
  assert.equal(draft.portOfDischarge, "Pune");
  assert.deepEqual(draft.billTo.lines, ["12 MG Road", "Pune 411005"], "the printed block, not the master's address");
  assert.deepEqual(draft.consignee, draft.billTo, "no shipping block on file: the consignee is the bill-to");
  assert.equal(draft.notifyParty, null);
  assert.equal(draft.countryOfDestination, "India");
  assert.equal(draft.customerContact, "Ravi · ravi@jb.example");
  assert.equal(draft.notes, "From enquiry ENQ/26-27/0004: 2cm quartz for the Baner site");
});

test("buildOrderFromEnquiry: no blocks and no currency on file — the master is printed, the kind decides the currency", () => {
  const bare: ClientForOrder = { id: "c9", name: "Stonewright LLC", address: "1 Stone Way", city: "Dallas", country: "USA" };
  const exp = buildOrderFromEnquiry({ id: "e9", number: "ENQ/26-27/0009", clientId: "c9" }, bare, "EXPORT");
  assert.equal(exp.currency, "USD");
  assert.equal(exp.billTo.name, "Stonewright LLC");
  assert.deepEqual(exp.billTo.lines, ["1 Stone Way", "Dallas, USA"]);
  assert.equal(exp.countryOfDestination, "USA");
  assert.equal(exp.incoterm, null);
  assert.equal(exp.customerContact, null);
  assert.equal(exp.notes, "From enquiry ENQ/26-27/0009");

  const dom = buildOrderFromEnquiry({ id: "e9", number: "E9", clientId: "c9" }, { id: "c9", name: "X", country: "" }, "DOMESTIC");
  assert.equal(dom.currency, "INR");
  assert.equal(dom.countryOfDestination, "India");
});

test("the converted order's SOP checklist arrives half-answered, and only where an enquiry can answer", () => {
  const draft = buildOrderFromEnquiry(enquiry, client, "DOMESTIC");
  const items = mapEnquiryItemsToOrderItems([
    { lineNo: 1, design: "Carrara Royale", finish: "Polish", thickness: "20mm", qtySlabs: 12, qtySqft: 784.887 },
  ]);
  const src = checklistSourceFromDraft(draft, items);
  assert.deepEqual(src.billTo, { name: "JB Homes Pvt Ltd" }, "party blocks reduce to the name the sheet prints");
  assert.equal(src.notifyParty, null);
  assert.equal(src.finalDestination, "India");
  assert.equal(src.items?.[0].isSample, false);
  assert.equal(src.items?.[0].rate, null, "an enquiry has no rates");

  const list = prefillChecklist(null, src);
  const by = Object.fromEntries(list.map((i) => [i.key, i]));
  assert.equal(by.itemDescription.ok, true);
  assert.equal(by.itemDescription.value, "Carrara Royale-Polish-2 cm");
  assert.equal(by.uom.value, "SQFT");
  assert.equal(by.quantity.value, "784.887 SQFT (12 slabs)");
  assert.equal(by.incoterm.value, "Ex-Works");
  assert.equal(by.billTo.value, "JB Homes Pvt Ltd");
  assert.equal(by.shipTo.value, "JB Homes Pvt Ltd");
  assert.equal(by.portOfDischarge.value, "Pune");
  assert.equal(by.paymentTerms.value, "30 days from invoice");
  assert.equal(by.customerContact.value, "Ravi · ravi@jb.example");

  // what an enquiry cannot know is left for Commercial, unticked
  for (const k of ["poReference", "evidencePo", "samples", "deliverySchedule", "specialPacking", "forwarder", "receiver", "paymentMode"]) {
    assert.equal(by[k].ok, false, `${k} must stay open`);
    assert.equal(by[k].value, "", `${k} must stay blank`);
  }
  // Points 6 and 7 (Price / Rate, Total Value) stay OPEN AND BLANK on an
  // enquiry-born order: an enquiry carries no rates, and lib/commercial/
  // checklist no longer reports a null rate as the answer "0" (a zero nobody
  // typed is not a confirmation). Recorded here so a change there shows up as
  // a failure rather than a silent difference.
  assert.equal(by.rate.value, "", "a rate nobody has typed is missing, not zero");
  assert.equal(by.rate.ok, false);
  assert.equal(by.totalValue.value, "", "and a total of nothing is not a confirmed total");
  assert.equal(by.totalValue.ok, false);
});

// ─────────────────────────────── list and rows ───────────────────────────────

test("enquiryListWhere: OPEN, one status, a client, and a search over five columns", () => {
  assert.deepEqual(enquiryListWhere({}), {});
  assert.deepEqual(enquiryListWhere({ status: "open" }), { status: { in: ["NEW", "QUOTED"] } });
  assert.deepEqual(enquiryListWhere({ status: "lost" }), { status: "LOST" });
  assert.deepEqual(enquiryListWhere({ status: "banana" }), {}, "an unknown status filters nothing rather than everything");
  assert.deepEqual(enquiryListWhere({ clientId: "c1" }), { clientId: "c1" });

  const w = enquiryListWhere({ q: "baner" }) as { OR: Array<Record<string, unknown>> };
  assert.equal(w.OR.length, 5);
  assert.deepEqual(w.OR[4], { client: { is: { name: { contains: "baner", mode: "insensitive" } } } });
});

test("enquiryParty: the client's name, else the prospect's, else a dash", () => {
  assert.equal(enquiryParty({ client: { name: "JB Homes Pvt Ltd" } }), "JB Homes Pvt Ltd");
  assert.equal(enquiryParty({ client: null, prospectName: "Stonewright LLC" }), "Stonewright LLC");
  assert.equal(enquiryParty({}), "—");
});
