import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  editProblem, pricePatch, draftChanged, toLine, LINE_SOURCE, BATCH_STATIONS,
  floorEditProblem, updatePatch, wireEdit, isUpdate, saverName, SHEET_ITEM_WHERE,
  type DraftShape, type UsageEdit, type UsageUpdate,
} from "../src/lib/consumables/batchUsageRules.ts";
import { MODEL_DEPT } from "../src/lib/consumables/dept.ts";

// The batch consumables sheet is typed by hand by two people and its numbers
// reach a costing. These pin the rules that stand between a slip of the
// keyboard and a rupee figure on a batch.

const STATIONS = new Set(BATCH_STATIONS.map((s) => s.model));
const ok = { station: "Press", itemName: "Gloves", quantity: 4, unit: "PCS" };

test("a line needs an item, a real station and a sane quantity", () => {
  assert.equal(editProblem(ok, STATIONS), null);
  assert.match(editProblem({ ...ok, itemName: "  " }, STATIONS) ?? "", /needs an item name/);
  assert.match(editProblem({ ...ok, station: "Canteen" }, STATIONS) ?? "", /not a station on this batch/);
  // A station that exists in the plant but not on this list is still refused —
  // the sheet groups by these eight and a ninth would be written and never shown.
  assert.match(editProblem({ ...ok, station: "" }, STATIONS) ?? "", /not a station/);
});

test("quantity: zero is allowed, negative is not, and a fat finger is caught", () => {
  // Zero is a real answer — "this station used none of it" is worth recording.
  assert.equal(editProblem({ ...ok, quantity: 0 }, STATIONS), null);
  assert.match(editProblem({ ...ok, quantity: -1 }, STATIONS) ?? "", /not negative/);
  assert.match(editProblem({ ...ok, quantity: Number.NaN }, STATIONS) ?? "", /must be a number/);
  assert.match(editProblem({ ...ok, quantity: 5_000_000 }, STATIONS) ?? "", /typo/);
  // The refusal names the item, so a person with twenty rows knows which one.
  assert.match(editProblem({ ...ok, itemName: "Emery", quantity: -2 }, STATIONS) ?? "", /Emery/);
});

test("price: absent means unpriced, and an absent price is never an error", () => {
  // THE DISTINCTION THAT MATTERS. A blank price box is "nobody has priced this
  // yet", which is the state every line starts in — refusing it would make the
  // pre-filled sheet impossible to save.
  assert.equal(editProblem({ ...ok, unitPrice: null }, STATIONS), null);
  assert.equal(editProblem({ ...ok, unitPrice: undefined }, STATIONS), null);
  assert.equal(editProblem({ ...ok, unitPrice: 0 }, STATIONS), null); // free issue is a price
  assert.match(editProblem({ ...ok, unitPrice: -5 }, STATIONS) ?? "", /not negative/);
  assert.match(editProblem({ ...ok, unitPrice: 20_000_000 }, STATIONS) ?? "", /typo/);
});

test("long text is refused rather than silently cut down", () => {
  assert.match(editProblem({ ...ok, itemName: "x".repeat(81) }, STATIONS) ?? "", /too long/);
  assert.match(editProblem({ ...ok, unit: "x".repeat(13) }, STATIONS) ?? "", /unit .* too long/);
  assert.equal(editProblem({ ...ok, itemName: "x".repeat(80), unit: "x".repeat(12) }, STATIONS), null);
});

test("every station on the sheet has a consumables department to file under", () => {
  // The API writes departmentId from MODEL_DEPT[station]; a station missing
  // from that map would fall back to "Production" and file mixer grease under
  // the wrong heading for ever.
  for (const s of BATCH_STATIONS) {
    assert.ok(MODEL_DEPT[s.model], `${s.model} has no department in MODEL_DEPT`);
  }
  // And the stations are the eight the plant runs, in line order.
  assert.deepEqual(BATCH_STATIONS.map((s) => s.model), [
    "MixerCycle", "Distributor", "Kreos", "Press", "Oven", "Jot", "PolishEntry", "PolishQc",
  ]);
});

test("the two stations that do not name an 'operator' name the right column", () => {
  // Polishing records a calliberator and QC an inspector. Reading `operator`
  // on those two would show a blank name on exactly the stations the sheet is
  // most often filled in for.
  const person = Object.fromEntries(BATCH_STATIONS.map((s) => [s.model, s.person]));
  assert.equal(person.PolishEntry, "calliberator");
  assert.equal(person.PolishQc, "inspector");
  assert.equal(person.Press, "operator");
});

