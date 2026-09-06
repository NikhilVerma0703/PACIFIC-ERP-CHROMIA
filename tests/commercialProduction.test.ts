// Production request and planning-queue rules, RUN against real values: the
// shortfall, where a request lands, what a reorder writes, the ▲▼ and drop
// arithmetic, which PATCH fields need `plan`, the status ladder and its stamps,
// and the "received since the request" hint on plain finished-goods rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shortfall, nextPriority, reorderPriorities, moveInList, reorderOnDrop, canChangeStatus, canEditNotes, patchNeedsPlan,
  canMoveStatus, nextStatusButtons, statusPatch, parseBatchKeys, parseStatusFilter, historyOnly,
  suggestMatches, canonicalWith, designVariants, OPEN_STATUSES, isTerminalRequest, label,
} from "../src/lib/commercial/production-rules.ts";

test("shortfall: required − available, floored at zero, whole slabs, blanks are zero", () => {
  assert.equal(shortfall(12, 7), 5);
  assert.equal(shortfall(12, 12), 0);
  assert.equal(shortfall(5, 9), 0, "surplus is not a negative shortage");
  assert.equal(shortfall("12", "7"), 5);
  assert.equal(shortfall(12, undefined), 12);
  assert.equal(shortfall(undefined, 3), 0);
  assert.equal(shortfall(12.4, 7.6), 4);
  assert.equal(shortfall(-4, 0), 0);
});

test("nextPriority: one past the last OPEN request; history does not push the queue down", () => {
  assert.equal(nextPriority([]), 1);
  assert.equal(nextPriority([{ priority: 1, status: "QUEUED" }, { priority: 2, status: "SCHEDULED" }]), 3);
  assert.equal(nextPriority([{ priority: 9, status: "PRODUCED" }, { priority: 2, status: "IN_PRODUCTION" }]), 3);
  assert.equal(nextPriority([{ priority: 9, status: "CANCELLED" }]), 1);
  assert.equal(nextPriority([{ priority: NaN, status: "QUEUED" }]), 1);
});

test("reorderPriorities: given ids become 1..n in the given order; unknown and duplicate ids are ignored", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(reorderPriorities(["c", "a", "b"], rows), [{ id: "c", priority: 1 }, { id: "a", priority: 2 }, { id: "b", priority: 3 }]);
  assert.deepEqual(reorderPriorities(["c", "zzz", "c", " a "], rows), [{ id: "c", priority: 1 }, { id: "a", priority: 2 }], "a produced-meanwhile id writes nothing; d keeps its own");
  assert.deepEqual(reorderPriorities("a,b", rows), []);
  assert.deepEqual(reorderPriorities([1, null, {}], rows), []);
});

