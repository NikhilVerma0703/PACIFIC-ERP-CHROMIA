import { test } from "node:test";
import assert from "node:assert/strict";
import { pieceStages, summarizeStages } from "../src/lib/fab/pieceStages.ts";

const base = {
  polishRequired: true,
  polishingCompleted: false,
  hasSink: true,
  sinkCompleted: false,
  fabricationRequired: true,
  fabricationCompleted: false,
};

test("uncut piece is pending at every required stage", () => {
  const s = pieceStages({ ...base, status: "PENDING" });
  assert.equal(s.cutting, "pending");
  assert.equal(s.polishing, "pending");
  assert.equal(s.packaging, "pending");
});

test("cut piece waiting polish is done cutting, pending polish", () => {
  const s = pieceStages({ ...base, status: "CUT" });
  assert.equal(s.cutting, "done");
  assert.equal(s.polishing, "pending");
  assert.equal(s.sink, "pending");
});

test("packaged piece is done through packaging", () => {
  const s = pieceStages({
    ...base,
    status: "PACKAGED",
    polishingCompleted: true,
    sinkCompleted: true,
    fabricationCompleted: true,
  });
  assert.equal(s.packaging, "done");
  assert.equal(s.polishing, "done");
});

test("no-sink piece marks sink as na", () => {
  const s = pieceStages({ ...base, status: "CUT", hasSink: false });
  assert.equal(s.sink, "na");
});

test("rejected piece keeps cut as done and later stages as rejected", () => {
  const s = pieceStages({ ...base, status: "REJECTED", polishingCompleted: false });
  assert.equal(s.cutting, "done");
  assert.equal(s.polishing, "rejected");
  assert.equal(s.packaging, "rejected");
});

test("summarize counts packaged vs waiting cut vs in process", () => {
  const sum = summarizeStages([
    pieceStages({ ...base, status: "PENDING" }),
    pieceStages({ ...base, status: "CUT" }),
    pieceStages({ ...base, status: "PACKAGED", polishingCompleted: true, sinkCompleted: true, fabricationCompleted: true }),
    pieceStages({ ...base, status: "REJECTED" }),
  ]);
  assert.equal(sum.total, 4);
  assert.equal(sum.waitingCut, 1);
  assert.equal(sum.inProcess, 1);
  assert.equal(sum.packaged, 1);
  assert.equal(sum.rejected, 1);
});
