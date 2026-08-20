import { test } from "node:test";
import assert from "node:assert/strict";
import { queueActivity, sortByRecentActivity } from "../src/lib/fab/queueActivity.ts";
import { isFabProcessType, processSessionCookie } from "../src/lib/fab/processSession.ts";

test("cookie name is per process", () => {
  assert.equal(processSessionCookie("POLISHING"), "fab_ps_POLISHING");
  assert.equal(isFabProcessType("CUTTING"), true);
  assert.equal(isFabProcessType("SANDING"), false);
});

test("otherDone lists completed stages except the current station", () => {
  const a = queueActivity([
    { operationType: "CUTTING", isCompleted: true, completedAt: "2026-08-20T10:00:00.000Z" },
    { operationType: "POLISHING", isCompleted: true, completedAt: "2026-08-20T11:00:00.000Z" },
    { operationType: "SINK_CUTTING", isCompleted: false, completedAt: null },
  ], "SINK_CUTTING", Date.parse("2026-08-20T11:30:00.000Z"));
  assert.deepEqual(a.otherDone, ["CUTTING", "POLISHING"]);
  assert.equal(a.recent, true);
  assert.equal(a.lastActivityAt, "2026-08-20T11:00:00.000Z");
});

test("sortByRecentActivity puts the newest stamp first", () => {
  const rows = [
    { id: "old", lastActivityAt: "2026-08-20T08:00:00.000Z" },
    { id: "new", lastActivityAt: "2026-08-20T12:00:00.000Z" },
    { id: "none", lastActivityAt: null },
  ];
  assert.deepEqual(
    sortByRecentActivity(rows, r => r.lastActivityAt).map(r => r.id),
    ["new", "old", "none"],
  );
});
