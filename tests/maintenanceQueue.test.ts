import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInbox, isRealIncident, incidentInstant, inboxWindow, istDay,
  INBOX_DEFAULT_DAYS, INBOX_RENDER_LIMIT, IST_OFFSET_MIN,
} from "../src/lib/maintenanceQueue.ts";

// The four KPI cards at the top of /maintenance are the first thing the owner
// checks: he reported this feature BECAUSE they read "Open 0 / Awaiting a first
// reply 0" while eight unanswered downtime rows sat on /mis. So the arithmetic
// behind them is pinned here, with no database in reach.

const inc = (o: Partial<Parameters<typeof isRealIncident>[0]> & { id?: string; date?: string | null; hour?: string | null; minutes?: number } = {}) => ({
  id: "mis-1", minutes: 30, date: "2026-08-12", hour: "06 - 07", ...o,
});

const tick = (o: Partial<{ id: string; misId: string | null; status: string; priority: string; raisedAt: string }> = {}) => ({
  id: "mt-1", misId: null as string | null, status: "Pending", priority: "Normal",
  raisedAt: "2026-08-12T04:00:00.000Z", ...o,
});

// ---------------------------------------------------------------------------
// Which rows are incidents
// ---------------------------------------------------------------------------

test("a zero-minute MIS row is not an incident and never pads the inbox", () => {
  // Three of the eight rows in the owner's screenshot read "—" for Down and "No
  // delay" for detail. getDowntimeReport keeps them (an RCA note or a details
  // line is enough) because /mis is a report; a work queue must not.
  assert.equal(isRealIncident({ minutes: 0 }), false);
  assert.equal(isRealIncident({ minutes: 0.4 }), false, "rounds to 0m on screen, so it is not work");
  assert.equal(isRealIncident({ minutes: 1 }), true);
  assert.equal(isRealIncident({ minutes: Number.NaN }), false);

  const { items, counts } = buildInbox({
    tickets: [],
    incidents: [inc({ id: "a", minutes: 0 }), inc({ id: "b", minutes: 0 }), inc({ id: "c", minutes: 45 })],
    responses: {},
  });
  assert.deepEqual(items.map((i) => i.incident?.id), ["c"]);
  assert.equal(counts.total, 1);
  assert.equal(counts.open, 1);
});

// ---------------------------------------------------------------------------
// Open / awaiting
// ---------------------------------------------------------------------------

test("an unanswered incident is open AND awaiting a first reply", () => {
  // The reported bug, stated as arithmetic: eight unanswered rows, KPIs of 0.
  const incidents = Array.from({ length: 8 }, (_, n) => inc({ id: `m${n}`, minutes: 15 }));
  const { counts } = buildInbox({ tickets: [], incidents, responses: {} });
  assert.equal(counts.open, 8);
  assert.equal(counts.openIncidents, 8);
  assert.equal(counts.awaiting, 8);
  assert.equal(counts.unknown, 0);
});

test("a resolved incident is not open, and Attended is still open", () => {
  const { counts, items } = buildInbox({
    tickets: [],
    incidents: [inc({ id: "done" }), inc({ id: "looked-at" }), inc({ id: "silent" })],
    responses: {
      done: { status: "Resolved" },
      "looked-at": { status: "Attended" },
    },
  });
  const by = Object.fromEntries(items.map((i) => [i.incident!.id, i]));
  assert.equal(by.done.open, false);
  assert.equal(by.done.closed, true);
  // Attended is NOT closed, the same rule the ticket queue has used since day
  // one: somebody looked at it, the machine is not necessarily fixed.
  assert.equal(by["looked-at"].open, true);
  assert.equal(by["looked-at"].awaiting, false, "somebody replied, so it is not awaiting a FIRST reply");
  assert.equal(by.silent.awaiting, true);
  assert.equal(counts.open, 2);
  assert.equal(counts.awaiting, 1);
  assert.equal(counts.total, 3, "a resolved incident still counts in the total — it is a record");
});

