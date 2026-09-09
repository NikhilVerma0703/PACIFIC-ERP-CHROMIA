// The order task list and the automatic dispatch — round three, answers 6, 7
// and 8, run against the real values the routes and the Tasks card use.
// src/lib/commercial/tasks-rules.ts imports nothing, which is what lets
// node --test load it without Next, Prisma or auth: anything proved here is
// true of the running module rather than of a copy of it.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/commercialTasks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TASKS, DEFAULT_TASK_KEYS, TASK_STATUSES,
  tasksFor, taskKindOf, isTaskStatus, taskProgress, progressNote, sortTasks, groupTasks,
  nextSortOrder, taskKeyFor, statusFromTick, doneAtFor, dayOf, taskEventNote, taskEditNote,
  tasksToSeed, changedTaskFields,
  autoDispatchPlan, autoDispatchNote, autoDispatchIntentNote,
  type TaskLike, type ReservedSlabLike,
} from "../src/lib/commercial/tasks-rules.ts";

const task = (over: Partial<TaskLike> & { taskKey: string }): TaskLike => ({
  label: over.taskKey, status: "PENDING", sortOrder: 0, ...over,
});

// ───────────────────────────── the default list ──────────────────────────────

test("DEFAULT_TASKS: the twelve export jobs the owner named, by key", () => {
  const keys = tasksFor("EXPORT").map((t) => t.key);
  assert.deepEqual(keys, [
    "container_booking", "cha", "bl_draft", "coo", "cefa", "fumigation_cert",
    "tio2_moc", "rfid_lock", "container_pictures", "shipping_docs_sent",
    "daltile_upload", "eta_sheet",
  ], "answers 7 and 8 name these twelve; the keys are the contract and never change");
  assert.equal(keys.length, 12);
});

test("DEFAULT_TASKS: a domestic order gets the truck's three, and none of the export documents", () => {
  const keys = tasksFor("DOMESTIC").map((t) => t.key);
  assert.deepEqual(keys, ["transport_booking", "transporter_bills", "eway_bill"]);
  assert.ok(!keys.includes("bl_draft"), "a domestic truck has no bill of lading");
  assert.ok(!keys.includes("container_booking"));
});

test("tasksFor: the kind is read loosely, and anything that is not EXPORT is domestic", () => {
  assert.equal(tasksFor("export").length, 12, "case does not decide a shipment");
  assert.equal(tasksFor(" EXPORT ").length, 12);
  assert.equal(taskKindOf(null), "DOMESTIC");
  assert.equal(taskKindOf(""), "DOMESTIC");
  assert.equal(taskKindOf("rubbish"), "DOMESTIC");
  assert.equal(tasksFor(undefined).length, 3, "a blank kind seeds something usable rather than nothing");
});

test("DEFAULT_TASKS: every key is unique, ascending in sort order, and has a label", () => {
  assert.equal(new Set(DEFAULT_TASK_KEYS).size, DEFAULT_TASKS.length, "a duplicate key would collide on (orderId, taskKey)");
  for (const t of DEFAULT_TASKS) {
    assert.ok(/^[a-z0-9_]+$/.test(t.key), `${t.key} must be a plain slug — it goes in a URL and a payload`);
    assert.ok(t.label.trim().length > 0);
    assert.ok(t.kinds.length > 0, `${t.key} applies to no order kind, so nothing would ever seed it`);
  }
  const sorts = DEFAULT_TASKS.map((t) => t.sortOrder);
  assert.deepEqual(sorts, [...sorts].sort((a, b) => a - b), "the table is written in display order");
  assert.equal(new Set(sorts).size, sorts.length);
});

test("tasksFor hands back copies, so a caller cannot edit the shipped defaults", () => {
  const first = tasksFor("EXPORT")[0];
  first.label = "changed";
  assert.equal(tasksFor("EXPORT")[0].label, "Container booking");
});

// ───────────────────────────────── progress ──────────────────────────────────

test("taskProgress: done, not-required and outstanding, with not-required counted apart", () => {
  const list = [
    task({ taskKey: "a", status: "DONE" }),
    task({ taskKey: "b", status: "DONE" }),
    task({ taskKey: "c", status: "NOT_REQUIRED" }),
    task({ taskKey: "d", status: "PENDING" }),
  ];
  const p = taskProgress(list);
  assert.deepEqual(p, { total: 4, done: 2, notRequired: 1, outstanding: 1 });
});

