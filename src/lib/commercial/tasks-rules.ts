// The order's task list, and the automatic dispatch that closing an order
// triggers — the two PURE decisions of round three, answers 6, 7 and 8.
//
// WHY THEY SHARE A FILE. Both belong to the same desk and to the same sentence
// of the owner's: the work that finishes an order. Answers 7 and 8 say the
// outside work — Murali's booking and CHA, Raghav's documents — becomes a tick
// with a date and a note rather than a screen this module pretends to own;
// answer 6 says that when the last step completes, "whatever is reserved should
// be marked dispatched". Neither imports Prisma or Next, so both run under
// node --test against the values the routes actually use.
//
// THE KEYS ARE THE CONTRACT. Answer 7: "however much we can incorporate; we
// will build on it at last." A task that is really this module's job later
// grows a screen, and that screen hangs off the row already on the order — so
// a key here is never renamed once it has been seeded. The LABEL may be
// reworded freely; the key may not.

export type TaskStatus = "PENDING" | "DONE" | "NOT_REQUIRED";

export const TASK_STATUSES: readonly TaskStatus[] = ["PENDING", "DONE", "NOT_REQUIRED"];

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

export type TaskOrderKind = "DOMESTIC" | "EXPORT";

/** Anything but EXPORT is domestic. commercial_order.kind is a two-value enum,
 *  so this only ever decides what an empty or mistyped value gets — and a
 *  domestic list of three ticks is a better answer to that than nothing. */
export function taskKindOf(kind: string | null | undefined): TaskOrderKind {
  return String(kind ?? "").trim().toUpperCase() === "EXPORT" ? "EXPORT" : "DOMESTIC";
}

export interface TaskDef {
  key: string;
  label: string;
  sortOrder: number;
  /** Which order kinds seed this line. */
  kinds: readonly TaskOrderKind[];
}

const EXPORT_ONLY: readonly TaskOrderKind[] = ["EXPORT"];
const DOMESTIC_ONLY: readonly TaskOrderKind[] = ["DOMESTIC"];

/**
 * The work the owner named, in the order he named it (round three, answers 7
 * and 8; DECISIONS-2.md 1 and 2 list the same jobs against Murali's and
 * Raghav's desks).
 *
 * Twelve export lines and three domestic ones. Sort orders are spaced by ten
 * so a line can be inserted between two of them later without renumbering the
 * rows already sitting on live orders.
 */
export const DEFAULT_TASKS: readonly TaskDef[] = [
  // Murali's, outside this module (DECISIONS-2.md 2: "container booking, CHA,
  // price checking and the transport and freight bills are outside it too").
  { key: "container_booking",  label: "Container booking",                    sortOrder: 10,  kinds: EXPORT_ONLY },
  { key: "cha",                label: "CHA",                                  sortOrder: 20,  kinds: EXPORT_ONLY },
  // Raghav's documentation run.
  { key: "bl_draft",           label: "BL draft",                             sortOrder: 30,  kinds: EXPORT_ONLY },
  { key: "coo",                label: "COO (certificate of origin)",          sortOrder: 40,  kinds: EXPORT_ONLY },
  { key: "cefa",               label: "CEFA",                                 sortOrder: 50,  kinds: EXPORT_ONLY },
  { key: "fumigation_cert",    label: "Fumigation certificate",               sortOrder: 60,  kinds: EXPORT_ONLY },
  { key: "tio2_moc",           label: "TiO2 MOC application",                 sortOrder: 70,  kinds: EXPORT_ONLY },
  { key: "rfid_lock",          label: "RFID lock",                            sortOrder: 80,  kinds: EXPORT_ONLY },
  { key: "container_pictures", label: "Container pictures",                   sortOrder: 90,  kinds: EXPORT_ONLY },
  { key: "shipping_docs_sent", label: "Shipping documents sent to customer",  sortOrder: 100, kinds: EXPORT_ONLY },
  { key: "daltile_upload",     label: "Daltile portal upload",                sortOrder: 110, kinds: EXPORT_ONLY },
  { key: "eta_sheet",          label: "ETA sheet updated",                    sortOrder: 120, kinds: EXPORT_ONLY },
  // The domestic truck's own three.
  { key: "transport_booking",  label: "Transport booking",                    sortOrder: 130, kinds: DOMESTIC_ONLY },
  { key: "transporter_bills",  label: "Transporter bills",                    sortOrder: 140, kinds: DOMESTIC_ONLY },
  { key: "eway_bill",          label: "e-Way bill",                           sortOrder: 150, kinds: DOMESTIC_ONLY },
];

