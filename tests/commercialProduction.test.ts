// Production request and planning-queue rules, RUN against real values: the
// shortfall, where a request lands, what a reorder writes, the ▲▼ and drop
// arithmetic, which PATCH fields need `plan`, the status ladder and its stamps,
// and the "received since the request" hint on plain finished-goods rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shortfall, nextPriority, reorderPriorities, moveInList, reorderOnDrop, canChangeStatus, canEditNotes, canEditPlan, patchNeedsPlan,
  canMoveStatus, nextStatusButtons, statusPatch, parseBatchKeys, parseStatusFilter, historyOnly,
  suggestMatches, canonicalWith, designVariants, OPEN_STATUSES, isTerminalRequest, label,
  // answer 13: the plan's own figures and the change log; answer 15: delete by hand
  parsePlanFigures, planChanges, resolveChange, parseChangeAction, canDeleteRequest, initialPlan,
  planChain, predecessorRow, lastInChain, recomputeCleaning, abruptJumps, figureLabel, PLAN_FIELDS, WRITE_FIELDS,
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
  assert.equal(canEditPlan(["view", "write", "verify", "plan"]), true);
  assert.equal(canEditPlan(["view", "write", "verify"]), false, "the planned figures are the planner's (answer 13)");
  assert.equal(patchNeedsPlan({ notes: "call the polisher" }), false);
  assert.equal(patchNeedsPlan({ status: "SCHEDULED" }), true);
  // answer 15: the cleaning note and the planned batch are hand-edits anyone
  // who may write can make; the status and the plan's figures are not.
  assert.equal(patchNeedsPlan({ cleaningNote: "dark → light: full wash" }), false);
  assert.equal(patchNeedsPlan({ plannedBatch: "PES.0456" }), false);
  assert.equal(patchNeedsPlan({ producedBatchKeys: ["B-1"] }), true);
  assert.equal(patchNeedsPlan({ plannedSlabs: 30 }), true);
  assert.equal(patchNeedsPlan({ plannedHours: 12 }), true);
  assert.equal(patchNeedsPlan({ cleaningHours: 6 }), true);
  assert.equal(patchNeedsPlan({ notes: "x", cleaningNote: "y", plannedBatch: "z" }), false, "every write field at once still needs only write");
  for (const k of WRITE_FIELDS) assert.equal((PLAN_FIELDS as readonly string[]).includes(k), false, `${k} is not on both lists`);
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

// ═══════════════ answer 13: the plan's own figures and the change log ════════

const by = { id: "u1", name: "Varun" };
const now = new Date("2026-09-07T10:00:00.000Z");

test("parsePlanFigures: only the keys named; whole slabs, hours to one decimal; negatives and junk refused", () => {
  assert.deepEqual(parsePlanFigures({ plannedSlabs: "30", notes: "x" }), { ok: true, figures: { plannedSlabs: 30 } });
  assert.deepEqual(parsePlanFigures({ plannedSlabs: 29.6, plannedHours: "12.25", cleaningHours: 6 }), { ok: true, figures: { plannedSlabs: 30, plannedHours: 12.3, cleaningHours: 6 } });
  assert.deepEqual(parsePlanFigures({ plannedHours: null, cleaningHours: "" }), { ok: true, figures: { plannedHours: null, cleaningHours: null } }, "null or blank clears");
  assert.deepEqual(parsePlanFigures({ plannedSlabs: undefined }), { ok: true, figures: {} }, "undefined is not a request to change");
  assert.deepEqual(parsePlanFigures({}), { ok: true, figures: {} });
  assert.equal(parsePlanFigures({ plannedSlabs: -1 }).ok, false);
  assert.equal(parsePlanFigures({ plannedHours: "twelve" }).ok, false, "a typo is refused, not stored as zero — zero would be logged as a reduction");
  assert.match((parsePlanFigures({ cleaningHours: NaN }) as { reason: string }).reason, /Cleaning hours/);
  assert.deepEqual(parsePlanFigures({ plannedSlabs: 0 }), { ok: true, figures: { plannedSlabs: 0 } }, "zero is a real plan (nothing this run)");
  assert.equal(figureLabel("plannedSlabs"), "Planned slabs");
  assert.equal(figureLabel("other"), "other");
});