test("taskProgress: a status the enum does not know counts as outstanding, never as done", () => {
  const p = taskProgress([task({ taskKey: "a", status: "WHATEVER" })]);
  assert.deepEqual(p, { total: 1, done: 0, notRequired: 0, outstanding: 1 });
});

test("taskProgress: the total keeps the waived lines in it", () => {
  const list = Array.from({ length: 12 }, (_, i) =>
    task({ taskKey: `k${i}`, status: i < 7 ? "DONE" : i < 9 ? "NOT_REQUIRED" : "PENDING" }));
  const p = taskProgress(list);
  assert.deepEqual(p, { total: 12, done: 7, notRequired: 2, outstanding: 3 });
  assert.equal(progressNote(p), "7 of 12 done, 2 not required, 3 outstanding.",
    "the sentence the card prints — the owner asked to see all three numbers at once");
});

test("progressNote: nothing outstanding, nothing waived, and an empty list all read plainly", () => {
  assert.equal(progressNote(taskProgress([])), "No tasks on this order yet.");
  assert.equal(progressNote(taskProgress([task({ taskKey: "a", status: "DONE" })])), "1 of 1 done — nothing outstanding.");
  assert.equal(progressNote(taskProgress([task({ taskKey: "a" })])), "0 of 1 done, 1 outstanding.");
  assert.equal(
    progressNote(taskProgress([task({ taskKey: "a", status: "DONE" }), task({ taskKey: "b", status: "NOT_REQUIRED" })])),
    "1 of 2 done, 1 not required — nothing outstanding.");
});

// ───────────────────────────── order and grouping ────────────────────────────

test("sortTasks: sort order first, then label, then key — a total order", () => {
  const out = sortTasks([
    task({ taskKey: "z", label: "Zebra", sortOrder: 20 }),
    task({ taskKey: "b", label: "Alpha", sortOrder: 10 }),
    task({ taskKey: "a", label: "Alpha", sortOrder: 10 }),
    task({ taskKey: "n", label: "No order", sortOrder: null }),
  ]).map((t) => t.taskKey);
  assert.deepEqual(out, ["n", "a", "b", "z"], "a null sort order sits at 0, and the tie breaks on label then key");
});

test("groupTasks: outstanding is PENDING only; a waived line is settled, not left", () => {
  const g = groupTasks([
    task({ taskKey: "a", status: "DONE", sortOrder: 10 }),
    task({ taskKey: "b", status: "PENDING", sortOrder: 20 }),
    task({ taskKey: "c", status: "NOT_REQUIRED", sortOrder: 30 }),
    task({ taskKey: "d", status: "PENDING", sortOrder: 40 }),
  ]);
  assert.deepEqual(g.outstanding.map((t) => t.taskKey), ["b", "d"]);
  assert.deepEqual(g.done.map((t) => t.taskKey), ["a", "c"], "not required is finished work — it is not outstanding");
  assert.equal(g.outstanding.length + g.done.length, 4, "every row lands in exactly one group");
});

// ──────────────────────── adding a task the list lacks ───────────────────────

test("taskKeyFor: slugs the label and keeps it away from the default keys", () => {
  assert.equal(taskKeyFor("Marine insurance"), "marine_insurance");
  assert.equal(taskKeyFor("  CEFA  "), "cefa_2", "a hand-typed CEFA must not steal the key the default line will want");
  assert.equal(taskKeyFor("Marine insurance", ["marine_insurance"]), "marine_insurance_2");
  assert.equal(taskKeyFor("Marine insurance", ["marine_insurance", "marine_insurance_2"]), "marine_insurance_3");
});

test("taskKeyFor: a label with nothing sluggable still produces a usable key", () => {
  assert.equal(taskKeyFor("—"), "task");
  assert.equal(taskKeyFor("", ["task"]), "task_2");
});