/** Every default key, for the collision check a hand-added task runs. */
export const DEFAULT_TASK_KEYS: readonly string[] = DEFAULT_TASKS.map((t) => t.key);

/** The lines seeded on an order of this kind, in display order. */
export function tasksFor(kind: string | null | undefined): TaskDef[] {
  const k = taskKindOf(kind);
  return DEFAULT_TASKS.filter((t) => t.kinds.includes(k)).map((t) => ({ ...t }));
}

/**
 * The default lines this order is still MISSING — what a seed should write.
 *
 * BY KEY, NOT BY "has it any rows at all". `kind` is editable after the order
 * is created (orders/[id] takes it, and the Overview tab renders the select),
 * so an order created DOMESTIC, opened once — which seeds the truck's three —
 * and then corrected to EXPORT would never get the twelve export lines under a
 * count guard. The desk would type them by hand, and taskKeyFor deliberately
 * refuses the default keys, so the hand-typed COO would sit on "coo_2" and the
 * real line could never arrive on that order either.
 *
 * The other kind's rows are LEFT WHERE THEY ARE. They may already carry a tick,
 * a date and a note (that is the whole record answer 7 asks for), and deleting
 * somebody's work because a select changed is not a correction. A line the
 * corrected order does not need is marked "not required" on the card.
 *
 * Idempotent by construction, and the unique index on (orderId, taskKey) is the
 * real guard: two tabs opening the same order at once both write the same rows
 * and createMany({ skipDuplicates: true }) keeps one of each.
 */
export function tasksToSeed(kind: string | null | undefined, existingKeys: readonly string[] = []): TaskDef[] {
  const have = new Set(existingKeys.map((k) => String(k)));
  return tasksFor(kind).filter((t) => !have.has(t.key));
}

// ───────────────────────────── progress and grouping ─────────────────────────

/** The minimum a stored task row has to carry for the rules below. Deliberately
 *  loose (`status: string`) — the rows arrive from Prisma as plain objects and
 *  a value the enum does not know must count as outstanding rather than throw. */
export interface TaskLike {
  taskKey: string;
  label: string;
  status: string;
  sortOrder?: number | null;
  doneAt?: string | Date | null;
  note?: string | null;
  doneByName?: string | null;
}

export interface TaskProgress {
  total: number;
  done: number;
  notRequired: number;
  /** Everything neither ticked nor waived — what the desk still has to do. */
  outstanding: number;
}

/**
 * done / not-required / outstanding over a task list.
 *
 * NOT_REQUIRED is settled, not done: a fumigation certificate the buyer does
 * not want is finished work, but counting it as done would tell the manager a
 * certificate exists. It is reported apart for exactly that reason, and it is
 * NOT subtracted from the total — "7 of 12 done, 2 not required" says both
 * things at once, which is what the desk asked to see.
 */
export function taskProgress(tasks: readonly TaskLike[]): TaskProgress {
  let done = 0, notRequired = 0;
  for (const t of tasks) {
    if (t.status === "DONE") done += 1;
    else if (t.status === "NOT_REQUIRED") notRequired += 1;
  }
  return { total: tasks.length, done, notRequired, outstanding: tasks.length - done - notRequired };
}

/** The sentence the card prints. Pure, so the wording is pinned by a test
 *  rather than retyped in JSX. */
export function progressNote(p: TaskProgress): string {
  if (p.total === 0) return "No tasks on this order yet.";
  const head = `${p.done} of ${p.total} done`;
  const tail = p.notRequired ? `, ${p.notRequired} not required` : "";
  return p.outstanding === 0 ? `${head}${tail} — nothing outstanding.` : `${head}${tail}, ${p.outstanding} outstanding.`;
}

/** Sorted by the stored sort order, then by label, then by key — a total order,
 *  so two hand-added tasks that landed on the same sortOrder never swap places
 *  between two renders of the same list. */
export function sortTasks<T extends TaskLike>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || a.label.localeCompare(b.label)
    || a.taskKey.localeCompare(b.taskKey));
}

/**
 * The two groups the card draws. `done` holds the settled rows — ticked AND
 * waived — because the reader's question there is "what is left", and a waived
 * line is not left. Each group keeps the list's own order, so a task does not
 * jump about when it is ticked and un-ticked.
 */