test("a response row stuck at Pending (a dispute with no answer) still awaits a reply", () => {
  // writeDowntimeDispute inserts status 'Pending' with no note, so a disputed
  // incident HAS a response row while nobody has actually answered it.
  const { counts } = buildInbox({
    tickets: [], incidents: [inc({ id: "d" })], responses: { d: { status: "Pending" } },
  });
  assert.equal(counts.awaiting, 1);
});

// ---------------------------------------------------------------------------
// One row per fact
// ---------------------------------------------------------------------------

test("an incident with a linked ticket is ONE item, counted once", () => {
  const { items, counts } = buildInbox({
    tickets: [tick({ id: "mt-9", misId: "mis-1", status: "Attended", priority: "High" })],
    incidents: [inc({ id: "mis-1" })],
    responses: {},
  });
  assert.equal(items.length, 1, "a ticket and its incident are the same conversation");
  assert.equal(counts.total, 1);
  assert.equal(counts.open, 1, "counted once, not twice");
  const only = items[0];
  assert.equal(only.kind, "incident", "the stoppage came first, so that is where it is filed");
  assert.equal(only.incident?.id, "mis-1");
  assert.equal(only.ticket?.id, "mt-9");
  // The ticket carries the answer AND the priority; the hourly row asserts neither.
  assert.equal(only.status, "Attended");
  assert.equal(only.priority, "High");
  assert.equal(only.awaiting, false);
  // Disjoint buckets: the merged item is an incident, so the two sum to total.
  assert.equal(counts.totalIncidents + counts.totalTickets, counts.total);
  assert.equal(counts.totalTickets, 0);
});