// ---------------------------------------------------------------------------
// Structural guards — what these protect is a PLACE, not a value.

const api = readFileSync(new URL("../src/app/api/office/batch-consumables/route.ts", import.meta.url), "utf8");
const usage = readFileSync(new URL("../src/lib/consumables/batchUsage.ts", import.meta.url), "utf8");
const table = readFileSync(new URL("../src/components/office/BatchConsumablesTable.tsx", import.meta.url), "utf8");

test("the sheet is gated by the same rule as the sign-off buttons beside it", () => {
  // Satya is a LINE_MANAGER and so are people who must not price a batch; what
  // separates them is WEIGHTS_VERIFIER_EMAILS. A role list here would drift
  // from the buttons and hand the sheet to the wrong line managers.
  assert.ok(api.includes("signableSides"), "the route must gate on signableSides");
  assert.ok(
    !/role === "LINE_MANAGER"/.test(api),
    "the route must not test for LINE_MANAGER itself — that is what signableSides is for",
  );
});

test("every line is validated before any line is written", () => {
  const loopAt = api.indexOf("for (const e of edits)");
  const txAt = api.indexOf("$transaction");
  assert.ok(loopAt > 0 && txAt > 0, "both the validation loop and the transaction should exist");
  assert.ok(
    loopAt < txAt,
    "editProblem must run over every line BEFORE the transaction — a half-saved sheet is worse than an unsaved one",
  );
});

test("neither the sheet nor its data layer multiplies quantity by price", () => {
  // The verify screen ships quantities and unit rates, never anything
  // multiplied — totals live behind the admin-only costing gate. A line total
  // here would leak the one figure the whole split exists to withhold.
  for (const [name, src] of [["the sheet", table], ["its data layer", usage]] as const) {
    assert.ok(
      !/unitPrice\s*\*|\*\s*unitPrice|quantity\s*\*\s*(price|unitPrice)/.test(src),
      `${name} must not multiply quantity by price`,
    );
  }
});

test("saving the sheet does not move stock a second time", () => {
  // The floor panel decrements stock as it logs. This sheet is written days
  // later, often over the same lines, so decrementing here would take one drum
  // out of stock twice.
  assert.ok(
    !/currentStock/.test(api),
    "the sign-off sheet must not touch currentStock — the floor panel already did",
  );
});

// ---------------------------------------------------------------------------
// The review's findings, pinned. Every one of these was a live defect on
// 2026-09-04: a price wiped by a colleague's save, a badge that lied about who
// recorded a figure, a deleted line that left its stock decrement behind.

test("pricePatch: an absent price is left alone, and only a SET price is signed", () => {
  const at = new Date("2026-09-04T10:00:00Z");
  // THE BUG THIS EXISTS TO STOP. The sheet used to send every line on every
  // save, and the route wrote unitPrice/pricedBy/pricedAt unconditionally — so
  // Satya prices Gloves, the store incharge saves a sheet opened before that,
  // and Gloves goes back to null with nobody's name on it.
  assert.equal(pricePatch({}, "Thiru", at), null, "no price key = do not touch the price columns");
  // An explicit null is a person clearing the box, and it clears the name too:
  // an author beside an empty figure is worse than no author.
  assert.deepEqual(pricePatch({ unitPrice: null }, "Thiru", at), { unitPrice: null, pricedBy: null, pricedAt: null });
  // A figure carries who put it there and when.
  assert.deepEqual(pricePatch({ unitPrice: 40 }, "Thiru", at), { unitPrice: 40, pricedBy: "Thiru", pricedAt: at });
  // Free issue is a price, not an absence.
  assert.deepEqual(pricePatch({ unitPrice: 0 }, "Satya", at), { unitPrice: 0, pricedBy: "Satya", pricedAt: at });
});

test("draftChanged: an untouched line is never sent, a touched one always is", () => {
  const base = { itemName: "Gloves", quantity: "4", unit: "PCS", unitPrice: "40", operatorName: "Suresh", station: "Press" };
  assert.equal(draftChanged(base, { ...base }), false);
  // Whitespace alone is not a change — a save must not rewrite a line because
  // a cursor passed through it.
  assert.equal(draftChanged({ ...base, itemName: " Gloves " }, base), false);
  for (const k of ["itemName", "quantity", "unit", "unitPrice", "operatorName", "station"] as const) {
    assert.equal(draftChanged({ ...base, [k]: "changed" }, base), true, `${k} must count as a change`);
  }
  // Clearing the price is a change, so it reaches the server as an explicit null.
  assert.equal(draftChanged({ ...base, unitPrice: "" }, base), true);
});

