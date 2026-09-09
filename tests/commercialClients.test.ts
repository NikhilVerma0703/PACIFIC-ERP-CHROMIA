// The client rules, RUN against real values: one form body split into the
// sales_clients payload and the commercial_client_ext payload, the GSTIN /
// PAN / state-code checks that decide what is accepted, the duplicate-name
// warning that must never block, the list filter, and the printed party block
// a client with no address blocks on file falls back to.
//
// clients-rules imports only ./tax.ts, which is import-free, so node --test
// loads it bare — no Next, no Prisma, no auth.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_FIELDS, CLIENT_EXT_FIELDS, CLIENT_EXT_PARTY_FIELDS,
  splitLines, normalizeParty, parseCcEmails, parseClientBody,
  nameKey, duplicateNameWarning, clientListWhere, wantsAll, pageParams, partyFromClient,
} from "../src/lib/commercial/clients-rules.ts";

// ───────────────────────────── small parsers ─────────────────────────────────

test("splitLines: a textarea or an array, trimmed, blanks dropped", () => {
  assert.deepEqual(splitLines("No 3, Vandalur Road\r\n\r\n  Kelambakkam  \nChennai"), ["No 3, Vandalur Road", "Kelambakkam", "Chennai"]);
  assert.deepEqual(splitLines(["A ", "", "  ", "B"]), ["A", "B"]);
  assert.deepEqual(splitLines(null), []);
  assert.deepEqual(splitLines(undefined), []);
  assert.deepEqual(splitLines(""), []);
});

test("normalizeParty: object, pasted text, or nothing — a blank block is NULL", () => {
  assert.equal(normalizeParty(null), null);
  assert.equal(normalizeParty(""), null);
  assert.equal(normalizeParty(undefined), null);
  assert.equal(normalizeParty({ name: "", lines: [] }), null, "an empty block must store NULL so the PI's ?? fallback works");
  assert.equal(normalizeParty({ name: "  ", lines: ["", "  "] }), null);

  const pasted = normalizeParty("JB Homes Pvt Ltd\n12 MG Road\nPune 411001");
  assert.deepEqual(pasted, { name: "JB Homes Pvt Ltd", lines: ["12 MG Road", "Pune 411001"] });

  const block = normalizeParty({
    name: " Vicostone USA ", lines: "1 Stone Way\nDallas TX", country: " USA ",
    tel: "", email: "ap@vicostone.example", gstin: "27aafcp5374a1zq", code: "usa-041",
  });
  assert.equal(block?.name, "Vicostone USA");
  assert.deepEqual(block?.lines, ["1 Stone Way", "Dallas TX"]);
  assert.equal(block?.country, "USA");
  assert.equal(block?.tel, null, "a blank field is null, not an empty string");
  assert.equal(block?.gstin, "27AAFCP5374A1ZQ");
  assert.equal(block?.stateCode, "27", "the state code comes off the GSTIN when the form left it blank");
  assert.equal(block?.code, "usa-041", "a party's own code is printed as typed");

  // a block with only lines is still a block
  assert.deepEqual(normalizeParty({ lines: ["c/o the warehouse"] }), {
    name: "", lines: ["c/o the warehouse"], country: null, tel: null, email: null, gstin: null, stateCode: null, code: null,
  });
  // a typed state code is not overwritten by the GSTIN's
  assert.equal(normalizeParty({ name: "X", gstin: "33AALCP2750N1Z3", stateCode: "07" })?.stateCode, "07");
  assert.equal(normalizeParty(42), null);
});

test("parseCcEmails: commas, semicolons, newlines or an array — de-duplicated case-insensitively", () => {
  assert.deepEqual(parseCcEmails("a@x.com, b@x.com; c@x.com\nA@X.COM"), ["a@x.com", "b@x.com", "c@x.com"]);
  assert.deepEqual(parseCcEmails(["  a@x.com ", "a@x.com", "d@x.com"]), ["a@x.com", "d@x.com"]);
  assert.deepEqual(parseCcEmails(""), []);
  assert.deepEqual(parseCcEmails(null), []);
});

// ───────────────────────────── the body split ────────────────────────────────

test("create: name is required, country defaults to \"\" (the column is NOT NULL)", () => {
  const bad = parseClientBody({ email: "x@y.com" }, "create");
  assert.equal(bad.ok, false);
  assert.equal(bad.ok === false && bad.status, 400);
  assert.match(bad.ok === false ? bad.error : "", /name is required/i);

  const r = parseClientBody({ name: "  Pacific Test Co  " }, "create");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.client.name, "Pacific Test Co");
  assert.equal(r.client.country, "", "country is NOT NULL on sales_clients");
  assert.deepEqual(r.client.ccEmails, []);
  assert.equal(r.extTouched, false, "no ext field was given, so no commercial_client_ext row is written");
  for (const k of CLIENT_FIELDS) assert.ok(k in r.client, `create writes every master field, ${k} included`);
  assert.equal(r.client.isActive, undefined, "isActive is patch-only — a new client is active by the column default");
});