test("planChanges: one row per figure that moved; a reduction is OPEN, an increase arrives resolved", () => {
  const before = { plannedSlabs: 40, plannedHours: "16.0", cleaningHours: 3 };
  const rows = planChanges(before, { plannedSlabs: 30, plannedHours: 20, cleaningHours: 3 }, by, { requestId: "r1", now });
  assert.equal(rows.length, 2, "cleaningHours 3 → 3 writes nothing");
  assert.deepEqual(rows[0], {
    requestId: "r1", field: "plannedSlabs", fromValue: 40, toValue: 30, delta: -10, reason: null, status: "OPEN",
    changedById: "u1", changedByName: "Varun", changedAt: now, resolvedAt: null, resolvedById: null,
  });
  assert.deepEqual(rows[1], {
    requestId: "r1", field: "plannedHours", fromValue: 16, toValue: 20, delta: 4, reason: null, status: "ADDED_BACK",
    changedById: "u1", changedByName: "Varun", changedAt: now, resolvedAt: now, resolvedById: "u1",
  }, "an increase is history, not something to add back — it is logged already resolved");
  // Decimal-ish strings from the row read as numbers
  assert.deepEqual(planChanges({ plannedHours: "16.0" }, { plannedHours: 16 }, by, { requestId: "r1", now }), []);
  // never set → set counts from zero; cleared counts as reduced to zero
  const fromNull = planChanges({ plannedHours: null }, { plannedHours: 8 }, by, { requestId: "r1", now });
  assert.deepEqual([fromNull[0].fromValue, fromNull[0].toValue, fromNull[0].delta, fromNull[0].status], [null, 8, 8, "ADDED_BACK"]);
  const cleared = planChanges({ plannedSlabs: 12 }, { plannedSlabs: null }, by, { requestId: "r1", now, reason: "line dropped" });
  assert.deepEqual([cleared[0].fromValue, cleared[0].toValue, cleared[0].delta, cleared[0].status, cleared[0].reason], [12, null, -12, "OPEN", "line dropped"]);
  assert.deepEqual(planChanges({ plannedSlabs: null }, { plannedSlabs: null }, by, { requestId: "r1", now }), [], "null → null is not a change");
  assert.deepEqual(planChanges(before, {}, by, { requestId: "r1", now }), [], "a body naming no figure writes no row");
  const tenth = planChanges({ plannedHours: 3 }, { plannedHours: 2.9 }, by, { requestId: "r1", now });
  assert.equal(tenth[0].delta, -0.1, "one decimal, no floating-point tail");
});

test("resolveChange: add back restores the figure before the cut; remove leaves the plan; nothing is answered twice", () => {
  const open = { field: "plannedSlabs", fromValue: "40", toValue: 30, status: "OPEN" };
  assert.deepEqual(resolveChange(open, "addBack"), { ok: true, status: "ADDED_BACK", restore: { field: "plannedSlabs", value: 40 } });
  assert.deepEqual(resolveChange(open, "remove"), { ok: true, status: "REMOVED", restore: null });
  assert.deepEqual(resolveChange({ ...open, fromValue: null }, "addBack"), { ok: true, status: "ADDED_BACK", restore: { field: "plannedSlabs", value: null } });
  const again = resolveChange({ ...open, status: "ADDED_BACK" }, "remove");
  assert.equal(again.ok, false);
  assert.match((again as { reason: string }).reason, /already added back/);
  assert.match((resolveChange({ ...open, status: "REMOVED" }, "addBack") as { reason: string }).reason, /already removed/);
  assert.equal(resolveChange({ ...open, field: "priority" }, "addBack").ok, false, "only a plan figure can be restored");
  assert.equal(parseChangeAction("addBack"), "addBack");
  assert.equal(parseChangeAction("add_back"), "addBack");
  assert.equal(parseChangeAction(" remove "), "remove");
  assert.equal(parseChangeAction("delete"), null);
  assert.equal(parseChangeAction(undefined), null);
});