test("nextSortOrder: a hand-added task lands after everything already there", () => {
  assert.equal(nextSortOrder([]), 10);
  assert.equal(nextSortOrder(tasksFor("EXPORT").map((t) => task({ taskKey: t.key, sortOrder: t.sortOrder }))), 130);
  assert.equal(nextSortOrder([task({ taskKey: "a", sortOrder: null })]), 10);
});

// ───────────────────────── the tick, the date, the note ──────────────────────

test("statusFromTick and doneAtFor: un-ticking clears the date it was ticked on", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  const earlier = new Date("2026-09-01T10:00:00Z");
  assert.equal(statusFromTick(true), "DONE");
  assert.equal(statusFromTick(false), "PENDING");
  assert.deepEqual(doneAtFor("DONE", now), new Date("2026-09-09T00:00:00Z"), "a new tick is stamped as a DAY");
  assert.deepEqual(doneAtFor("DONE", now, earlier), earlier, "an already-done task keeps the day it was done, exactly as stored");
  assert.equal(doneAtFor("PENDING", now, earlier), null, "a line that is open again must not still carry a completion date");
  assert.equal(doneAtFor("NOT_REQUIRED", now, earlier), null, "nothing was done on a waived line");
});

test("doneAtFor stamps the DAY, so a tick late in the Indian evening is not filed under yesterday", () => {
  // 01:30 IST on 10 September is 20:00Z on the 9th. The card renders doneAt by
  // slicing the first ten characters off the ISO string, so an untruncated
  // stamp put "2026-09-09" in the date box of work done on the 10th.
  const lateEvening = new Date("2026-09-09T20:00:00Z");
  const stamped = doneAtFor("DONE", lateEvening) as Date;
  assert.equal(stamped.toISOString(), "2026-09-09T00:00:00.000Z");
  assert.equal(stamped.toISOString().slice(0, 10), "2026-09-09", "the stored value and the printed one are the same day");
  assert.deepEqual(dayOf(new Date("2026-09-09T23:59:59.999Z")), new Date("2026-09-09T00:00:00Z"));
  assert.deepEqual(dayOf(new Date("2026-09-09T00:00:00Z")), new Date("2026-09-09T00:00:00Z"), "already a day: unchanged");
});

test("isTaskStatus: only the three the database enum has", () => {
  for (const s of TASK_STATUSES) assert.ok(isTaskStatus(s));
  assert.ok(!isTaskStatus("done"), "the route upper-cases before asking");
  assert.ok(!isTaskStatus("SKIPPED"));
  assert.ok(!isTaskStatus(null));
});

test("tasksToSeed: only the default lines the order is missing, so a corrected kind still gets its list", () => {
  assert.equal(tasksToSeed("EXPORT").length, 12, "an order nobody has opened gets the whole list");
  assert.deepEqual(tasksToSeed("EXPORT", DEFAULT_TASK_KEYS), [], "a fully seeded order seeds nothing — the read stays a read");

  // The bug the row COUNT caused: created DOMESTIC, opened once (three truck
  // ticks written), then corrected to EXPORT — and the twelve export lines
  // could never arrive, on an order or by hand (taskKeyFor refuses their keys).
  const domestic = tasksFor("DOMESTIC").map((t) => t.key);
  const seeded = tasksToSeed("EXPORT", domestic).map((t) => t.key);
  assert.deepEqual(seeded, [
    "container_booking", "cha", "bl_draft", "coo", "cefa", "fumigation_cert",
    "tio2_moc", "rfid_lock", "container_pictures", "shipping_docs_sent",
    "daltile_upload", "eta_sheet",
  ], "all twelve export lines arrive on an order that already carries the domestic three");
  assert.ok(!seeded.includes("transport_booking"), "and nothing already on the order is written twice");

  // A hand-added task is not a default key, so it never blocks a default line.
  assert.equal(tasksToSeed("EXPORT", ["marine_insurance"]).length, 12);
  assert.equal(tasksToSeed("EXPORT", ["bl_draft"]).length, 11, "the one already there is skipped, the rest arrive");
});

test("taskEventNote: the log line carries what happened, who and the note", () => {
  assert.equal(taskEventNote("BL draft", "DONE", "Raghav", "sent to the line"),
    'Task "BL draft" marked done by Raghav — sent to the line');
  assert.equal(taskEventNote("Fumigation certificate", "NOT_REQUIRED", "Murali", null),
    'Task "Fumigation certificate" marked not required by Murali');
  assert.equal(taskEventNote("CHA", "PENDING", null, null), 'Task "CHA" marked outstanding again');
});