test("a ticket with no incident behind it still stands on its own", () => {
  const { items, counts } = buildInbox({
    tickets: [tick({ id: "mt-1", priority: "Line down" })],
    incidents: [],
    responses: {},
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "ticket");
  assert.equal(counts.lineDown, 1);
  assert.equal(counts.openTickets, 1);
});

test("an incident is never counted as Line down on its own", () => {
  // The hour is over by the time the row exists. Filing history under the count
  // that means "production is stopped right now" would make that number useless.
  const { counts } = buildInbox({ tickets: [], incidents: [inc({ minutes: 60 })], responses: {} });
  assert.equal(counts.lineDown, 0);
  assert.equal(counts.open, 1);
});

test("a ticket raised from an incident OUTSIDE the window does not resurrect it", () => {
  // The window filters incidents, not tickets. A linked ticket whose hour is not
  // in view has to keep rendering as a ticket, or answering it would be impossible
  // from this page for as long as the window excluded its hour.
  const { items, counts } = buildInbox({
    tickets: [tick({ id: "mt-2", misId: "mis-old" })],
    incidents: [inc({ id: "mis-new" })],
    responses: {},
  });
  assert.equal(counts.total, 2);
  assert.deepEqual(items.map((i) => i.kind).sort(), ["incident", "ticket"]);
});

// ---------------------------------------------------------------------------
// The failed lookup
// ---------------------------------------------------------------------------

test("a null responses map is UNKNOWN, never 'all unanswered'", () => {
  // getDowntimeResponses returns null when the lookup itself failed. Reading
  // that as an empty map would report a queue of work that may already be done —
  // and /mis disables responding for exactly this load, so the KPI cards must
  // not be shouting a number nobody can act on.
  const { items, counts } = buildInbox({
    tickets: [],
    incidents: [inc({ id: "a" }), inc({ id: "b" })],
    responses: null,
  });
  assert.equal(counts.unknown, 2);
  assert.equal(counts.open, 0, "unknown is not open");
  assert.equal(counts.awaiting, 0, "and it is certainly not 'awaiting a first reply'");
  assert.equal(counts.total, 2, "but the rows are still shown — they are not hidden either");
  for (const it of items) {
    assert.equal(it.known, false);
    assert.equal(it.status, null);
    assert.equal(it.closed, false, "an unknown item must not be filtered away as finished");
  }
});

test("a linked ticket rescues the answer when the responses lookup failed", () => {
  // The mirror writes both rows on every answer, so the ticket IS the response.
  const { items, counts } = buildInbox({
    tickets: [tick({ id: "mt-3", misId: "mis-1", status: "Resolved" })],
    incidents: [inc({ id: "mis-1" })],
    responses: null,
  });
  assert.equal(items[0].known, true);
  assert.equal(items[0].status, "Resolved");
  assert.equal(counts.unknown, 0);
  assert.equal(counts.open, 0);
});

test("a missing maintenance_ticket table does not blank the incidents", () => {
  // listTickets() returns null when 0036 has not run. The page used to render
  // nothing at all in that case; the incidents are in a different table and the
  // manager still has to answer them.
  const { items, counts } = buildInbox({ tickets: null, incidents: [inc()], responses: {} });
  assert.equal(items.length, 1);
  assert.equal(counts.open, 1);
});

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

test("one queue order across both kinds: open first, urgent first, oldest first", () => {
  const { items } = buildInbox({
    tickets: [
      tick({ id: "down", priority: "Line down", raisedAt: "2026-08-12T09:00:00.000Z" }),
      tick({ id: "shut", status: "Resolved", priority: "Line down", raisedAt: "2026-08-12T09:00:00.000Z" }),
    ],
    incidents: [
      inc({ id: "tue", date: "2026-08-11", hour: "06 - 07" }),
      inc({ id: "wed", date: "2026-08-12", hour: "06 - 07" }),
    ],
    responses: {},
  });
  assert.deepEqual(
    items.map((i) => i.ticket?.id ?? i.incident?.id),
    ["down", "tue", "wed", "shut"],
    "line-down ticket, then the older stoppage, then the newer, then the closed one",
  );
});

test("an undated hourly row is parked at the end of the open queue, not the top", () => {
  const { items } = buildInbox({
    tickets: [],
    incidents: [inc({ id: "nodate", date: null }), inc({ id: "dated", date: "2026-08-12" })],
    responses: {},
  });
  // Date.parse("") is NaN -> 0 -> 1970, which would make the one row nobody can
  // date look like the most overdue thing on the floor.
  assert.deepEqual(items.map((i) => i.incident!.id), ["dated", "nodate"]);
});

// ---------------------------------------------------------------------------
// The render cap — counted whole, listed in part
// ---------------------------------------------------------------------------

test("the render cap truncates the LIST and never the FIGURES", () => {
  // getDowntimeReport's own 300-row cap slices a list sorted oldest-first, so on
  // the 90-day preset the page would have received the oldest 300 hours of the
  // quarter and counted its KPI cards off them: 235 shown out of 992 real
  // incidents on the live database, with nothing from today among them. The page
  // now asks for all of them and truncates here — after the queue sort, so what
  // falls off the end is the least pressing — and the counts stay whole.
  const incidents = Array.from({ length: 12 }, (_, n) =>
    inc({ id: `m${String(n).padStart(2, "0")}`, minutes: 15, date: `2026-08-${String(n + 1).padStart(2, "0")}` }));
  const { items, counts } = buildInbox({ tickets: [], incidents, responses: {}, limit: 5 });

  assert.equal(items.length, 5);
  assert.equal(counts.shown, 5);
  assert.equal(counts.hidden, 7);
  assert.equal(counts.total, 12, "every row is still counted");
  assert.equal(counts.open, 12, "the KPI card reports the work, not the page of it");
  assert.equal(counts.awaiting, 12);
  // Oldest first while open: the cut takes the tail, so the five listed are the
  // five longest-waiting.
  assert.deepEqual(items.map((i) => i.incident!.id), ["m00", "m01", "m02", "m03", "m04"]);
});

test("closed items are what a cap drops first", () => {
  // sortTickets puts open before closed whatever the age, so the truncated tail
  // is answered history before it is outstanding work.
  const { items, counts } = buildInbox({
    tickets: [],
    incidents: [inc({ id: "old-done", date: "2026-08-01" }), inc({ id: "new-open", date: "2026-08-13" })],
    responses: { "old-done": { status: "Resolved" } },
    limit: 1,
  });
  assert.deepEqual(items.map((i) => i.incident!.id), ["new-open"]);
  assert.equal(counts.hidden, 1);
  assert.equal(counts.open, 1);
  assert.equal(counts.total, 2);
});

test("the cap defaults on, and can be turned off explicitly", () => {
  assert.equal(INBOX_RENDER_LIMIT, 300);
  const incidents = Array.from({ length: INBOX_RENDER_LIMIT + 4 }, (_, n) => inc({ id: `m${n}`, minutes: 5 }));
  // A caller that forgets the argument must not ship a quarter of hourly rows
  // into a client component.
  const capped = buildInbox({ tickets: [], incidents, responses: {} });
  assert.equal(capped.items.length, INBOX_RENDER_LIMIT);
  assert.equal(capped.counts.hidden, 4);
  const whole = buildInbox({ tickets: [], incidents, responses: {}, limit: null });
  assert.equal(whole.items.length, INBOX_RENDER_LIMIT + 4);
  assert.equal(whole.counts.hidden, 0);
  assert.equal(whole.counts.shown, whole.counts.total);
});

// ---------------------------------------------------------------------------
// The two clocks
// ---------------------------------------------------------------------------

test("an MIS hour is naive IST and is converted to a real UTC instant", () => {
  // A ticket's raised_at is Postgres now() (true UTC); a Mis row is IST
  // wall-clock stored as UTC. Printing "raised 5 h ago" off the raw MIS value
  // understates every incident's age by 5h30 — and makes a fresh one negative.
  assert.equal(IST_OFFSET_MIN, 330);
  assert.equal(incidentInstant("2026-08-12", "06 - 07"), "2026-08-12T00:30:00.000Z");
  assert.equal(incidentInstant("2026-08-12", "00 - 01"), "2026-08-11T18:30:00.000Z");
  // A malformed hour keeps the row on its own day rather than dropping it out.
  assert.equal(incidentInstant("2026-08-12", null), "2026-08-11T18:30:00.000Z");
  assert.equal(incidentInstant(null, "06 - 07"), null);
  assert.equal(incidentInstant("12/08/2026", "06 - 07"), null);
});

test("the default window is a week of PRODUCTION days, not one", () => {
  // /mis defaults to today, which is right for a report and wrong for a queue:
  // an unanswered stoppage from Tuesday is more overdue than one from today.
  assert.equal(INBOX_DEFAULT_DAYS, 7);
  const noon = Date.parse("2026-08-14T06:30:00.000Z"); // 12:00 IST
  assert.equal(istDay(noon), "2026-08-14");
  assert.deepEqual(inboxWindow(noon), { from: "2026-08-08", to: "2026-08-14" });
  assert.deepEqual(inboxWindow(noon, 1), { from: "2026-08-14", to: "2026-08-14" });

  // THE DAY TURNS AT 06:00 IST, NOT MIDNIGHT — the production day, the one
  // getDowntimeReport windows on and the one the floor works to. On the old
  // calendar day this queue asked for a range beginning after it ended for the
  // six hours either side of midnight, and rendered an empty incident list
  // precisely while the night shift was logging its stoppages.
  assert.equal(istDay(Date.parse("2026-08-14T18:29:00.000Z")), "2026-08-14"); // 23:59 IST
  assert.equal(istDay(Date.parse("2026-08-14T18:30:00.000Z")), "2026-08-14"); // 00:00 IST — same night
  assert.equal(istDay(Date.parse("2026-08-15T00:29:00.000Z")), "2026-08-14"); // 05:59 IST — still that night
  assert.equal(istDay(Date.parse("2026-08-15T00:30:00.000Z")), "2026-08-15"); // 06:00 IST — the day turns
});