test("canDeleteRequest (answer 15): write until the plant has acted; plan always", () => {
  const writer = ["view", "write", "verify"];
  const planner = ["view", "write", "verify", "plan"];
  assert.deepEqual(canDeleteRequest("QUEUED", writer), { ok: true });
  assert.deepEqual(canDeleteRequest("SCHEDULED", writer), { ok: true });
  assert.deepEqual(canDeleteRequest("CANCELLED", writer), { ok: true }, "history nobody acted on may be tidied");
  assert.equal(canDeleteRequest("IN_PRODUCTION", writer).ok, false, "the plant is running it");
  assert.match((canDeleteRequest("PRODUCED", writer) as { reason: string }).reason, /production planning/);
  assert.deepEqual(canDeleteRequest("IN_PRODUCTION", planner), { ok: true });
  assert.deepEqual(canDeleteRequest("PRODUCED", planner), { ok: true });
  assert.equal(canDeleteRequest("QUEUED", ["verify"]).ok, false, "the dispatch checker deletes nothing");
});

const planning = { cleaningHoursDefault: 3, cleaningHoursAbrupt: 6 };

test("initialPlan: the plan starts as the shortfall, with the master's shade and the queue's cleaning hours", () => {
  assert.deepEqual(initialPlan(28, "LIGHT", "DARK", planning), { plannedSlabs: 28, shade: "LIGHT", cleaningHours: 6 });
  assert.deepEqual(initialPlan(28, "LIGHT", "LIGHT", planning), { plannedSlabs: 28, shade: "LIGHT", cleaningHours: 3 });
  assert.deepEqual(initialPlan(28, null, "DARK", planning), { plannedSlabs: 28, shade: null, cleaningHours: 3 }, "no master row: shade null, treated as MEDIUM");
  assert.deepEqual(initialPlan(5, "light", null, planning), { plannedSlabs: 5, shade: "LIGHT", cleaningHours: 3 }, "first in the queue");
  assert.deepEqual(initialPlan(NaN, "bogus", null, planning), { plannedSlabs: 0, shade: null, cleaningHours: 3 });
});

const queue = [
  { id: "a", status: "IN_PRODUCTION", priority: 1, shade: "DARK", cleaningHours: 3, design: "Midnight Black" },
  { id: "b", status: "QUEUED", priority: 2, shade: "LIGHT", cleaningHours: 3, design: "Carrara Royale" },
  { id: "c", status: "SCHEDULED", priority: 3, shade: "DARK", cleaningHours: "3.0", design: "Nero" },
  { id: "d", status: "QUEUED", priority: 4, shade: "LIGHT", cleaningHours: 6, design: "Bianco" },
  { id: "e", status: "QUEUED", priority: 5, shade: null, cleaningHours: null, design: "Cappuccino" },
  { id: "f", status: "PRODUCED", priority: 6, shade: "LIGHT", cleaningHours: 3, design: "Done" },
];

test("planChain: only QUEUED and SCHEDULED are REWRITTEN, by priority", () => {
  assert.deepEqual(planChain(queue).map((r) => r.id), ["b", "c", "d", "e"]);
  assert.deepEqual(planChain([queue[3], queue[1]]).map((r) => r.id), ["b", "d"], "sorted by priority whatever order they arrive in");
  assert.deepEqual(planChain([]), []);
});