test("taskEditNote: a note or a date is not a tick, and never names a doer who did not tick", () => {
  // Setumani ticked "BL draft" on Monday; Raghav types the courier reference
  // into that row's note box on Tuesday. The route used to write taskEventNote
  // for that PATCH too, so the log read 'marked done by Raghav'.
  assert.equal(taskEditNote("BL draft", "Raghav", { note: true }, "courier ref 8891"),
    'Note on task "BL draft" updated by Raghav — courier ref 8891');
  assert.equal(taskEditNote("Fumigation certificate", "Raghav", { date: true }, null),
    'Date on task "Fumigation certificate" updated by Raghav');
  assert.equal(taskEditNote("COO (certificate of origin)", "Murali", { note: true, date: true }, "issued 12-09"),
    'Note and date on task "COO (certificate of origin)" updated by Murali — issued 12-09');
  assert.equal(taskEditNote("CHA", null, { note: true }, null), 'Note on task "CHA" updated',
    "a cleared note leaves no dash hanging off the end of the line");
  assert.ok(!taskEditNote("BL draft", "Raghav", { note: true }, "x").includes("marked"),
    "the word the tick uses must never appear on an edit that did not tick anything");
});

test("changedTaskFields: a patch that changes nothing writes nothing", () => {
  const row = { status: "DONE", note: "sent", doneAt: new Date("2026-09-09T00:00:00Z"), doneByName: "Setumani" };
  assert.deepEqual(changedTaskFields(row, { note: "sent" }), [], "blurring an untouched note box is not an edit");
  assert.deepEqual(changedTaskFields(row, { doneAt: new Date("2026-09-09T00:00:00Z") }), [],
    "the same day sent back is the same day, whichever object carries it");
  assert.deepEqual(changedTaskFields(row, { note: "sent by DHL" }), ["note"]);
  assert.deepEqual(changedTaskFields(row, { doneAt: null }), ["doneAt"], "clearing a date that is set IS an edit");
  assert.deepEqual(changedTaskFields({ ...row, doneAt: null }, { doneAt: null }), [],
    "clearing a date that is already blank is not");
  assert.deepEqual(changedTaskFields({ ...row, note: null }, { note: null }), [], "null and null are one value");
  assert.deepEqual(changedTaskFields(row, { status: "PENDING", doneAt: null, doneByName: null }).sort(),
    ["doneAt", "doneByName", "status"], "an untick changes all three");
});

// ────────────────── automatic dispatch on the close (answer 6) ───────────────

const slab = (n: number, status: string, ref: string | null): ReservedSlabLike =>
  ({ slabNumber: n, status, reservedForPi: ref });

test("autoDispatchPlan: everything RESERVED under one of the order's own references goes", () => {
  const plan = autoDispatchPlan([
    slab(11, "RESERVED", "ORD/26-27/N0004"),
    slab(12, "RESERVED", "ENQ/26-27/0009"),
    slab(13, "RESERVED", "HOLD-4"),
  ], ["ORD/26-27/N0004", "ENQ/26-27/0009", "HOLD-4"]);
  assert.deepEqual(plan.slabNumbers, [11, 12, 13]);
  assert.deepEqual(plan.skipped, []);
});

test("autoDispatchPlan: another desk's hold is never cleared by closing our order", () => {
  const plan = autoDispatchPlan([
    slab(11, "RESERVED", "ORD/26-27/N0004"),
    slab(12, "RESERVED", "PI/26-27/0111"),
    slab(13, "RESERVED", null),
  ], ["ORD/26-27/N0004"]);
  assert.deepEqual(plan.slabNumbers, [11]);
  assert.deepEqual(plan.skipped, [
    { slab: 12, reason: "held under PI/26-27/0111" },
    { slab: 13, reason: "held under another reference" },
  ]);
});

