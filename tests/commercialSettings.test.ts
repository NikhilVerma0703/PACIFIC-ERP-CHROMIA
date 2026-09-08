// Commercial settings rules, RUN against real values: the whitelist walk that
// every settings write passes through, what actually gets stored, which paths
// differ from the defaults, whether a counter may be moved, and what number
// each document kind would take today.
//
// The module under test imports only the other pure halves (settings-defaults,
// numbering, tax), so node --test loads it bare — no Next, no Prisma, no auth.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateOverrides, leafIssue, pruneDefaults, diffFromDefaults, leafPaths, getAt, setAt,
  sequenceChange, previewCounters, pageArgs, NUMBERING_LABELS,
} from "../src/lib/commercial/settings-rules.ts";
import { DEFAULT_SETTINGS, mergeSettings, NUMBERING_KINDS } from "../src/lib/commercial/settings-defaults.ts";

const errorAt = (v: { errors: Array<{ path: string; message: string }> }, path: string): string | null =>
  v.errors.find((e) => e.path === path)?.message ?? null;

// ───────────────────────── the walk: coercion and whitelist ──────────────────
test("validateOverrides coerces the strings a form sends and keeps the leaves it was given", () => {
  const v = validateOverrides({
    holdDays: "7",
    piValidityDays: 45,
    tax: { igstRate: "12.5" },
    notify: { telegram: "true", mail: false },
  });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.cleaned, {
    holdDays: 7,
    piValidityDays: 45,
    tax: { igstRate: 12.5 },
    notify: { telegram: true, mail: false },
  });
  // and the cleaned object is what the merge takes
  const merged = mergeSettings(DEFAULT_SETTINGS, v.cleaned);
  assert.equal(merged.holdDays, 7);
  assert.equal(merged.tax.igstRate, 12.5);
  assert.equal(merged.tax.cgstRate, DEFAULT_SETTINGS.tax.cgstRate, "untouched leaves keep following the default");
  assert.equal(merged.notify.telegram, true);
});