// Who is rewritten and who counts as the PREDECESSOR are two questions. The
// running row keeps its own figure (the plant already spent it) but it is what
// the machine is coming off, so the first queued row is judged against it.
test("predecessorRow: the running row, else the most recently produced one, else nothing", () => {
  assert.equal(predecessorRow(queue)?.id, "a", "a is IN_PRODUCTION — that is what the machine is coming off");
  const idle = queue.filter((r) => r.status !== "IN_PRODUCTION");
  assert.equal(predecessorRow(idle)?.id, "f", "nothing running: the last row the plant produced");
  const twoRun = [...queue, { id: "a2", status: "IN_PRODUCTION", priority: 9, shade: "LIGHT", cleaningHours: 3, design: "Second line" }];
  assert.equal(predecessorRow(twoRun)?.id, "a2", "the last running row by priority");
  const twoDone = [
    { id: "old", status: "PRODUCED", priority: 1, shade: "DARK", cleaningHours: 3, design: "Old", producedAt: "2026-09-01T00:00:00.000Z" },
    { id: "new", status: "PRODUCED", priority: 2, shade: "LIGHT", cleaningHours: 3, design: "New", producedAt: "2026-09-06T00:00:00.000Z" },
  ];
  assert.equal(predecessorRow(twoDone)?.id, "new", "the most recent run, not the highest priority");
  assert.equal(predecessorRow([{ id: "q", status: "QUEUED", priority: 1, shade: "LIGHT", cleaningHours: null, design: "Only" }]), null);
  assert.equal(predecessorRow([]), null);
});

test("lastInChain: a new request follows the queue's tail, or the running row when the queue is empty", () => {
  assert.equal(lastInChain(queue)?.id, "e", "the last QUEUED / SCHEDULED row");
  const runningOnly = queue.filter((r) => r.status === "IN_PRODUCTION");
  assert.equal(lastInChain(runningOnly)?.id, "a", "queue empty: the row the plant is running now");
  assert.equal(lastInChain(queue.filter((r) => r.status === "PRODUCED"))?.id, "f");
  assert.equal(lastInChain([]), null);
});

// Answer 13's own case, the one the queue got wrong: a DARK design on the
// machine right now and a LIGHT one queued behind it is a 6 h changeover, not
// the ordinary 3 — the running row is not rewritten but it IS the predecessor.
test("answer 13: a LIGHT row queued behind a DARK row IN_PRODUCTION gets 6 h, not 3", () => {
  const rows = [
    { id: "run", status: "IN_PRODUCTION", priority: 1, shade: "DARK", cleaningHours: 3, design: "Midnight Black" },
    { id: "next", status: "QUEUED", priority: 2, shade: "LIGHT", cleaningHours: 3, design: "Carrara Royale" },
  ];
  assert.deepEqual(recomputeCleaning(rows, planning).patches, [{ id: "next", from: 3, cleaningHours: 6 }]);
  assert.deepEqual(abruptJumps(rows), [{
    id: "next", afterId: "run", design: "Carrara Royale", afterDesign: "Midnight Black",
    // no reading on either design: the labels answer, and the reason says so
    labL: null, afterLabL: null, reason: "Midnight Black (dark) → Carrara Royale (light)",
  }]);
  // and the same at creation: with nothing queued, a LIGHT request raised
  // while that DARK row is on the machine is BORN with 6 — before the fix
  // lastInChain saw an empty chain and gave it the ordinary 3
  const running = rows.filter((r) => r.status === "IN_PRODUCTION");
  assert.equal(initialPlan(10, "LIGHT", lastInChain(running)?.shade ?? null, planning).cleaningHours, 6);
  // with a LIGHT row already queued the new request follows THAT row: 3
  assert.equal(initialPlan(10, "LIGHT", lastInChain(rows)?.shade ?? null, planning).cleaningHours, 3);
  // nothing running: the last PRODUCED row is what the machine last ran
  const afterDone = [
    { id: "done", status: "PRODUCED", priority: 1, shade: "DARK", cleaningHours: 3, design: "Midnight Black", producedAt: "2026-09-06T00:00:00.000Z" },
    { id: "next", status: "QUEUED", priority: 2, shade: "LIGHT", cleaningHours: 3, design: "Carrara Royale" },
  ];
  assert.deepEqual(afterDone && recomputeCleaning(afterDone, planning).patches, [{ id: "next", from: 3, cleaningHours: 6 }]);
});