test("autoDispatchPlan: only RESERVED — a PACKED slab is not swept out of its crate", () => {
  const plan = autoDispatchPlan([
    slab(11, "PACKED", "ORD/26-27/N0004"),
    slab(12, "AVAILABLE", null),
    slab(13, "DISPATCHED", "ORD/26-27/N0004"),
    slab(14, "RESERVED", "ORD/26-27/N0004"),
  ], ["ORD/26-27/N0004"]);
  assert.deepEqual(plan.slabNumbers, [14], "the owner's word was 'reserved'; a packed slab leaves through its packing list");
  assert.deepEqual(plan.skipped.map((s) => s.slab), [11, 12, 13]);
  assert.equal(plan.skipped[0].reason, "PACKED, not on hold");
});

test("autoDispatchPlan: an empty reference list owns nothing", () => {
  const plan = autoDispatchPlan([slab(11, "RESERVED", "ORD/26-27/N0004")], []);
  assert.deepEqual(plan.slabNumbers, []);
  assert.deepEqual(plan.skipped, [{ slab: 11, reason: "held under ORD/26-27/N0004" }]);
  assert.deepEqual(autoDispatchPlan([slab(11, "RESERVED", "")], ["", "  "]).slabNumbers, [],
    "a blank reference is not a reference — it would otherwise match every unreserved row");
});

test("autoDispatchPlan: nothing reserved is a no-op, and a repeated slab is counted once", () => {
  assert.deepEqual(autoDispatchPlan([], ["ORD/26-27/N0004"]), { slabNumbers: [], skipped: [] });
  const plan = autoDispatchPlan([
    slab(11, "RESERVED", "ORD/26-27/N0004"),
    slab(11, "RESERVED", "ORD/26-27/N0004"),
  ], ["ORD/26-27/N0004"]);
  assert.deepEqual(plan.slabNumbers, [11]);
});

test("autoDispatchPlan: the answer is sorted, so the log reads the same twice", () => {
  const plan = autoDispatchPlan([
    slab(30, "RESERVED", "R"), slab(4, "RESERVED", "R"), slab(17, "RESERVED", "R"),
  ], ["R"]);
  assert.deepEqual(plan.slabNumbers, [4, 17, 30]);
});

test("autoDispatchIntentNote: the log names what the close is about to move, before it moves it", () => {
  assert.equal(autoDispatchIntentNote("ORD/26-27/N0004", [11, 12, 13]),
    "Closing ORD/26-27/N0004: 3 reserved slabs to mark dispatched (11, 12, 13) — moving them now.");
  assert.equal(autoDispatchIntentNote("ORD/26-27/N0004", [11]),
    "Closing ORD/26-27/N0004: 1 reserved slab to mark dispatched (11) — moving them now.");
  // A 150-slab enquiry hold is the case this line exists for: the sweep is one
  // round trip per slab and the request can be killed before the result note.
  const many = Array.from({ length: 150 }, (_, i) => i + 1);
  const note = autoDispatchIntentNote("ORD/26-27/N0004", many);
  assert.ok(note.startsWith("Closing ORD/26-27/N0004: 150 reserved slabs to mark dispatched (1, 2, "));
  assert.ok(note.endsWith("and 130 more) — moving them now."), "the line stays readable on a large sweep");
});

test("autoDispatchNote: a no-op says so, and a partial sweep names what it left", () => {
  assert.equal(autoDispatchNote("ORD/26-27/N0004", 0, 0),
    "Closed ORD/26-27/N0004: nothing was still reserved against it, so no slab was dispatched.");
  assert.equal(autoDispatchNote("ORD/26-27/N0004", 1, 0),
    "Closed ORD/26-27/N0004: 1 reserved slab marked dispatched automatically.");
  assert.equal(autoDispatchNote("ORD/26-27/N0004", 6, 0),
    "Closed ORD/26-27/N0004: 6 reserved slabs marked dispatched automatically.");
  assert.equal(autoDispatchNote("ORD/26-27/N0004", 6, 2),
    "Closed ORD/26-27/N0004: 6 reserved slabs marked dispatched automatically · 2 left alone");
  assert.match(autoDispatchNote("ORD/26-27/N0004", 6, 0, 3), /3 not visible to this login/,
    "a slab hidden by the sales-approval filter stays reserved, and the log has to say so");
});