export function groupTasks<T extends TaskLike>(tasks: readonly T[]): { outstanding: T[]; done: T[] } {
  const sorted = sortTasks(tasks);
  return {
    outstanding: sorted.filter((t) => t.status !== "DONE" && t.status !== "NOT_REQUIRED"),
    done: sorted.filter((t) => t.status === "DONE" || t.status === "NOT_REQUIRED"),
  };
}

/** Where a hand-added task goes: after everything already on the order. */
export function nextSortOrder(tasks: readonly TaskLike[]): number {
  let max = 0;
  for (const t of tasks) max = Math.max(max, t.sortOrder ?? 0);
  return max + 10;
}

/**
 * A stable key for a task the default list does not have (answer 7: "if we can
 * add more then we'll add more"). Slugged from the label so the key still
 * reads as the thing it is, and made unique against what the order already
 * carries AND against the defaults — a hand-typed "COO" on an order that has
 * not been seeded yet must not take the key the default line will want.
 * Falls back to a numbered key when the label has nothing sluggable in it
 * (a label in Devanagari, say).
 */
export function taskKeyFor(label: string, existing: readonly string[] = []): string {
  const base = String(label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const taken = new Set<string>([...existing, ...DEFAULT_TASK_KEYS]);
  const stem = base || "task";
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 500; n += 1) {
    const k = `${stem}_${n}`;
    if (!taken.has(k)) return k;
  }
  return `${stem}_${Date.now()}`;
}

/** The status a tick or an untick lands on, so the screen and the route agree
 *  on what a checkbox means. */
export function statusFromTick(ticked: boolean): TaskStatus {
  return ticked ? "DONE" : "PENDING";
}

/**
 * A DAY, not an instant: the same UTC-midnight convention http.dateOnly gives
 * every other user-visible date column in this module (customerPoDate, the
 * invoice dates).
 *
 * The card renders doneAt by slicing the first ten characters off the ISO
 * string (fields.dateInputValue), and the server clock is UTC. A tick at 01:30
 * IST on the 10th is 20:00Z on the 9th, so an untruncated stamp put "09-09" in
 * the date box of work done on the 10th — and that box is the evidence of when
 * the container pictures were taken. Truncating to the day it was stamped
 * keeps the stored value and the printed one the same thing.
 */
export function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** doneAt follows the status: a line that is not DONE has no completion date,
 *  and un-ticking a task must clear the date rather than leave yesterday's on
 *  a line that is open again. NOT_REQUIRED keeps no date either — nothing was
 *  done on it. An already-done task keeps the date it already carries, exactly
 *  as stored; only a NEW stamp is truncated to the day (see dayOf). */
export function doneAtFor(status: TaskStatus, now: Date, current: Date | null = null): Date | null {
  if (status !== "DONE") return null;
  return current ?? dayOf(now);
}

/** The log line one task change writes (answer 7: a tick, a date and a note —
 *  the log has to carry all three or the tick is unauditable). */
export function taskEventNote(label: string, status: TaskStatus, byName: string | null, note: string | null): string {
  const what = status === "DONE" ? "done" : status === "NOT_REQUIRED" ? "not required" : "outstanding again";
  const who = byName ? ` by ${byName}` : "";
  const tail = note ? ` — ${note}` : "";
  return `Task "${label}" marked ${what}${who}${tail}`;
}

/**
 * The log line for a change that did NOT touch the tick — a note typed against
 * a row, or a completion date corrected on one.
 *
 * WHY IT EXISTS. taskEventNote's sentence is "marked done by X", and the route
 * used to write it for every PATCH, defaulting the status to the row's current
 * one. So Raghav typing the courier reference into a line Setumani ticked on
 * Monday wrote 'Task "BL draft" marked done by Raghav' — the log then named the
 * wrong person for the one thing on this row anybody argues about later. A
 * note is a note and it says so.
 */
export function taskEditNote(label: string, byName: string | null, changed: { note?: boolean; date?: boolean }, note: string | null): string {
  const what = changed.note && changed.date ? "Note and date"
    : changed.date ? "Date"
    : changed.note ? "Note"
    : "Details";
  const who = byName ? ` by ${byName}` : "";
  const tail = changed.note && note ? ` — ${note}` : "";
  return `${what} on task "${label}" updated${who}${tail}`;
}

/**
 * Which of a patch's fields actually differ from the row as stored.
 *
 * A PATCH that changes nothing must not write an order event: clearing an
 * already-blank date, or blurring a note box the clerk did not type in, would
 * otherwise leave a log line claiming an edit that never happened. Dates are
 * compared by their instant (Prisma hands back a Date, the patch builds one),
 * everything else by value with null and undefined treated as the same absence.
 */