test("recomputeCleaning: each chain row against the one before it; only differences come back", () => {
  // a is running: not rewritten, but it is what b follows (DARK → LIGHT): 6, has 3 → written
  // c after b (LIGHT → DARK): 3, has "3.0" → nothing
  // d after c (DARK → LIGHT): 6, has 6 → nothing
  // e after d (LIGHT → unknown): 3, has null → written
  assert.deepEqual(recomputeCleaning(queue, planning).patches,
    [{ id: "b", from: 3, cleaningHours: 6 }, { id: "e", from: null, cleaningHours: 3 }]);

  // the reorder: d moved ahead of c, so d follows b (LIGHT → LIGHT: 3, had 6)
  // and c follows d (LIGHT → DARK: 3, unchanged); e now follows c (DARK →
  // unknown = MEDIUM: 3, had null)
  const moved = queue.map((r) => r.id === "c" ? { ...r, priority: 4 } : r.id === "d" ? { ...r, priority: 3 } : r);
  assert.deepEqual(recomputeCleaning(moved, planning).patches,
    [{ id: "b", from: 3, cleaningHours: 6 }, { id: "d", from: 6, cleaningHours: 3 }, { id: "e", from: null, cleaningHours: 3 }]);

  // a hand-set figure is overwritten when the row before it changes: the
  // figure is the changeover cost for THAT row, and it is a different row now
  const handSet = queue.map((r) => r.id === "d" ? { ...r, cleaningHours: 4.5 } : r);
  assert.deepEqual(recomputeCleaning(handSet, planning).patches.find((p) => p.id === "d"), { id: "d", from: 4.5, cleaningHours: 6 });
  assert.deepEqual(recomputeCleaning([], planning), { patches: [], held: [] });
});

// A planner's hand-set cleaning figure whose OPEN reduction is still on the
// "planned but not scheduled" panel must not be silently overwritten by a
// recompute — that would answer a question the panel is still asking.
test("recomputeCleaning: a row with an OPEN cleaningHours reduction is held, not rewritten", () => {
  const held = queue.map((r) => r.id === "d" ? { ...r, cleaningHours: 4.5, cleaningHeld: true } : r);
  const out = recomputeCleaning(held, planning);
  assert.equal(out.patches.some((p) => p.id === "d"), false, "the hand-set figure stays");
  assert.deepEqual(out.held, [{ id: "d", design: "Bianco", kept: 4.5, rule: 6 }]);
  // a held row still counts as its own shade for the row after it
  assert.deepEqual(out.patches.map((p) => p.id), ["b", "e"]);
  // a held row whose figure already agrees with the rule is not reported
  const agrees = queue.map((r) => r.id === "d" ? { ...r, cleaningHeld: true } : r);
  assert.deepEqual(recomputeCleaning(agrees, planning).held, []);
});

test("abruptJumps: every DARK → LIGHT changeover in the chain, naming both rows", () => {
  assert.deepEqual(abruptJumps(queue), [
    { id: "b", afterId: "a", design: "Carrara Royale", afterDesign: "Midnight Black", labL: null, afterLabL: null, reason: "Midnight Black (dark) → Carrara Royale (light)" },
    { id: "d", afterId: "c", design: "Bianco", afterDesign: "Nero", labL: null, afterLabL: null, reason: "Nero (dark) → Bianco (light)" },
  ], "a → b counts: a is running, so it is what b comes off");
  const calm = queue.map((r) => r.id === "c" ? { ...r, shade: "MEDIUM" } : r.id === "a" ? { ...r, shade: "MEDIUM" } : r);
  assert.deepEqual(abruptJumps(calm), []);
  assert.deepEqual(abruptJumps([]), []);
});

// ───────── the L* path (round two, answer 14) ─────────
//
// The queue rows carry the design master's measured lightness, joined on when
// the chain is loaded. Where a design has one it decides; where it has none
// the LIGHT / MEDIUM / DARK label stands in, and the two kinds mix freely
// down one chain.

const measured = { cleaningHoursDefault: 3, cleaningHoursAbrupt: 6, darkMaxL: 30, lightMinL: 75 };

const lab = [
  { id: "noir", status: "IN_PRODUCTION", priority: 1, shade: "MEDIUM", labL: 12, cleaningHours: 3, design: "Alabaster Noir" },
  { id: "white", status: "QUEUED", priority: 2, shade: "MEDIUM", labL: 92, cleaningHours: 3, design: "Super White" },
  { id: "mid", status: "QUEUED", priority: 3, shade: "MEDIUM", labL: 55, cleaningHours: 3, design: "Cappuccino" },
];

