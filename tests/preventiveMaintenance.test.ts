import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePmEntry, PM_HOURS, PM_MAX_MINUTES } from "../src/lib/preventiveMaintenanceShared.ts";

// The register's gatekeeper. Everything here reaches the DB unchecked if this
// lets it through, so each rule is pinned — including the ones that sound too
// obvious to break.

const good = { date: "2026-08-18", hour: "06 - 07", minutes: 45, station: "Press", description: "Greased guide rails" };

test("a complete entry passes", () => {
  assert.equal(validatePmEntry(good), null);
});

test("every plant hour is accepted, and only plant hours", () => {
  assert.equal(PM_HOURS.length, 24);
  for (const hour of PM_HOURS) assert.equal(validatePmEntry({ ...good, hour }), null);
  for (const hour of ["6 - 7", "06-07", "25 - 26", "", "06 - 08"]) {
    assert.ok(validatePmEntry({ ...good, hour }), `${JSON.stringify(hour)} must be rejected`);
  }
});

test("the date must be a calendar day, not prose", () => {
  for (const date of ["18-08-2026", "2026/08/18", "yesterday", "", "2026-8-8"]) {
    assert.ok(validatePmEntry({ ...good, date }), `${JSON.stringify(date)} must be rejected`);
  }
});

test("a day that does not exist is refused, not rolled into next month", () => {
  // new Date("2026-02-31") quietly becomes 3 March; the validator must not let
  // a row be filed under a different day than the one the manager named.
  for (const date of ["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"]) {
    assert.ok(validatePmEntry({ ...good, date }), `${JSON.stringify(date)} must be rejected`);
  }
  assert.equal(validatePmEntry({ ...good, date: "2028-02-29" }), null); // real leap day
});

test("a crafted payload with wrong-typed fields gets a message, never a throw", () => {
  // A server action is its own POST endpoint — nothing guarantees strings.
  for (const bad of [
    { ...good, station: 123 }, { ...good, description: null }, { ...good, hour: 7 },
    { ...good, date: 20260818 }, { ...good, description: 123 },
  ] as unknown as Parameters<typeof validatePmEntry>[0][]) {
    assert.doesNotThrow(() => validatePmEntry(bad));
    assert.ok(validatePmEntry(bad), "wrong-typed field must be rejected with a message");
  }
});

test("station is capped like description", () => {
  assert.equal(validatePmEntry({ ...good, station: "x".repeat(200) }), null);
  assert.ok(validatePmEntry({ ...good, station: "x".repeat(201) }));
});

test("minutes: whole, positive, capped", () => {
  assert.equal(validatePmEntry({ ...good, minutes: 1 }), null);
  assert.equal(validatePmEntry({ ...good, minutes: PM_MAX_MINUTES }), null);
  for (const minutes of [0, -5, 2.5, NaN, PM_MAX_MINUTES + 1, 3000]) {
    assert.ok(validatePmEntry({ ...good, minutes }), `${minutes} must be rejected`);
  }
});

test("station and description are required, and whitespace is not content", () => {
  assert.ok(validatePmEntry({ ...good, station: "  " }));
  assert.ok(validatePmEntry({ ...good, description: "" }));
  assert.ok(validatePmEntry({ ...good, description: "x".repeat(2001) }));
  assert.equal(validatePmEntry({ ...good, description: "x".repeat(2000) }), null);
});