export function changedTaskFields(row: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const same = (a: unknown, b: unknown): boolean => {
    if (a instanceof Date || b instanceof Date) {
      const ta = a instanceof Date ? a.getTime() : a === null || a === undefined ? null : new Date(String(a)).getTime();
      const tb = b instanceof Date ? b.getTime() : b === null || b === undefined ? null : new Date(String(b)).getTime();
      return ta === tb;
    }
    if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
    return a === b;
  };
  return Object.keys(data).filter((k) => !same(data[k], row[k]));
}

// ──────────────────── automatic dispatch on closing (answer 6) ───────────────

/** The little of an inventory row this decision reads. */
export interface ReservedSlabLike {
  slabNumber: number;
  status: string;
  reservedForPi: string | null;
}

export interface AutoDispatchPlan {
  /** Ascending, de-duplicated: the slabs that go out. */
  slabNumbers: number[];
  /** Read, and deliberately left where they are, each with the reason. */
  skipped: { slab: number; reason: string }[];
}

/**
 * WHICH SLABS THE CLOSE DISPATCHES (round three, answer 6: "whatever is
 * reserved should be marked dispatched after deliver / last step").
 *
 * RESERVED, and reserved under one of THIS order's own references — its
 * number, its holds' references, its enquiry number (the same list packSlabs
 * is given, and for the same reason: a slab another desk is holding under
 * another PI is not ours to move, and closing an order must never be a way to
 * clear somebody else's hold).
 *
 * Deliberately NOT PACKED. A packed slab left the building through a packing
 * list's own dispatch, which stamps the list and the order; sweeping PACKED up
 * here would mark slabs dispatched that are sitting in a crate nobody has
 * loaded, and it would do it silently. The owner's word was "reserved".
 */
export function autoDispatchPlan(rows: readonly ReservedSlabLike[], references: readonly string[]): AutoDispatchPlan {
  const ours = new Set(references.filter((r) => typeof r === "string" && r.trim() !== ""));
  const slabNumbers: number[] = [];
  const seen = new Set<number>();
  const skipped: { slab: number; reason: string }[] = [];
  for (const r of rows) {
    const n = Number(r.slabNumber);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    if (r.status !== "RESERVED") { skipped.push({ slab: n, reason: `${r.status || "unknown"}, not on hold` }); continue; }
    const ref = r.reservedForPi ?? "";
    // An empty reference list owns nothing — the same rule packSlabs applies.
    if (!ours.has(ref)) { skipped.push({ slab: n, reason: `held under ${ref || "another reference"}` }); continue; }
    slabNumbers.push(n);
  }
  slabNumbers.sort((a, b) => a - b);
  return { slabNumbers, skipped };
}

/**
 * What the close writes into the log BEFORE it moves anything.
 *
 * The sweep is one Neon round trip per slab inside the stage request (the
 * bridge's own header records 500 of them taking 25.3 s). An order closed with
 * a large enquiry-level hold on it can therefore outlive the serverless
 * function: half the slabs move, the request is killed, and the result note —
 * written last — never lands. This line is written first, so the log always
 * names what the close set out to move even when nothing gets to say what it
 * did. The result note that follows is the one that says what actually moved.
 */
export function autoDispatchIntentNote(orderNumber: string, slabNumbers: readonly number[]): string {
  const n = slabNumbers.length;
  const head = `Closing ${orderNumber}: ${n} reserved slab${n === 1 ? "" : "s"} to mark dispatched`;
  const LIST = 20;
  const shown = slabNumbers.slice(0, LIST).join(", ");
  const more = n > LIST ? ` and ${n - LIST} more` : "";
  return `${head} (${shown}${more}) — moving them now.`;
}

/** What the close writes into the order log. A no-op says so rather than
 *  saying nothing (answer 6: the clerk stops marking slabs one at a time, so
 *  the log is the only place that now records what moved). */
export function autoDispatchNote(orderNumber: string, moved: number, skipped: number, unreadable = 0): string {
  const head = moved === 0
    ? `Closed ${orderNumber}: nothing was still reserved against it, so no slab was dispatched`
    : `Closed ${orderNumber}: ${moved} reserved slab${moved === 1 ? "" : "s"} marked dispatched automatically`;
  const tails: string[] = [];
  if (skipped) tails.push(`${skipped} left alone`);
  if (unreadable) tails.push(`${unreadable} not visible to this login (sales-approval filter) and left reserved`);
  return tails.length ? `${head} · ${tails.join(", ")}` : `${head}.`;
}