test("keys the defaults do not know are dropped, not stored and not an error", () => {
  const v = validateOverrides({ holdDays: 6, nonsense: 1, company: { legalName: "X Ltd", secretRate: 9 }, banks: { swiss: { name: "N" } } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.cleaned, { holdDays: 6, company: { legalName: "X Ltd" }, banks: {} });
  assert.deepEqual(v.dropped.sort(), ["banks.swiss", "company.secretRate", "nonsense"]);
});

test("a null override means 'no override here' rather than a blanked field", () => {
  const v = validateOverrides({ holdDays: null, company: { legalName: undefined } });
  assert.equal(v.ok, true);
  assert.deepEqual(v.cleaned, { company: {} });
  assert.equal(mergeSettings(DEFAULT_SETTINGS, v.cleaned).holdDays, DEFAULT_SETTINGS.holdDays);
});

test("a scalar where a group belongs, and text where a number belongs, are refused", () => {
  const v = validateOverrides({ company: "Pacific", holdDays: "soon" });
  assert.equal(v.ok, false);
  assert.equal(errorAt(v, "company"), "Expected a group of settings");
  assert.equal(errorAt(v, "holdDays"), "Must be a number");
  assert.equal(v.cleaned.holdDays, undefined, "an invalid leaf is not carried into cleaned");
});

// ───────────────────────── hold days and PI validity ─────────────────────────
test("holdDays is a whole number of 1..60 days", () => {
  assert.equal(leafIssue("holdDays", 5), null);
  assert.equal(leafIssue("holdDays", 1), null);
  assert.equal(leafIssue("holdDays", 60), null);
  assert.equal(leafIssue("holdDays", 0), "Hold days must be between 1 and 60");
  assert.equal(leafIssue("holdDays", 61), "Hold days must be between 1 and 60");
  assert.equal(leafIssue("holdDays", 5.5), "Hold days must be a whole number");
  assert.equal(errorAt(validateOverrides({ holdDays: 0 }), "holdDays"), "Hold days must be between 1 and 60");
});

test("piValidityDays is a whole number of 0..365 days, 0 being forever (answer 24)", () => {
  assert.equal(leafIssue("piValidityDays", 30), null);
  assert.equal(leafIssue("piValidityDays", 365), null);
  assert.equal(leafIssue("piValidityDays", 0), null, "0 = the PI never expires, the shipped default");
  assert.equal(leafIssue("piValidityDays", 366), "PI validity must be between 0 and 365");
  assert.equal(leafIssue("piValidityDays", -1), "PI validity must be between 0 and 365");
  assert.equal(leafIssue("piValidityDays", 30.5), "PI validity must be a whole number");
});

test("the new leaves: the unit, the cleaning hours and the alternate GSTIN lines", () => {
  assert.equal(leafIssue("measurementUnitDefault", "cm"), null);
  assert.equal(leafIssue("measurementUnitDefault", "in"), null);
  assert.equal(leafIssue("measurementUnitDefault", "mm"), "The unit is cm or in");
  assert.equal(leafIssue("planning.cleaningHoursDefault", 3), null);
  assert.equal(leafIssue("planning.cleaningHoursAbrupt", 6), null);
  assert.equal(leafIssue("planning.cleaningHoursAbrupt", 49), "Cleaning hours must be between 0 and 48");
  assert.equal(leafIssue("company.alternateGstins", ["Pacific Granites (India) Pvt Ltd | 33AAFCP5374A1ZQ"]), null);
  assert.equal(leafIssue("company.alternateGstins", ["33AAFCP5374A1ZQ"]), null, "a bare GSTIN is a line too");
  const bad = leafIssue("company.alternateGstins", ["Sister company | not a gstin"]);
  assert.ok(bad && bad.includes("Sister company"), bad ?? "expected the bad line named");
  // and the whole shipped shape passes through its own validator
  const v = validateOverrides(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(pruneDefaults(v.cleaned), {}, "nothing in the defaults differs from the defaults");
  // a shorter dark-to-light cleaning than the ordinary one is a warning, not a refusal
  const w = validateOverrides({ planning: { cleaningHoursAbrupt: 2 } });
  assert.equal(w.ok, true);
  assert.equal(w.warnings.length, 1);
  assert.equal(w.warnings[0].path, "planning.cleaningHoursAbrupt");
});

// ───────────────────────── numbering ─────────────────────────────────────────
test("a numbering template must carry {seq}, padded or not", () => {
  assert.equal(leafIssue("numbering.order.template", "SAL-ORD/{fy}/{seq:5}"), null);
  assert.equal(leafIssue("numbering.challan.template", "PESPL/DC/{seq}/{yy}"), null);
  const noSeq = leafIssue("numbering.order.template", "SAL-ORD/{fy}");
  assert.ok(noSeq && noSeq.includes("{seq}"), noSeq ?? "expected a message naming {seq}");
  assert.equal(leafIssue("numbering.order.template", ""), "Template is required");
  const v = validateOverrides({ numbering: { exportInvoice: { template: "PESPL/{fy}" } } });
  assert.equal(v.ok, false);
  assert.ok(errorAt(v, "numbering.exportInvoice.template"));
});

test("a counter key cannot carry the ':' that separates the financial year, nor spaces", () => {
  assert.equal(leafIssue("numbering.order.key", "SAL-ORD"), null);
  assert.ok(leafIssue("numbering.order.key", "SAL-ORD:26-27"));
  assert.ok(leafIssue("numbering.order.key", "SAL ORD"));
  assert.equal(leafIssue("numbering.order.key", ""), "Counter key is required");
});

test("two document kinds may not share one counter key", () => {
  const v = validateOverrides({ numbering: { dtaInvoice: { key: "PESPL-EXP" } } });
  assert.equal(v.ok, false);
  const msg = errorAt(v, "numbering.dtaInvoice.key");
  assert.ok(msg && msg.includes("PESPL-EXP"), msg ?? "expected the shared key named");
  assert.ok(msg && msg.includes(NUMBERING_LABELS.exportInvoice), "the other kind is named so the admin knows what clashed");
  assert.equal(validateOverrides({}).ok, true, "the shipped defaults do not clash with themselves");
});

test("perFy is a switch and takes the things a checkbox posts", () => {
  const v = validateOverrides({ numbering: { exportInvoice: { perFy: "on" }, order: { perFy: false } } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal((v.cleaned as { numbering: { exportInvoice: { perFy: boolean } } }).numbering.exportInvoice.perFy, true);
  const bad = validateOverrides({ numbering: { order: { perFy: "maybe" } } });
  assert.equal(bad.ok, false);
  assert.equal(errorAt(bad, "numbering.order.perFy"), "Must be on or off");
});

// ───────────────────────── company master ────────────────────────────────────
test("GSTIN is checked for shape and upper-cased, a PAN in the box is refused", () => {
  const v = validateOverrides({ company: { gstin: "33aalcp2750n1z3" } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal((v.cleaned as { company: { gstin: string } }).company.gstin, "33AALCP2750N1Z3", "lower case is corrected, not refused");
  const bad = validateOverrides({ company: { gstin: "AALCP2750N" } });
  assert.equal(bad.ok, false);
  assert.ok(errorAt(bad, "company.gstin"));
  assert.ok(errorAt(validateOverrides({ company: { gstin: "9876543210" } }), "company.gstin"), "a phone number is not a GSTIN");
});

test("state codes are two digits, PAN has its shape, HSN is 4..8 digits, email is an email", () => {
  assert.equal(leafIssue("company.stateCode", "33"), null);
  assert.ok(leafIssue("company.stateCode", "TN"));
  assert.ok(leafIssue("tax.supplierStateCode", "331"));
  assert.equal(leafIssue("company.pan", "AALCP2750N"), null);
  assert.ok(leafIssue("company.pan", "AALCP2750"));
  assert.equal(leafIssue("company.pan", ""), null, "an unset PAN is allowed; a wrong one is not");
  assert.equal(leafIssue("company.hsnQuartz", "68101990"), null);
  assert.ok(leafIssue("company.hsnStand", "73O89050"), "a letter in an HSN is a typo");
  assert.equal(leafIssue("company.email", "customs@pacific-surfaces.com"), null);
  assert.ok(leafIssue("company.email", "customs at pacific"));
});

test("the names and the address that print on every document cannot be blanked", () => {
  assert.equal(errorAt(validateOverrides({ company: { legalName: "  " } }), "company.legalName"), "The legal name prints on every document");
  assert.ok(errorAt(validateOverrides({ company: { shortName: "" } }), "company.shortName"));
  assert.equal(errorAt(validateOverrides({ company: { addressLines: [] } }), "company.addressLines"), "At least one address line");
  assert.ok(errorAt(validateOverrides({ company: { addressLines: "\n \n" } }), "company.addressLines"), "a textarea of blank lines is still empty");
});

test("a list of lines arrives as an array or as one textarea string, blank lines dropped", () => {
  const v = validateOverrides({ company: { addressLines: "Plot 12, Hosur\n\n  Tamil Nadu 635 117  \n" } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual((v.cleaned as { company: { addressLines: string[] } }).company.addressLines, ["Plot 12, Hosur", "Tamil Nadu 635 117"]);
  const arr = validateOverrides({ company: { addressLines: ["A", " B "] } });
  assert.deepEqual((arr.cleaned as { company: { addressLines: string[] } }).company.addressLines, ["A", "B"]);
  const bad = validateOverrides({ company: { addressLines: 12 } });
  assert.equal(errorAt(bad, "company.addressLines"), "Expected a list of lines");
});

// ───────────────────────── banks ─────────────────────────────────────────────
test("bank codes are checked for shape and upper-cased; the name and the account cannot be blank", () => {
  const v = validateOverrides({ banks: { domestic: { ifsc: "icic0000204", swift: "icicinbbcts" } } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const d = (v.cleaned as { banks: { domestic: { ifsc: string; swift: string } } }).banks.domestic;
  assert.equal(d.ifsc, "ICIC0000204");
  assert.equal(d.swift, "ICICINBBCTS");
  assert.ok(errorAt(validateOverrides({ banks: { export: { ifsc: "KKBK422" } } }), "banks.export.ifsc"));
  assert.ok(errorAt(validateOverrides({ banks: { export: { swift: "KKBK" } } }), "banks.export.swift"));
  assert.ok(errorAt(validateOverrides({ banks: { export: { accountNo: "" } } }), "banks.export.accountNo"));
  assert.ok(errorAt(validateOverrides({ banks: { domestic: { name: "  " } } }), "banks.domestic.name"));
  assert.equal(leafIssue("banks.export.routingSwift", "IRVTUS3NXXX"), null);
});

test("the domestic bank has no AD code or routing bank in the defaults, so those keys are dropped", () => {
  const v = validateOverrides({ banks: { domestic: { adCode: "0180038-8400009" } } });
  assert.equal(v.ok, true);
  assert.deepEqual(v.dropped, ["banks.domestic.adCode"]);
  assert.equal(leafIssue("banks.export.adCode", "0180038-8400009"), null, "the export bank does carry one");
});

// ───────────────────────── tax and notifications ─────────────────────────────
test("tax rates are numbers between 0 and 100", () => {
  assert.equal(leafIssue("tax.igstRate", 18), null);
  assert.equal(leafIssue("tax.igstRate", 0), null);
  assert.equal(leafIssue("tax.cgstRate", 9.5), null, "a fractional rate is legal, unlike a fractional hold");
  assert.equal(leafIssue("tax.igstRate", 140), "IGST rate must be between 0 and 100");
  assert.equal(leafIssue("tax.sgstRate", -1), "SGST rate must be between 0 and 100");
  assert.ok(errorAt(validateOverrides({ tax: { igstRate: "eighteen" } }), "tax.igstRate"));
});

test("CGST + SGST that does not add up to IGST is a warning, not a refusal", () => {
  const v = validateOverrides({ tax: { cgstRate: 6, sgstRate: 6 } });
  assert.equal(v.ok, true, "the admin may be mid-edit; the invoice is what would differ");
  assert.equal(v.errors.length, 0);
  assert.equal(v.warnings.length, 1);
  assert.equal(v.warnings[0].path, "tax.cgstRate");
  assert.equal(validateOverrides({ tax: { igstRate: 12, cgstRate: 6, sgstRate: 6 } }).warnings.length, 0);
  assert.equal(validateOverrides({}).warnings.length, 0, "the shipped defaults add up");
});

test("mail recipients are email addresses, and mail cannot be on with nobody to tell", () => {
  const v = validateOverrides({ notify: { mail: true, mailTo: "ops@pacific-surfaces.com\nmurali@pacific-surfaces.com" } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual((v.cleaned as { notify: { mailTo: string[] } }).notify.mailTo, ["ops@pacific-surfaces.com", "murali@pacific-surfaces.com"]);
  const bad = validateOverrides({ notify: { mailTo: ["ops@pacific-surfaces.com", "murali at pacific"] } });
  assert.equal(bad.ok, false);
  assert.ok((errorAt(bad, "notify.mailTo") ?? "").includes("murali at pacific"));
  // mail ships ON with the owner as recipient (answer 13), so "nobody" has to be said
  const empty = validateOverrides({ notify: { mail: true, mailTo: [] } });
  assert.equal(empty.ok, false);
  assert.ok((errorAt(empty, "notify.mailTo") ?? "").includes("nobody"));
  assert.equal(validateOverrides({ notify: { mail: false, mailTo: [] } }).ok, true, "off with nobody is fine");
});

// ───────────────────────── what gets stored ──────────────────────────────────
test("pruneDefaults keeps only what really differs, so a default that moves still reaches an untouched field", () => {
  const cleaned = validateOverrides({
    holdDays: DEFAULT_SETTINGS.holdDays,                       // typed, but equal to the default
    piValidityDays: 45,
    company: { legalName: DEFAULT_SETTINGS.company.legalName, phone: "+91 90000 00000" },
    banks: { domestic: { name: DEFAULT_SETTINGS.banks.domestic.name } },
  }).cleaned;
  assert.deepEqual(pruneDefaults(cleaned), { piValidityDays: 45, company: { phone: "+91 90000 00000" } });
});

test("pruneDefaults compares an address block whole", () => {
  const same = pruneDefaults({ company: { addressLines: [...DEFAULT_SETTINGS.company.addressLines] } });
  assert.deepEqual(same, {});
  const changed = pruneDefaults({ company: { addressLines: ["One line only"] } });
  assert.deepEqual(changed, { company: { addressLines: ["One line only"] } });
});

test("a whole settings view sent back unchanged stores nothing at all", () => {
  const v = validateOverrides(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.dropped, []);
  assert.deepEqual(pruneDefaults(v.cleaned), {}, "the screen posts the whole object; only edits become overrides");
});

// ───────────────────────── what the screen marks ─────────────────────────────
test("diffFromDefaults names the changed paths, and nothing else", () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { holdDays: 10, company: { phone: "+91 1" }, notify: { mailTo: ["a@b.co"] } });
  assert.deepEqual(diffFromDefaults(merged).sort(), ["company.phone", "holdDays", "notify.mailTo"]);
  assert.deepEqual(diffFromDefaults(DEFAULT_SETTINGS), []);
});

test("the loose diff is what the screen marks: a typed '5' is not a change, a typed 6 is", () => {
  // A form holds text. Strictly, "5" ≠ 5 and every number the admin has merely
  // clicked into would light up as changed; loosely, only a real edit does.
  const draft = setAt(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>, "holdDays", "5");
  assert.deepEqual(diffFromDefaults(draft, DEFAULT_SETTINGS, true), []);
  assert.deepEqual(diffFromDefaults(draft), ["holdDays"], "and the strict form still sees the type change");
  assert.deepEqual(diffFromDefaults(setAt(draft, "holdDays", "6"), DEFAULT_SETTINGS, true), ["holdDays"]);
  // Telegram ships OFF (round two, answer 5: "let's leave Telegram for now"),
  // so "off" is no change and switching it on is one.
  assert.deepEqual(diffFromDefaults(setAt(draft, "notify.telegram", "off"), DEFAULT_SETTINGS, true), []);
  assert.deepEqual(diffFromDefaults(setAt(draft, "notify.telegram", "on"), DEFAULT_SETTINGS, true), ["notify.telegram"]);
  // pressing Enter in the address textarea leaves a blank line the walk drops
  const typing = setAt(draft, "company.addressLines", [...DEFAULT_SETTINGS.company.addressLines, ""]);
  assert.deepEqual(diffFromDefaults(typing, DEFAULT_SETTINGS, true), []);
  assert.deepEqual(diffFromDefaults(setAt(draft, "company.addressLines", ["One"]), DEFAULT_SETTINGS, true), ["company.addressLines"]);
});

test("every leaf of the settings shape has a path, including the ones inside numbering and banks", () => {
  const paths = leafPaths();
  for (const p of ["holdDays", "piValidityDays", "numbering.order.template", "numbering.proforma.key", "numbering.challan.perFy", "company.addressLines",
    "company.alternateGstins", "measurementUnitDefault", "planning.cleaningHoursDefault", "planning.cleaningHoursAbrupt", "tax.alwaysIgst", "notify.telegramPrivate", "notify.mailFromCommercialLogin",
    "company.lutText", "banks.export.routingSwift", "banks.domestic.accountNo", "defaults.portOfLoading",
    "texts.piDeclaration", "tax.supplierStateCode", "notify.telegram", "notify.mailTo"]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  for (const p of paths) assert.notEqual(getAt(DEFAULT_SETTINGS, p), undefined, `${p} reads back`);
  for (const kind of NUMBERING_KINDS) assert.ok(NUMBERING_LABELS[kind], `${kind} has a label for the screen`);
});

test("setAt writes a dotted path without touching the object it was given", () => {
  const next = setAt(DEFAULT_SETTINGS as unknown as Record<string, unknown>, "banks.export.accountNo", "999");
  assert.equal(getAt(next, "banks.export.accountNo"), "999");
  assert.equal(DEFAULT_SETTINGS.banks.export.accountNo, "3214292773", "the defaults are not mutated by an edit on screen");
  assert.equal(getAt(next, "banks.export.ifsc"), DEFAULT_SETTINGS.banks.export.ifsc, "siblings survive the copy");
  assert.equal(getAt(next, "banks.domestic.name"), DEFAULT_SETTINGS.banks.domestic.name);
  assert.equal(getAt(DEFAULT_SETTINGS, "banks.export.nothing.here"), undefined);
});

// ───────────────────────── counters ──────────────────────────────────────────
// Raising is the only manual move a counter is meant for (answers 4 and 8):
// every series starts at N1 and a set-by-hand only SKIPS numbers, never
// continues a Tally series — so raising needs no confirmation.
test("a counter may be raised to skip numbers, and set at all when it has no row yet", () => {
  assert.deepEqual(sequenceChange({ key: "PESPL-EXP", nextValue: 2781, current: 1 }), { ok: true, key: "PESPL-EXP", value: 2781 });
  assert.deepEqual(sequenceChange({ key: "PESPL-EXP", nextValue: "2781", current: null }), { ok: true, key: "PESPL-EXP", value: 2781 });
  assert.deepEqual(sequenceChange({ key: "PESPL-EXP", nextValue: 12, current: 12 }), { ok: true, key: "PESPL-EXP", value: 12 }, "setting it where it already is is a no-op, not a clash");
});

test("lowering a counter re-issues printed numbers, so it takes a deliberate confirmation", () => {
  const refused = sequenceChange({ key: "PESPL-DC:26-27", nextValue: 5, current: 21 });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.status, 409);
  assert.ok(refused.ok === false && refused.message.includes("21") && refused.message.includes("5"));
  const forced = sequenceChange({ key: "PESPL-DC:26-27", nextValue: 5, current: 21, force: true });
  assert.deepEqual(forced, { ok: true, key: "PESPL-DC:26-27", value: 5 });
  assert.equal(sequenceChange({ key: "PESPL-DC:26-27", nextValue: 5, current: 21, force: "true" }).ok, true, "the checkbox posts a string");
});

// A SWITCH IS A SECURITY BOUNDARY HERE. `force` is the confirmation that lets
// a counter be set BACKWARDS, over numbers already printed on documents a
// customer holds. It arrives as whatever a form or a curl posts, so every
// value that must read as OFF is pinned: if "false" or "no" ever coerced to
// true, PATCH /settings/sequences { force: "false" } would silently force the
// counter down and the ERP would re-issue live invoice numbers.
test("every value that means OFF is off — a 'false' in the force box does not force a counter down", () => {
  for (const off of [false, 0, "0", "false", "off", "no", ""]) {
    const r = sequenceChange({ key: "PESPL-EXP", nextValue: 5, current: 2781, force: off });
    assert.equal(r.ok, false, `force ${JSON.stringify(off)} must not force`);
    assert.equal(r.ok === false && r.status, 409, `force ${JSON.stringify(off)} must still ask for confirmation`);
  }
  for (const missing of [undefined, null, "maybe", "yes please", 2, {}, []]) {
    const r = sequenceChange({ key: "PESPL-EXP", nextValue: 5, current: 2781, force: missing });
    assert.equal(r.ok, false, `force ${JSON.stringify(missing)} is not a confirmation`);
  }
  for (const on of [true, 1, "1", "true", "on", "yes"]) {
    assert.equal(sequenceChange({ key: "PESPL-EXP", nextValue: 5, current: 2781, force: on }).ok, true, `force ${JSON.stringify(on)} is a confirmation`);
  }
});

test("the same on/off list runs every settings switch: what a checkbox, a select and a curl post", () => {
  const telegram = (v: unknown) => validateOverrides({ notify: { telegram: v } });
  for (const on of [true, 1, "1", "true", "on", "yes"]) {
    const r = telegram(on);
    assert.equal(r.ok, true, `${JSON.stringify(on)}: ${JSON.stringify(r.errors)}`);
    assert.equal((r.cleaned as { notify: { telegram: boolean } }).notify.telegram, true, `${JSON.stringify(on)} is on`);
  }
  for (const off of [false, 0, "0", "false", "off", "no", ""]) {
    const r = telegram(off);
    assert.equal(r.ok, true, `${JSON.stringify(off)}: ${JSON.stringify(r.errors)}`);
    assert.equal((r.cleaned as { notify: { telegram: boolean } }).notify.telegram, false, `${JSON.stringify(off)} is off`);
  }
  // an unreadable switch is refused rather than guessed — mail on with nobody
  // to tell, or a counter forced, are both worse than a 400.
  for (const junk of ["maybe", "sometimes", 2, ["on"], {}]) {
    assert.equal(errorAt(validateOverrides({ notify: { telegram: junk } }), "notify.telegram"), "Must be on or off", JSON.stringify(junk));
  }
  // the same list decides perFy, which chooses the counter a document draws from
  assert.equal((validateOverrides({ numbering: { order: { perFy: "no" } } }).cleaned as { numbering: { order: { perFy: boolean } } }).numbering.order.perFy, false);
  assert.equal((validateOverrides({ numbering: { order: { perFy: "yes" } } }).cleaned as { numbering: { order: { perFy: boolean } } }).numbering.order.perFy, true);
});

test("1 is a legal next value: a new counter starts there and a new financial year resets to it", () => {
  // Answers 4 and 8: a counter is NOT seeded by hand — every series starts at
  // N1 by design and a manual set only SKIPS numbers. So 1 has to stay a legal
  // value: it is where an unset counter already stands and where a per-FY
  // counter lands on the first of April, and typing it back must not be
  // mistaken for a lowering.
  assert.deepEqual(sequenceChange({ key: "PESPL-DTA:27-28", nextValue: 1, current: null }), { ok: true, key: "PESPL-DTA:27-28", value: 1 }, "a per-FY counter's first year starts at 1");
  assert.deepEqual(sequenceChange({ key: "PL", nextValue: "1", current: null }), { ok: true, key: "PL", value: 1 }, "the form posts a string");
  assert.deepEqual(sequenceChange({ key: "PL", nextValue: 1, current: 1 }), { ok: true, key: "PL", value: 1 }, "setting it where it already is is not a lowering");
  // 0 and below are what the message is about
  for (const bad of [0, -1, "0", "-3"]) {
    const r = sequenceChange({ key: "PL", nextValue: bad, current: null });
    assert.equal(r.ok, false, `${String(bad)} should be refused`);
    assert.equal(r.ok === false && r.message, "Next value must be 1 or more");
  }
  // resetting a counter that HAS issued numbers is the 409 that takes force —
  // the value 1 is not the problem, going backwards over printed numbers is.
  const reset = sequenceChange({ key: "PESPL-DTA:26-27", nextValue: 1, current: 1416 });
  assert.equal(reset.ok, false);
  assert.equal(reset.ok === false && reset.status, 409);
  assert.ok(reset.ok === false && reset.message.includes("1416"));
  assert.deepEqual(sequenceChange({ key: "PESPL-DTA:26-27", nextValue: 1, current: 1416, force: true }), { ok: true, key: "PESPL-DTA:26-27", value: 1 });
});

test("a counter value that is not a whole number of 1 or more is refused before it reaches the row", () => {
  for (const bad of [0, -1, 1.5, "abc", null, undefined]) {
    const r = sequenceChange({ key: "K", nextValue: bad, current: null });
    assert.equal(r.ok, false, `${String(bad)} should be refused`);
    assert.equal(r.ok === false && r.status, 400);
  }
  const noKey = sequenceChange({ key: "  ", nextValue: 5, current: null });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.ok === false && noKey.message, "Counter key is required");
});

test("a counter key is checked for shape, and a per-FY key keeps its ':'", () => {
  assert.equal(sequenceChange({ key: "PESPL-DC:26-27", nextValue: 21, current: null }).ok, true);
  assert.equal(sequenceChange({ key: "PESPL-EXP", nextValue: 21, current: null }).ok, true);
  for (const bad of ["a key", "-lead", "drop table", "x".repeat(65), "k/../etc"]) {
    const r = sequenceChange({ key: bad, nextValue: 21, current: null });
    assert.equal(r.ok, false, `${bad} should be refused`);
    assert.equal(r.ok === false && r.status, 400);
  }
});

test("pageArgs: page 1 and 50 a page unless asked, junk falls back, the cap holds", () => {
  assert.deepEqual(pageArgs(null, null), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs("3", "20"), { page: 3, limit: 20, skip: 40, take: 20 });
  assert.deepEqual(pageArgs("0", "-2"), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs("two", "many"), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.equal(pageArgs("1", "9999").limit, 200);
});

test("previewCounters shows what each kind would issue today, per-FY counters under their own key", () => {
  const at = new Date(2026, 8, 6);                       // 6 September 2026 → FY 26-27
  const p = previewCounters(DEFAULT_SETTINGS, [{ key: "PESPL-EXP", nextValue: 2781 }, { key: "PESPL-DC:26-27", nextValue: 21 }], at);
  assert.deepEqual(p.exportInvoice, { key: "PESPL-EXP", next: 2781, preview: "PESPL/N2781" });
  assert.deepEqual(p.challan, { key: "PESPL-DC:26-27", next: 21, preview: "PESPL/DC/N0021/26" });
  assert.deepEqual(p.order, { key: "ORD:26-27", next: 1, preview: "ORD/26-27/N0001" }, "a counter with no row is at 1 — the state the module ships in");
  assert.deepEqual(p.proforma, { key: "SAL-ORD:26-27", next: 1, preview: "SAL-ORD/26-27/N0001" }, "the PI has its own counter (answer 24)");
  assert.equal(p.dtaInvoice.key, "PESPL-DTA:26-27");
  assert.equal(p.enquiry.preview, "ENQ/26-27/N0001");
  assert.equal(p.packingList.preview, "PL/26-27/N0001");
});

test("previewCounters follows an edited template and key, which is what makes the preview live", () => {
  const at = new Date(2026, 8, 6);
  const edited = mergeSettings(DEFAULT_SETTINGS, { numbering: { challan: { key: "DC", template: "DC-{seq:4}/{fy}", perFy: false } } });
  const p = previewCounters(edited, [{ key: "DC", nextValue: 7 }, { key: "PESPL-DC:26-27", nextValue: 21 }], at);
  assert.deepEqual(p.challan, { key: "DC", next: 7, preview: "DC-0007/26-27" });
  const across = previewCounters(DEFAULT_SETTINGS, [{ key: "PESPL-DC:25-26", nextValue: 21 }], new Date(2026, 2, 31));
  assert.equal(across.challan.key, "PESPL-DC:25-26", "31 March is still the old financial year");
  assert.equal(across.challan.preview, "PESPL/DC/N0021/26");
});

// ───────────────────────── what the settings SCREEN posts ────────────────────
// The screen (CommercialSettingsScreen) sends the whole draft back as the
// strings a form holds: a <select> value, a checkbox's "on"/"off", a textarea
// of "Label | GSTIN" lines. These run the rules on exactly those shapes for the
// leaves the 2026-09-07 answers added, so a field that renders cannot post a
// value the route then refuses.
import { gstinChoices } from "../src/lib/commercial/settings-defaults.ts";

test("the unit select posts 'cm' or 'in' and nothing the packing list could not print in", () => {
  for (const unit of ["cm", "in"]) {
    const v = validateOverrides({ measurementUnitDefault: unit });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(mergeSettings(DEFAULT_SETTINGS, v.cleaned).measurementUnitDefault, unit);
  }
  assert.equal(errorAt(validateOverrides({ measurementUnitDefault: "mm" }), "measurementUnitDefault"), "The unit is cm or in");
  // the default is cm (answer 17) so posting it back stores nothing
  assert.deepEqual(pruneDefaults(validateOverrides({ measurementUnitDefault: "cm" }).cleaned), {});
  assert.deepEqual(pruneDefaults(validateOverrides({ measurementUnitDefault: "in" }).cleaned), { measurementUnitDefault: "in" });
});

test("the cleaning hours arrive as typed text and land as numbers, with the abrupt/default warning where the screen shows it", () => {
  const v = validateOverrides({ planning: { cleaningHoursDefault: "3", cleaningHoursAbrupt: "6" } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(pruneDefaults(v.cleaned), {}, "3 and 6 are the shipped values (answer 13)");
  const moved = validateOverrides({ planning: { cleaningHoursDefault: "4", cleaningHoursAbrupt: "8" } });
  assert.deepEqual(pruneDefaults(moved.cleaned), { planning: { cleaningHoursDefault: 4, cleaningHoursAbrupt: 8 } });
  assert.equal(moved.warnings.length, 0);
  // shorter abrupt than ordinary: the route saves and hands the screen a warning under that field
  const odd = validateOverrides({ planning: { cleaningHoursDefault: "5", cleaningHoursAbrupt: "4" } });
  assert.equal(odd.ok, true);
  assert.deepEqual(odd.warnings.map((w) => w.path), ["planning.cleaningHoursAbrupt"]);
  assert.ok(errorAt(validateOverrides({ planning: { cleaningHoursAbrupt: "49" } }), "planning.cleaningHoursAbrupt"));
});

test("the alwaysIgst switch (answer 22) ships on; the screen's 'off' is the only thing that turns CGST + SGST back on", () => {
  assert.equal(DEFAULT_SETTINGS.tax.alwaysIgst, true);
  const off = validateOverrides({ tax: { alwaysIgst: "off" } });
  assert.equal(off.ok, true, JSON.stringify(off.errors));
  assert.deepEqual(pruneDefaults(off.cleaned), { tax: { alwaysIgst: false } });
  assert.deepEqual(pruneDefaults(validateOverrides({ tax: { alwaysIgst: "on" } }).cleaned), {});
  // the loose diff — what lights the "differs from default" dot — agrees
  const draft = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>;
  assert.deepEqual(diffFromDefaults(setAt(draft, "tax.alwaysIgst", false), DEFAULT_SETTINGS, true), ["tax.alwaysIgst"]);
  assert.deepEqual(diffFromDefaults(setAt(draft, "tax.alwaysIgst", true), DEFAULT_SETTINGS, true), []);
});

test("the alternate-GSTIN textarea becomes the dropdown choices, the company GSTIN first and by default (answer 21)", () => {
  const typed = "Pacific Granites (India) Pvt Ltd | 33AAFCP5374A1ZQ\n\n  29ABCDE1234F1Z5  \n";
  const v = validateOverrides({ company: { alternateGstins: typed } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const merged = mergeSettings(DEFAULT_SETTINGS, v.cleaned);
  assert.deepEqual(merged.company.alternateGstins, ["Pacific Granites (India) Pvt Ltd | 33AAFCP5374A1ZQ", "29ABCDE1234F1Z5"]);
  const choices = gstinChoices(merged.company);
  assert.equal(choices[0].gstin, DEFAULT_SETTINGS.company.gstin, "the company's own registration is the default");
  assert.equal(choices[0].label, DEFAULT_SETTINGS.company.legalName);
  assert.deepEqual(choices.slice(1), [
    { label: "Pacific Granites (India) Pvt Ltd", gstin: "33AAFCP5374A1ZQ" },
    { label: "29ABCDE1234F1Z5", gstin: "29ABCDE1234F1Z5" },
  ]);
  // a typo in one line refuses the save and names the line, so the dropdown never offers it
  const bad = validateOverrides({ company: { alternateGstins: "Sister | 33AAFCP5374A1ZQ\nBranch | 33AAFCP5374" } });
  assert.equal(bad.ok, false);
  assert.ok((errorAt(bad, "company.alternateGstins") ?? "").includes("Branch"));
  // an emptied textarea is a legal "no alternates": only the company GSTIN is offered
  const none = validateOverrides({ company: { alternateGstins: "" } });
  assert.equal(none.ok, true, JSON.stringify(none.errors));
  assert.equal(gstinChoices(mergeSettings(DEFAULT_SETTINGS, none.cleaned).company).length, 1);
});

test("the two notify switches (answer 13) ship on and take what a checkbox posts", () => {
  assert.equal(DEFAULT_SETTINGS.notify.telegramPrivate, true);
  assert.equal(DEFAULT_SETTINGS.notify.mailFromCommercialLogin, true);
  const v = validateOverrides({ notify: { telegramPrivate: "off", mailFromCommercialLogin: "on" } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(pruneDefaults(v.cleaned), { notify: { telegramPrivate: false } });
  assert.equal(errorAt(validateOverrides({ notify: { mailFromCommercialLogin: "maybe" } }), "notify.mailFromCommercialLogin"), "Must be on or off");
});

test("the counters table lists every kind including the PI, under the label the screen prints", () => {
  // The "All counters" table used to list only rows that exist in
  // commercial_sequence, so a kind that had never issued was absent from the
  // very table an admin reads to find it. The screen now walks NUMBERING_KINDS
  // through previewCounters: every kind is a row whether or not it has issued.
  const at = new Date(2026, 8, 7);
  const p = previewCounters(DEFAULT_SETTINGS, [], at);
  const rows = NUMBERING_KINDS.map((kind) => ({ label: NUMBERING_LABELS[kind], key: p[kind].key, next: p[kind].next, preview: p[kind].preview }));
  assert.equal(rows.length, 7);
  const pi = rows.find((r) => r.label === "Proforma invoice (PI)");
  assert.ok(pi, "the PI has its own row");
  assert.deepEqual(pi, { label: "Proforma invoice (PI)", key: "SAL-ORD:26-27", next: 1, preview: "SAL-ORD/26-27/N0001" });
  assert.equal(new Set(rows.map((r) => r.key)).size, 7, "no two kinds draw from one counter");
});

test("the dispatch advance percentages are editable and land as numbers (answer 11)", () => {
  // What the screen ships with: 100% domestic, 30% export. Until the Dispatch
  // section existed these two had no field at all, so the shipped figures were
  // the only figures the module could ever ask for.
  assert.equal(DEFAULT_SETTINGS.dispatch.advancePctDomestic, 100);
  assert.equal(DEFAULT_SETTINGS.dispatch.advancePctExport, 30);

  // the shape the number boxes post: strings, both leaves, every save
  const v = validateOverrides({ dispatch: { advancePctDomestic: "100", advancePctExport: "50" } });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.cleaned, { dispatch: { advancePctDomestic: 100, advancePctExport: 50 } });
  assert.deepEqual(pruneDefaults(v.cleaned), { dispatch: { advancePctExport: 50 } }, "the untouched one keeps following the default");
  assert.equal(mergeSettings(DEFAULT_SETTINGS, v.cleaned).dispatch.advancePctExport, 50);

  // 0 is a real answer here — an order kind that asks for nothing up front
  assert.equal(validateOverrides({ dispatch: { advancePctExport: "0" } }).ok, true);
  // and a typo is refused rather than clamped, the same range pctOf keeps
  assert.equal(errorAt(validateOverrides({ dispatch: { advancePctDomestic: "140" } }), "dispatch.advancePctDomestic"), "Advance percentage must be between 0 and 100");
  assert.equal(errorAt(validateOverrides({ dispatch: { advancePctExport: "-5" } }), "dispatch.advancePctExport"), "Advance percentage must be between 0 and 100");
  assert.equal(errorAt(validateOverrides({ dispatch: { advancePctExport: "half" } }), "dispatch.advancePctExport"), "Must be a number");

  // the loose diff is what lights the screen's "differs from default" dot
  const draft = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>;
  assert.deepEqual(diffFromDefaults(setAt(draft, "dispatch.advancePctExport", "30"), DEFAULT_SETTINGS, true), [], "a typed '30' is the default typed back");
  assert.deepEqual(diffFromDefaults(setAt(draft, "dispatch.advancePctExport", "40"), DEFAULT_SETTINGS, true), ["dispatch.advancePctExport"]);
});
