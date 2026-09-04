import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { editProblem, BATCH_STATIONS } from "../src/lib/consumables/batchUsageRules.ts";
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