test("create: every ext field lands on the ext payload, nothing on the master", () => {
  const r = parseClientBody({
    name: "Vicostone", country: "USA", email: "ap@v.example", ccEmails: "a@x.com;b@x.com",
    customerCode: "usa-041", gstin: "33aalcp2750n1z3", pan: "aalcp2750n", defaultIncoterm: "FOB", notes: "pays on time",
    billingAddress: "Vicostone USA\n1 Stone Way",
  }, "create");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.extTouched, true);
  assert.equal(r.ext.customerCode, "USA-041", "the customer code prints upper-case on the workbook");
  assert.equal(r.ext.gstin, "33AALCP2750N1Z3");
  assert.equal(r.ext.pan, "AALCP2750N");
  assert.equal(r.ext.stateCode, "33", "derived from the GSTIN when blank");
  assert.deepEqual(r.ext.billingAddress, { name: "Vicostone USA", lines: ["1 Stone Way"] });
  assert.equal(r.ext.shippingAddress, null);
  assert.deepEqual(r.client.ccEmails, ["a@x.com", "b@x.com"]);
  for (const k of [...CLIENT_EXT_FIELDS, ...CLIENT_EXT_PARTY_FIELDS]) {
    assert.ok(k in r.ext, `${k} belongs to the ext row`);
    assert.ok(!(k in r.client) || k === "defaultCurrency", `${k} must not be written to sales_clients`);
  }
});

test("a GSTIN that is not a GSTIN is refused, and the message says what one looks like", () => {
  const r = parseClientBody({ name: "X", gstin: "AALCP2750N" }, "create");   // that is a PAN
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.status, 400);
  assert.match(r.ok === false ? r.error : "", /does not look like a GSTIN/);
  assert.match(r.ok === false ? r.error : "", /15 characters/);

  for (const g of ["33AALCP2750N1Z", "9999999999999999", "33AALCP2750N1X3"]) {
    assert.equal(parseClientBody({ name: "X", gstin: g }, "create").ok, false, g);
  }
  assert.equal(parseClientBody({ name: "X", gstin: "33AALCP2750N1Z3" }, "create").ok, true);
  assert.equal(parseClientBody({ name: "X", gstin: "" }, "create").ok, true, "a blank GSTIN is not a bad GSTIN");
});

test("a PAN and a state code are checked the same way", () => {
  assert.equal(parseClientBody({ name: "X", pan: "AALCP2750" }, "create").ok, false);
  assert.equal(parseClientBody({ name: "X", pan: "aalcp2750n" }, "create").ok, true);
  const bad = parseClientBody({ name: "X", stateCode: "TN" }, "create");
  assert.equal(bad.ok, false);
  assert.match(bad.ok === false ? bad.error : "", /two-digit GST state code/);
  const ok = parseClientBody({ name: "X", stateCode: "33" }, "create");
  assert.equal(ok.ok && ok.ext.stateCode, "33");
});

test("patch: only the keys the body carries are written — a partial save cannot blank the rest", () => {
  const r = parseClientBody({ phone: "+91 44 1234" }, "patch");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.client), ["phone"]);
  assert.equal(r.extTouched, false);
  assert.deepEqual(r.ext, {});

  // a key that IS present, set to blank, does blank the column
  const blanked = parseClientBody({ contactPerson: "" }, "patch");
  assert.equal(blanked.ok && blanked.client.contactPerson, null);

  // name may be edited but not blanked
  assert.equal(parseClientBody({ name: "   " }, "patch").ok, false);
  assert.equal(parseClientBody({ name: "New Name" }, "patch").ok, true);

  // country is NOT NULL: a blank becomes ""
  const c = parseClientBody({ country: "" }, "patch");
  assert.equal(c.ok && c.client.country, "");

  // isActive is accepted on a patch and nowhere else
  const off = parseClientBody({ isActive: false }, "patch");
  assert.equal(off.ok && off.client.isActive, false);
  assert.equal(off.ok && off.extTouched, false);

  // touching one ext field marks the ext row for upsert, and only that field
  const ext = parseClientBody({ notes: "GSTIN awaited" }, "patch");
  assert.equal(ext.ok && ext.extTouched, true);
  assert.deepEqual(ext.ok ? Object.keys(ext.ext) : [], ["notes"]);
});