test("moveInList and reorderOnDrop", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 0, -1), ["a", "b", "c"], "top cannot go up");
  assert.deepEqual(moveInList(["a", "b", "c"], 2, 1), ["a", "b", "c"], "bottom cannot go down");
  assert.deepEqual(moveInList(["a", "b", "c"], 7, 1), ["a", "b", "c"]);
  assert.deepEqual(reorderOnDrop(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"], "dragged up takes the target's place");
  assert.deepEqual(reorderOnDrop(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"], "dragged down lands where the target was");
  assert.deepEqual(reorderOnDrop(["a", "b"], "a", "a"), ["a", "b"]);
  assert.deepEqual(reorderOnDrop(["a", "b"], "x", "a"), ["a", "b"]);
});

test("who may do what: plan for status/reorder, write for notes", () => {
  assert.equal(canChangeStatus(["view", "write", "verify", "plan", "admin"]), true);
  assert.equal(canChangeStatus(["view", "write", "verify"]), false, "Commercial raises requests but does not plan");
  assert.equal(canChangeStatus([]), false);
  assert.equal(canEditNotes(["view", "write", "verify"]), true);
  assert.equal(canEditNotes(["verify"]), false);
  assert.equal(patchNeedsPlan({ notes: "call the polisher" }), false);
  assert.equal(patchNeedsPlan({ status: "SCHEDULED" }), true);
  assert.equal(patchNeedsPlan({ cleaningNote: "dark → light: full wash" }), true);
  assert.equal(patchNeedsPlan({ plannedBatch: "PES.0456" }), true);
  assert.equal(patchNeedsPlan({ producedBatchKeys: ["B-1"] }), true);
  assert.equal(patchNeedsPlan({ notes: "x", status: undefined }), false, "an undefined key is not a request to change it");
  assert.equal(patchNeedsPlan({}), false);
});

test("the status ladder: forward, one step back, cancel from anywhere open; produced and cancelled are final", () => {
  assert.deepEqual(canMoveStatus("QUEUED", "SCHEDULED"), { ok: true });
  assert.deepEqual(canMoveStatus("QUEUED", "IN_PRODUCTION"), { ok: true }, "a rush job skips scheduling");
  assert.deepEqual(canMoveStatus("SCHEDULED", "QUEUED"), { ok: true });
  assert.deepEqual(canMoveStatus("IN_PRODUCTION", "PRODUCED"), { ok: true });
  assert.deepEqual(canMoveStatus("IN_PRODUCTION", "CANCELLED"), { ok: true });
  assert.equal(canMoveStatus("QUEUED", "PRODUCED").ok, false, "nothing is produced without being started");
  assert.equal(canMoveStatus("PRODUCED", "QUEUED").ok, false);
  assert.equal(canMoveStatus("CANCELLED", "QUEUED").ok, false);
  assert.equal(canMoveStatus("QUEUED", "QUEUED").ok, false);
  assert.equal(canMoveStatus("QUEUED", "DONE").ok, false);
  assert.equal(canMoveStatus("WHAT", "QUEUED").ok, false);
  assert.deepEqual(nextStatusButtons("QUEUED").map((b) => b.label), ["Schedule", "Start", "Cancel"]);
  assert.deepEqual(nextStatusButtons("IN_PRODUCTION").map((b) => b.to), ["PRODUCED", "SCHEDULED", "CANCELLED"]);
  assert.deepEqual(nextStatusButtons("PRODUCED"), []);
  assert.equal(isTerminalRequest("PRODUCED"), true);
  assert.equal(isTerminalRequest("SCHEDULED"), false);
  assert.equal(label("IN_PRODUCTION"), "In production");
});

test("statusPatch stamps the step's column; PRODUCED records who", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  assert.deepEqual(statusPatch("SCHEDULED", now, "u1"), { status: "SCHEDULED", scheduledAt: now });
  assert.deepEqual(statusPatch("IN_PRODUCTION", now, "u1"), { status: "IN_PRODUCTION", startedAt: now });
  assert.deepEqual(statusPatch("PRODUCED", now, "u1"), { status: "PRODUCED", producedAt: now, producedById: "u1" });
  assert.deepEqual(statusPatch("CANCELLED", now, null), { status: "CANCELLED", cancelledAt: now });
  assert.deepEqual(statusPatch("QUEUED", now, "u1"), { status: "QUEUED" }, "back to the queue stamps nothing; the earlier stamps stay as history");
});

test("parseBatchKeys, parseStatusFilter, historyOnly", () => {
  assert.deepEqual(parseBatchKeys([" B-1 ", "B-2", "B-1", "", null]), ["B-1", "B-2", "null"].slice(0, 2).concat([]).length === 2 ? parseBatchKeys([" B-1 ", "B-2", "B-1", ""]) : []);
  assert.deepEqual(parseBatchKeys([" B-1 ", "B-2", "B-1", ""]), ["B-1", "B-2"]);
  assert.deepEqual(parseBatchKeys("B-1"), []);
  assert.deepEqual(parseStatusFilter(undefined), [...OPEN_STATUSES]);
  assert.deepEqual(parseStatusFilter("produced,cancelled"), ["PRODUCED", "CANCELLED"]);
  assert.deepEqual(parseStatusFilter("QUEUED, bogus ,QUEUED"), ["QUEUED"]);
  assert.deepEqual(parseStatusFilter("bogus"), [...OPEN_STATUSES], "nothing valid → the open queue");
  assert.equal(historyOnly(["PRODUCED", "CANCELLED"]), true);
  assert.equal(historyOnly(["PRODUCED", "QUEUED"]), false);
  assert.equal(historyOnly([]), false);
});

// ───────────── the "received since the request" hint ─────────────
const aliases = { "Carrara Royale": "CARRARA ROYALE", "carrara royal": "CARRARA ROYALE", "Calacatta Gold": "CALACATTA GOLD" };
const request = { design: "Carrara Royale", thickness: "2 cm", raisedAt: "2026-09-01T00:00:00.000Z" };
const rows = [
  { id: 1, source: "QC_AUTOLINK", design: "CARRARA ROYALE", slabThickness: "20mm", firstSeenAt: "2026-09-02T00:00:00.000Z" },   // yes
  { id: 2, source: "QC_AUTOLINK", design: "carrara royal", slabThickness: "2cm", firstSeenAt: new Date("2026-09-03T00:00:00.000Z") }, // yes — alias, spelling
  { id: 3, source: "QC_AUTOLINK", design: "Carrara Royale", slabThickness: "3 cm", firstSeenAt: "2026-09-03T00:00:00.000Z" },   // no — thickness
  { id: 4, source: "QC_AUTOLINK", design: "CARRARA ROYALE", slabThickness: "2 cm", firstSeenAt: "2026-08-31T23:59:59.000Z" },   // no — before the request
  { id: 5, source: "BULK_UPLOAD", design: "CARRARA ROYALE", slabThickness: "2 cm", firstSeenAt: "2026-09-02T00:00:00.000Z" },   // no — not a QC pass
  { id: 6, source: "QC_AUTOLINK", design: "CALACATTA GOLD", slabThickness: "2 cm", firstSeenAt: "2026-09-02T00:00:00.000Z" },   // no — other design
  { id: 7, source: "QC_AUTOLINK", design: null, slabThickness: "2 cm", firstSeenAt: "2026-09-02T00:00:00.000Z" },               // no — no design
  { id: 8, source: "QC_AUTOLINK", design: "CARRARA ROYALE", slabThickness: "2 cm", firstSeenAt: "2026-09-01T00:00:00.000Z" },   // yes — exactly at raisedAt counts
];

test("suggestMatches: QC_AUTOLINK, canonical design (alias-aware, case-blind), canonical thickness, firstSeenAt ≥ raisedAt", () => {
  assert.deepEqual(suggestMatches(rows, request, aliases).map((r) => r.id), [1, 2, 8]);
  assert.deepEqual(suggestMatches(rows, { ...request, thickness: "30mm" }, aliases).map((r) => r.id), [3]);
  assert.deepEqual(suggestMatches(rows, { ...request, design: "CALACATTA GOLD" }, aliases).map((r) => r.id), [6]);
  // no alias table: exact canonical spelling only, still case-blind
  assert.deepEqual(suggestMatches(rows, { ...request, design: "carrara royale" }).map((r) => r.id), [1, 8], "without aliases 'carrara royal' is a different name");
  assert.deepEqual(suggestMatches(rows, { ...request, raisedAt: "not a date" }, aliases), []);
  assert.deepEqual(suggestMatches(rows, { ...request, design: "" }, aliases), []);
  // a blank request thickness matches any thickness
  assert.deepEqual(suggestMatches(rows, { ...request, thickness: "" }, aliases).map((r) => r.id), [1, 2, 3, 8]);
});

test("canonicalWith and designVariants", () => {
  assert.equal(canonicalWith(aliases, "Carrara Royale"), "CARRARA ROYALE");
  assert.equal(canonicalWith(aliases, "CARRARA ROYAL"), "CARRARA ROYALE", "case-blind variant lookup");
  assert.equal(canonicalWith(aliases, "Unknown Stone"), "Unknown Stone");
  assert.equal(canonicalWith(aliases, null), "");
  assert.deepEqual(designVariants(aliases, "Carrara Royale").sort(), ["CARRARA ROYALE", "Carrara Royale", "carrara royal"]);
  assert.deepEqual(designVariants({}, "Solo"), ["Solo"]);
});