test("fromFloor comes from `source` alone — not from a field both paths write", () => {
  const row = { id: "e1", itemName: "Gloves", quantity: 2, unit: "PCS", date: new Date() };
  // The sheet pre-fills the station's operator on every blank line and sends
  // it, so operatorName says nothing about who recorded the figure.
  assert.equal(toLine({ ...row, source: LINE_SOURCE.floor, operatorName: null }).fromFloor, true);
  assert.equal(toLine({ ...row, source: LINE_SOURCE.signoff, operatorName: "Suresh" }).fromFloor, false);
  // A row from before the column existed is not the floor's, and is not guessed.
  assert.equal(toLine({ ...row, operatorName: "Suresh" }).fromFloor, false);
  assert.equal(LINE_SOURCE.floor, "floor");
  assert.equal(LINE_SOURCE.signoff, "signoff");
});

test("toLine: a price of 0 survives, and a missing one stays missing", () => {
  const row = { id: "e1", itemName: "Gloves", quantity: 2, unit: "PCS", date: new Date("2026-08-01T00:00:00Z") };
  assert.equal(toLine({ ...row, unitPrice: 0 }).unitPrice, 0, "0 is a price, not an absence");
  assert.equal(toLine(row).unitPrice, null);
  assert.equal(toLine({ ...row, pricedAt: new Date("2026-09-01T00:00:00Z") }).pricedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(toLine(row).pricedAt, null);
});

test("an existing line may not be blanked to zero, but a new one may be zero", () => {
  // Number(d.quantity || 0) turned a cleared box into 0. On a floor line that
  // also leaves the store's decrement standing against nothing.
  assert.match(editProblem({ ...ok, id: "e1", quantity: 0 }, STATIONS) ?? "", /type the corrected figure|remove the line/i);
  assert.equal(editProblem({ ...ok, quantity: 0 }, STATIONS), null, "a NEW line at zero records 'none used here'");
});

test("both write paths stamp where the line came from", () => {
  const floor = readFileSync(new URL("../src/lib/consumables/quickLog.ts", import.meta.url), "utf8");
  assert.ok(/source: LINE_SOURCE\.floor/.test(floor), "the machine panel must stamp source=floor");
  assert.ok(/source: LINE_SOURCE\.signoff/.test(api), "the sign-off sheet must stamp source=signoff");
});

test("the route writes the price only when the edit carries one", () => {
  assert.ok(api.includes("pricePatch("), "the route must go through pricePatch");
  assert.ok(
    !/pricedBy: me\.name/.test(api),
    "the route must not stamp pricedBy itself — pricePatch decides whether the price columns are touched at all",
  );
});

test("a line the floor logged cannot be deleted through the sheet", () => {
  // Its quantity is already out of the store's stock; deleting the row leaves
  // that decrement against nothing and no screen can name the shortfall.
  assert.ok(
    api.includes("LINE_SOURCE.floor") && /deletes.*source|source.*deletes/s.test(api),
    "the delete path must refuse rows whose source is the floor",
  );
  const guardAt = api.indexOf("source: LINE_SOURCE.floor");
  const txAt = api.indexOf("$transaction");
  assert.ok(guardAt > 0 && guardAt < txAt, "the guard must run before the transaction");
});

test("the floor panel refuses a line with no batch", () => {
  const floor = readFileSync(new URL("../src/lib/consumables/quickLog.ts", import.meta.url), "utf8");
  assert.ok(
    /if \(!batchKey\) return/.test(floor),
    "a line with no batch appears on no sign-off sheet — it must be refused, not accepted into silence",
  );
});

test("the sheet sends only what changed, and builds each edit through wireEdit", () => {
  assert.ok(table.includes("draftChanged("), "the sheet must diff drafts against what it loaded");
  assert.ok(/\.map\(\(d\) => wireEdit\(/.test(table), "every edit must be built by wireEdit — the per-field rule lives there, not in the component");
  assert.ok(!table.includes("priceTouched"), "the old per-line builder (only the price was per-field) must be gone");
});

// ---------------------------------------------------------------------------
// Dropdown only (owner, 2026-09-04). The rule is pinned on BOTH sides, because
// a rule that lives only in the browser is not a rule: a page open all shift
// offers an item the store has since renamed, and a replayed request carries
// any string.

const panel = readFileSync(new URL("../src/components/ConsumablesQuickLog.tsx", import.meta.url), "utf8");
const floorLog = readFileSync(new URL("../src/lib/consumables/quickLog.ts", import.meta.url), "utf8");

test("the machine-form panel offers the store's list and no way to type a name", () => {
  assert.ok(/<select[^>]*value=\{l\.itemName\}/.test(panel), "the item is picked from a select bound to itemName");
  assert.ok(!/<input[^>]*value=\{l\.itemName\}/.test(panel), "no text input may be bound to itemName");
  assert.ok(!/list=/.test(panel), "no datalist — that is a text box with suggestions");
  assert.ok(!/addConsumableItem|consumables\/items/.test(panel), "the panel must not import an add-item action");
  // The unit is the item's: display, never an input the operator can retype.
  assert.ok(!/<input[^>]*value=\{l\.unit\}/.test(panel), "the unit must not be editable at the machine");
});

test("the server refuses a name that is not on the store's list, before writing anything", () => {
  const refuseAt = floorLog.indexOf("is not on the store's list");
  const txAt = floorLog.indexOf("$transaction");
  assert.ok(refuseAt > 0, "quickLog must refuse an unknown item by name");
  assert.ok(txAt > 0 && refuseAt < txAt, "the refusal must come before the transaction");
  // And what it saves is the stock row's own spelling and unit, not the caller's.
  assert.ok(/itemName: stock\.itemName/.test(floorLog) && /unit: stock\.unit/.test(floorLog),
    "a linked line is saved under the store's spelling and unit");
  // Every saved line is linked, so every saved line decrements — no `if (stockId)` guard left.
  assert.ok(!/if \(stockId\)/.test(floorLog), "there is no unlinked path left to skip the decrement");
});

test("the machine-form picker leaves direct materials out", () => {
  for (const p of ["../src/app/entry/mixer/page.tsx", "../src/app/entry/slab/[model]/page.tsx"]) {
    const src = readFileSync(new URL(p, import.meta.url), "utf8");
    assert.ok(/category: \{ not: "DIRECT_MATERIAL" \}/.test(src), `${p} must not offer resin and grit from a machine form`);
  }
});

// ─── THE FIVE HELPERS THAT CLOSED THE SIGN-OFF SHEET'S REVIEW FINDINGS ────────
// These were added to the import line above by an agent that died before writing
// a test that called any of them. So the rules that stop a floor line being
// renamed, a stale sheet reverting a colleague, a price of ₹0 arriving as "",
// and a blank author on a rupee figure were guarded by nothing. Each is pure,
// so each is RUN here rather than matched as text.

const stations = new Set(["Press", "Oven"]);
// This file reads its three sources individually (lines ~80-82) and has no
// shared reader; the first draft of the last test below called one anyway.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const draft = (o: Partial<DraftShape> = {}): DraftShape =>
  ({ itemName: "Gloves", quantity: "5", unit: "PCS", unitPrice: "", operatorName: "Ravi", station: "Press", ...o });

test("a floor line may not be renamed or change unit — its stock already moved under that item", () => {
  const row = { itemName: "Gloves", unit: "PCS", stockName: "Gloves" };
  assert.ok(floorEditProblem(row, { itemName: "Emery" }), "renaming a floor line must be refused");
  assert.ok(floorEditProblem(row, { unit: "KG" }), "changing a floor line's unit must be refused");
  assert.equal(floorEditProblem(row, { itemName: " gloves " }), null, "the same name in another case is not a change");
  assert.equal(floorEditProblem(row, { unit: "pcs" }), null, "the same unit in another case is not a change");
  assert.equal(floorEditProblem(row, {}), null, "an edit that carries neither field is fine");
  // held to the linked stock row's spelling, not the line's own
  assert.equal(floorEditProblem({ itemName: "gloves", unit: "PCS", stockName: "Gloves" }, { itemName: "GLOVES" }), null);
  // an unlinked floor row is held to its own name
  assert.ok(floorEditProblem({ itemName: "Gloves", unit: "PCS", stockName: null }, { itemName: "Emery" }));
});

test("updatePatch writes ONLY the fields the edit carried — an absent field leaves the column alone", () => {
  const ctx = { fromFloor: false, stockFor: (n: string) => (n.toLowerCase() === "gloves" ? { id: "s1", itemName: "Gloves" } : undefined),
                departmentFor: () => "d1", by: "Thiru", at: new Date("2026-09-05T10:00:00Z") };
  // only the person changed: nothing else may be in the patch
  assert.deepEqual(updatePatch({ id: "x", operatorName: "Satya" }, ctx), { operatorName: "Satya" });
  // only quantity changed: price columns untouched (no unitPrice key at all)
  const q = updatePatch({ id: "x", quantity: 7 }, ctx);
  assert.deepEqual(q, { quantity: 7 });
  assert.ok(!("unitPrice" in q) && !("pricedBy" in q), "a quantity edit must not touch the price or its author");
  // a set price is signed; a cleared price is unsigned
  assert.deepEqual(updatePatch({ id: "x", unitPrice: 40 }, ctx), { unitPrice: 40, pricedBy: "Thiru", pricedAt: ctx.at });
  assert.deepEqual(updatePatch({ id: "x", unitPrice: null }, ctx), { unitPrice: null, pricedBy: null, pricedAt: null });
  // an item typed in another case saves under the stock row's own spelling
  assert.deepEqual(updatePatch({ id: "x", itemName: "gloves" }, ctx), { itemName: "Gloves", inventoryStockId: "s1" });
  // a floor row: item and unit are never rewritten even when carried
  const floor = { ...ctx, fromFloor: true };
  assert.deepEqual(updatePatch({ id: "x", itemName: "Gloves", unit: "PCS", quantity: 9 }, floor), { quantity: 9 });
});

test("wireEdit sends an existing row as id plus ONLY what moved", () => {
  const before = draft();
  assert.deepEqual(wireEdit({ id: "x", ...draft({ operatorName: "Satya" }) }, before), { id: "x", operatorName: "Satya" },
    "editing the Person box alone must not re-send quantity, item, unit or price");
  assert.deepEqual(wireEdit({ id: "x", ...draft() }, before), { id: "x" }, "nothing moved, nothing sent");
  assert.deepEqual(wireEdit({ id: "x", ...draft({ unitPrice: "40" }) }, before), { id: "x", unitPrice: 40 });
  assert.deepEqual(wireEdit({ id: "x", ...draft({ unitPrice: " 40 " }) }, draft({ unitPrice: "40" })), { id: "x" },
    "whitespace around an unchanged value is not a change");
  // a row the baseline never saw sends everything — the safe direction
  const all = wireEdit({ id: "x", ...draft() }, undefined);
  assert.ok("quantity" in all && "itemName" in all && "unit" in all && "operatorName" in all);
  // a new row (no id) is sent whole
  const fresh = wireEdit(draft(), undefined);
  assert.ok(!("id" in fresh) && fresh.itemName === "Gloves" && fresh.quantity === 5 && fresh.unitPrice === null);
});

test("a price must ARRIVE as a number — '' is not ₹0 and true is not ₹1", () => {
  for (const bad of ["", "40", true, false, "abc", NaN, Infinity, -1, {} as unknown]) {
    const r = editProblem({ id: "x", itemName: "Gloves", unitPrice: bad as never }, stations);
    assert.ok(r, `unitPrice ${JSON.stringify(bad)} must be refused, got null`);
  }
  assert.equal(editProblem({ id: "x", unitPrice: 40 }, stations), null, "a real number passes");
  assert.equal(editProblem({ id: "x", unitPrice: 0 }, stations), null, "zero is a real price");
  assert.equal(editProblem({ id: "x", unitPrice: null }, stations), null, "null clears the price and is allowed");
});

test("a price is never signed by a blank name", () => {
  assert.equal(saverName("Thiru", "t@x.com"), "Thiru");
  assert.equal(saverName("  Thiru  ", "t@x.com"), "Thiru");
  assert.equal(saverName("", "t@x.com"), "t@x.com", "an empty-string name falls back to the email, not to ''");
  assert.equal(saverName("   ", "t@x.com"), "t@x.com");
  assert.equal(saverName(null, "t@x.com"), "t@x.com");
  assert.equal(saverName("", ""), "unknown");
  assert.equal(saverName(undefined, undefined), "unknown");
  assert.notEqual(saverName("", null), "", "never the empty string");
});

test("the sheet and the floor panel offer the SAME items — resin and grit are on neither", () => {
  assert.deepEqual(SHEET_ITEM_WHERE, { category: { not: "DIRECT_MATERIAL" } });
  const usage = read("../src/lib/consumables/batchUsage.ts");
  const route = read("../src/app/api/office/batch-consumables/route.ts");
  assert.ok(usage.includes("SHEET_ITEM_WHERE"), "the sheet's datalist must use the shared filter");
  assert.ok(route.includes("where: SHEET_ITEM_WHERE"), "the route's stock lookup must use the shared filter");
  for (const p of ["../src/app/entry/mixer/page.tsx", "../src/app/entry/slab/[model]/page.tsx"])
    assert.ok(read(p).includes("DIRECT_MATERIAL"), `${p} must still filter direct materials from the picker`);
});