test("patch: a GSTIN typed alone still fills the state code", () => {
  const r = parseClientBody({ gstin: "27aafcp5374a1zq" }, "patch");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.ext.gstin, "27AAFCP5374A1ZQ");
  assert.equal(r.ext.stateCode, "27");
});

// ───────────────────────── the duplicate-name warning ────────────────────────

test("nameKey: trimmed, lower-cased, runs of whitespace collapsed", () => {
  assert.equal(nameKey("  JB   Homes  Pvt  Ltd "), "jb homes pvt ltd");
  assert.equal(nameKey(null), "");
  assert.equal(nameKey(undefined), "");
});

test("a duplicate name warns, never blocks — and never warns about the row being edited", () => {
  const existing = [{ id: "c1", name: "JB Homes Pvt Ltd" }, { id: "c2", name: "Vicostone USA" }];
  assert.equal(duplicateNameWarning("jb homes pvt ltd", existing), "A client named JB Homes Pvt Ltd already exists");
  assert.equal(duplicateNameWarning("  JB   Homes Pvt Ltd", existing), "A client named JB Homes Pvt Ltd already exists");
  assert.equal(duplicateNameWarning("JB Homes", existing), null, "a near miss is not a duplicate");
  assert.equal(duplicateNameWarning("JB Homes Pvt Ltd", existing, "c1"), null, "editing c1 does not warn about c1");
  assert.equal(duplicateNameWarning("JB Homes Pvt Ltd", existing, "c2"), "A client named JB Homes Pvt Ltd already exists");
  assert.equal(duplicateNameWarning("", existing), null);
  assert.equal(duplicateNameWarning("Anything", []), null);
});

// ───────────────────────────── list and paging ───────────────────────────────

test("clientListWhere: active only unless all, q on name / e-mail / customer code", () => {
  assert.deepEqual(clientListWhere({}), { isActive: true });
  assert.deepEqual(clientListWhere({ all: true }), {});
  assert.deepEqual(clientListWhere({ q: "   " }), { isActive: true }, "a blank search is no search");

  const w = clientListWhere({ q: "vico", all: true }) as { OR: Array<Record<string, unknown>> };
  assert.equal(w.OR.length, 3);
  assert.deepEqual(w.OR[0], { name: { contains: "vico", mode: "insensitive" } });
  assert.deepEqual(w.OR[1], { email: { contains: "vico", mode: "insensitive" } });
  assert.deepEqual(w.OR[2], { commercialExt: { is: { customerCode: { contains: "vico", mode: "insensitive" } } } });
});

test("wantsAll: 1 / true / yes / all mean everything, anything else means active only", () => {
  for (const v of ["1", "true", "TRUE", " yes ", "all"]) assert.equal(wantsAll(v), true, String(v));
  for (const v of ["0", "false", "", null, undefined, "no"]) assert.equal(wantsAll(v), false, String(v));
});

test("pageParams: defaults 1 / 50, junk falls back, limit clamped", () => {
  assert.deepEqual(pageParams({}), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageParams({ page: "3", limit: "20" }), { page: 3, limit: 20, skip: 40, take: 20 });
  assert.deepEqual(pageParams({ page: "0", limit: "-4" }), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageParams({ page: "abc", limit: "abc" }), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.equal(pageParams({ limit: "9999" }).limit, 200, "a page cannot ask for the whole master");
});

// ─────────────────────────── the printed fallback ────────────────────────────

test("partyFromClient: the master printed as a party block when no block is on file", () => {
  const p = partyFromClient(
    { name: "JB Homes Pvt Ltd", address: "12 MG Road\nShivajinagar", city: "Pune", country: "India", phone: "+91 20 555", email: "po@jb.example" },
    { gstin: "27AAFCP5374A1ZQ", stateCode: "27", customerCode: "IND-012" },
  );
  assert.equal(p.name, "JB Homes Pvt Ltd");
  assert.deepEqual(p.lines, ["12 MG Road", "Shivajinagar", "Pune, India"]);
  assert.equal(p.country, "India");
  assert.equal(p.tel, "+91 20 555");
  assert.equal(p.gstin, "27AAFCP5374A1ZQ");
  assert.equal(p.stateCode, "27");
  assert.equal(p.code, "IND-012");

  const bare = partyFromClient({ name: "Prospect Ltd", country: "" });
  assert.deepEqual(bare.lines, [], "no address, no city, no country line");
  assert.equal(bare.gstin, null);
  assert.equal(bare.code, null);

  const cityOnly = partyFromClient({ name: "X", city: "Chennai", country: "" });
  assert.deepEqual(cityOnly.lines, ["Chennai"]);
});
