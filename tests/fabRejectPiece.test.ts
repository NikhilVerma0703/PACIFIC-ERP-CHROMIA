import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocationAfterReject,
  canRejectPiece,
  isDroppedFromQueues,
  isRejectReason,
} from "../src/lib/fab/rejectPiece.ts";
import { isDowntimeReason } from "../src/lib/fab/downtimeReasons.ts";

test("reject reasons are the shop-floor list", () => {
  assert.equal(isRejectReason("CONTAMINATION"), true);
  assert.equal(isRejectReason("dust"), false);
});

test("cannot reject pending or already packed pieces", () => {
  assert.equal(canRejectPiece("PENDING", false).ok, false);
  assert.equal(canRejectPiece("CUT", true).ok, false);
  assert.equal(canRejectPiece("PACKAGED", false).ok, false);
  assert.equal(canRejectPiece("CUT", false).ok, true);
  assert.equal(canRejectPiece("POLISHED", false).ok, true);
});

test("rejected pieces leave every station queue", () => {
  assert.equal(isDroppedFromQueues("REJECTED"), true);
  assert.equal(isDroppedFromQueues("CUT"), false);
});

test("rejecting one piece returns that qty to unallocated demand", () => {
  assert.deepEqual(allocationAfterReject(4), { action: "decrement", next: 3 });
  assert.deepEqual(allocationAfterReject(1), { action: "delete" });
  assert.deepEqual(allocationAfterReject(0), { action: "noop" });
});

test("downtime reasons include breakdown and electricity", () => {
  assert.equal(isDowntimeReason("BREAKDOWN"), true);
  assert.equal(isDowntimeReason("ELECTRICITY"), true);
  assert.equal(isDowntimeReason("coffee"), false);
});