test("answer 14: the readings decide, not the labels — L* 12 then L* 92 is the abrupt clean", () => {
  // every row is labelled MEDIUM, so the old shade rule saw nothing at all
  assert.deepEqual(recomputeCleaning(lab, measured).patches, [{ id: "white", from: 3, cleaningHours: 6 }]);
  assert.deepEqual(abruptJumps(lab, measured), [{
    id: "white", afterId: "noir", design: "Super White", afterDesign: "Alabaster Noir",
    labL: 92, afterLabL: 12,
    reason: "Alabaster Noir L* 12 → Super White L* 92",
  }], "the warning names both designs and both readings — the owner's own example");
  // mid follows white: light to medium is the ordinary clean
  assert.equal(recomputeCleaning(lab, measured).patches.some((p) => p.id === "mid"), false);

  // the thresholds are the settings': narrow the light floor past 92 and the
  // same queue is calm
  assert.deepEqual(abruptJumps(lab, { ...measured, lightMinL: 95 }), []);
  assert.deepEqual(recomputeCleaning(lab, { ...measured, lightMinL: 95 }).patches, []);

  // a new request raised behind the running Alabaster Noir is BORN with 6
  const running = lab.filter((r) => r.status === "IN_PRODUCTION");
  assert.equal(initialPlan(10, { design: "Super White", labL: 92 }, lastInChain(running), measured).cleaningHours, 6);
  assert.equal(initialPlan(10, { design: "Cappuccino", labL: 55 }, lastInChain(running), measured).cleaningHours, 3);
  // and it stores the LABEL, not the reading: the reading lives on the master
  assert.equal(initialPlan(10, { design: "Super White", labL: 92, shade: "LIGHT" }, null, measured).shade, "LIGHT");
  assert.equal(initialPlan(10, { design: "Super White", labL: 92 }, null, measured).shade, null, "no label on the master is stored as none");
});

test("answer 14: a measured design and a labelled one mix down one chain", () => {
  const mixed = [
    // measured dark, then a design nobody measured but everybody calls light
    { id: "noir", status: "IN_PRODUCTION", priority: 1, labL: 12, shade: null, cleaningHours: 3, design: "Alabaster Noir" },
    { id: "carrara", status: "QUEUED", priority: 2, labL: null, shade: "LIGHT", cleaningHours: 3, design: "Carrara Royale" },
    // then a design with neither: MEDIUM, no claim either way
    { id: "unknown", status: "QUEUED", priority: 3, labL: null, shade: null, cleaningHours: 6, design: "Arva Trial" },
  ];
  assert.deepEqual(recomputeCleaning(mixed, measured).patches, [
    { id: "carrara", from: 3, cleaningHours: 6 },
    { id: "unknown", from: 6, cleaningHours: 3 },
  ]);
  assert.deepEqual(abruptJumps(mixed, measured).map((j) => j.reason), ["Alabaster Noir L* 12 → Carrara Royale (light)"]);

  // a reading BEATS a label that disagrees: a design labelled DARK years ago
  // and measured at L* 92 since is light, and the changeover after it is not
  // abrupt
  const corrected = [
    { id: "wasDark", status: "IN_PRODUCTION", priority: 1, labL: 92, shade: "DARK", cleaningHours: 3, design: "Repaired Master" },
    { id: "light", status: "QUEUED", priority: 2, labL: 90, shade: "LIGHT", cleaningHours: 6, design: "Super White" },
  ];
  assert.deepEqual(abruptJumps(corrected, measured), []);
  assert.deepEqual(recomputeCleaning(corrected, measured).patches, [{ id: "light", from: 6, cleaningHours: 3 }]);
});

test("answer 14: with no thresholds passed, the owner's 30 / 75 still apply", () => {
  assert.deepEqual(abruptJumps(lab).map((j) => j.id), ["white"], "a queue judged with no settings still reads the L*");
  assert.deepEqual(recomputeCleaning(lab).patches, [{ id: "white", from: 3, cleaningHours: 6 }]);
});
