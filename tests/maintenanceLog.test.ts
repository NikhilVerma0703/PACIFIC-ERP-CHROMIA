import { test } from "node:test";
import assert from "node:assert/strict";
import { sortTickets, isClosed, PRIORITIES, DOWNTIME_STATUSES } from "../src/lib/downtimeShared.ts";

// The queue order decides which fault a fitter walks to next, so it is pinned
// here rather than left to whatever the SQL happened to return.

const t = (o: Partial<Parameters<typeof sortTickets>[0][number]> = {}) => ({
  id: "x", ref: "MT-0001", title: "t", detail: null, area: null,
  priority: "Normal", status: "Pending", raisedBy: null,
  raisedAt: "2026-08-01T00:00:00.000Z", misId: null,
  response: null, respondedBy: null, respondedAt: null, closedAt: null,
  ...o,
});

test("isClosed: only Resolved and Not required take a ticket out of the queue", () => {
  assert.equal(isClosed("Resolved"), true);
  assert.equal(isClosed("Not required"), true);
  assert.equal(isClosed("Pending"), false);
  assert.equal(isClosed("Attended"), false);
  // Attended is NOT closed, deliberately: somebody looked at it, the machine is
  // not necessarily fixed. Treating it as done is how a half-repair disappears.
  for (const s of DOWNTIME_STATUSES) assert.equal(typeof isClosed(s), "boolean");
});

test("sortTickets: open before closed, urgent before old", () => {
  const rows = [
    t({ ref: "A", priority: "Low", raisedAt: "2026-08-01T00:00:00Z" }),
    t({ ref: "B", priority: "Line down", raisedAt: "2026-08-05T00:00:00Z" }),
    t({ ref: "C", priority: "High", raisedAt: "2026-08-03T00:00:00Z" }),
  ];
  assert.deepEqual(sortTickets(rows).map((x) => x.ref), ["B", "C", "A"]);

  // THE CASE THIS EXISTS FOR: a line-down raised this morning must outrank a
  // fortnight-old Low. Sorting by age alone buries it.
  const mixed = [
    t({ ref: "old-low", priority: "Low", raisedAt: "2026-07-01T00:00:00Z" }),
    t({ ref: "new-down", priority: "Line down", raisedAt: "2026-08-06T09:00:00Z" }),
  ];
  assert.equal(sortTickets(mixed)[0].ref, "new-down");
});

test("sortTickets: a resolved line-down never outranks an open Low", () => {
  const rows = [
    t({ ref: "done", priority: "Line down", status: "Resolved" }),
    t({ ref: "open", priority: "Low", status: "Pending" }),
  ];
  // A resolved emergency is history; an open Low is somebody still waiting.
  assert.deepEqual(sortTickets(rows).map((x) => x.ref), ["open", "done"]);
});

test("sortTickets: oldest first while open, newest first once closed", () => {
  const open = [
    t({ ref: "newer", raisedAt: "2026-08-05T00:00:00Z" }),
    t({ ref: "older", raisedAt: "2026-08-01T00:00:00Z" }),
  ];
  // Longest-waiting is the most overdue.
  assert.deepEqual(sortTickets(open).map((x) => x.ref), ["older", "newer"]);

  const closed = [
    t({ ref: "older", status: "Resolved", raisedAt: "2026-08-01T00:00:00Z" }),
    t({ ref: "newer", status: "Resolved", raisedAt: "2026-08-05T00:00:00Z" }),
  ];
  // Closed is a record, not a queue — most recent first reads better.
  assert.deepEqual(sortTickets(closed).map((x) => x.ref), ["newer", "older"]);
});

test("sortTickets: does not mutate its input, and an unknown priority sorts as Normal", () => {
  const rows = [t({ ref: "A", priority: "Low" }), t({ ref: "B", priority: "Line down" })];
  const before = rows.map((r) => r.ref);
  sortTickets(rows);
  assert.deepEqual(rows.map((r) => r.ref), before, "input array was reordered in place");

  // A priority written by an older deployment must not sort ahead of Line down
  // or behind Low — it lands where Normal does.
  const odd = sortTickets([
    t({ ref: "weird", priority: "Whenever" }),
    t({ ref: "down", priority: "Line down" }),
    t({ ref: "low", priority: "Low" }),
  ]).map((x) => x.ref);
  assert.deepEqual(odd, ["down", "weird", "low"]);
});

test("the vocabularies are the ones the two screens share", () => {
  // The statuses are downtime_response's own, not a parallel set — two
  // spellings of "Resolved" is how a fault reads closed on one screen and open
  // on the other.
  assert.deepEqual([...DOWNTIME_STATUSES], ["Pending", "Attended", "Resolved", "Not required"]);
  assert.deepEqual([...PRIORITIES], ["Line down", "High", "Normal", "Low"]);
});
