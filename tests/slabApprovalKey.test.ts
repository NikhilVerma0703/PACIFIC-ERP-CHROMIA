import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvalKey, approvalKeyString, NO_DESIGN, NO_BATCH, KEY_SEP } from "../src/lib/inventory/approvalKey.ts";
import { displayBatch } from "../src/lib/batchDisplay.ts";

// Sales approval is keyed by (design, batch). Two places used to derive that
// key: the gate that hides unapproved slabs, and the slab-intake form that
// approves what it saves. When they disagreed, the form wrote a row the gate
// never looked up — the approval was stored, the screen said the slab was
// approved, and the slab stayed hidden. These pin the shape of the key and the
// single derivation, because the failure is silent and looks like a lie.

test("a null batch is the no-batch marker; an EMPTY batch is not", () => {
  // The distinction that actually broke: "" is a batch somebody typed, and
  // displayBatch decides what it reads as. Only NULL means "no batch".
  assert.equal(approvalKey("Honeydew", null).batch, NO_BATCH);
  assert.equal(approvalKey("Honeydew", undefined).batch, NO_BATCH);
  assert.equal(approvalKey("Honeydew", "").batch, displayBatch(""));
  assert.notEqual(displayBatch(""), NO_BATCH);
});

test("every batch shape the plant writes goes through displayBatch", () => {
  for (const b of ["326", "B 326", "D1414", "1414-A", "  ", "1031"]) {
    assert.equal(approvalKey("Honeydew", b).batch, displayBatch(b), `batch ${JSON.stringify(b)}`);
  }
});

test("a slab with no design at all is filed under one agreed name", () => {
  assert.equal(approvalKey(null, "326").design, NO_DESIGN);
  assert.equal(approvalKey(undefined, "326").design, NO_DESIGN);
  assert.equal(approvalKey("Honeydew", "326").design, "Honeydew");
});

test("the joined key separates on a character neither half can contain", () => {
  assert.equal(KEY_SEP, String.fromCharCode(0));
  assert.equal(approvalKeyString({ design: "A", batch: "B" }), `A${KEY_SEP}B`);
  // No pair of real values can collide with another pair.
  assert.notEqual(
    approvalKeyString(approvalKey("Honey", "dew 1")),
    approvalKeyString(approvalKey("Honey dew", "1")),
  );
});

// ---------------------------------------------------------------------------
// Structural guards. These read the source rather than call it, because what
// they protect against is not a wrong VALUE but a wrong PLACE: a second
// derivation of the key, or an approval that runs after an early return and so
// never happens on the path that matters most.

const gate = readFileSync(new URL("../src/lib/inventory/searchWhere.ts", import.meta.url), "utf8");
const intake = readFileSync(new URL("../src/app/slab-intake/actions.ts", import.meta.url), "utf8");

test("neither side derives the key for itself", () => {
  for (const [name, src] of [["the approval gate", gate], ["the intake form", intake]] as const) {
    assert.ok(src.includes("approvalKey"), `${name} must build its key with approvalKey()`);
    assert.ok(
      !/\?\?\s*"\(no design\)"/.test(src),
      `${name} re-implements the no-design fallback — use approvalKey() so the two cannot drift`,
    );
  }
});

test("both save paths approve, and the update path approves before it can return early", () => {
  // Opening a slab you cannot find and pressing Save with nothing changed is
  // the whole point of the rule "a slab that goes through this form is
  // approved". That path returns early, so the approval has to come first.
  //
  // The bound matters: an earlier version of this test searched the whole file
  // and was satisfied by the CREATE path's call, so deleting the update path's
  // approval left it green. It is scoped to the update path now — proved by
  // deleting that call and watching this fail.
  assert.equal(
    intake.split("await approveDesignBatch").length - 1, 2,
    "both save paths — create and update — must approve the slab",
  );
  const updatePathAt = intake.indexOf("if (!expectExisting)"); // the create branch has returned by here
  const earlyReturnAt = intake.indexOf("if (!events.length && provided.length === 0)");
  const approveInUpdateAt = intake.indexOf("await approveDesignBatch", updatePathAt);
  assert.ok(updatePathAt > 0 && earlyReturnAt > updatePathAt, "the update path and its nothing-changed return should both exist");
  assert.ok(approveInUpdateAt > 0, "the update path must approve the slab it saves");
  assert.ok(
    approveInUpdateAt < earlyReturnAt,
    "approveDesignBatch must run BEFORE the nothing-changed return, or a Save with no edits approves nothing",
  );
});
