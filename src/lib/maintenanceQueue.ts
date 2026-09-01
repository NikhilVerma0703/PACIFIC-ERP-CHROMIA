// THE MAINTENANCE INBOX: one queue holding both kinds of thing maintenance is
// asked to answer — the ticket somebody raised, and the downtime incident an
// hourly MIS row recorded. Pure: no prisma, no React, no I/O, so the server
// page, the client board and `node --test` all share one set of rules. Same
// split as downtimeShared.ts against downtime.ts, delayReclass.ts against
// delayReclassLog.ts.
//
// WHY THIS FILE EXISTS — AND WHY IT OVERTURNS A DECISION THAT WAS MADE ON
// PURPOSE. /maintenance was built for "everything else": the faults that never
// made it into an hourly row. Downtime incidents were deliberately left on /mis,
// and the page said so in a card at the bottom. The owner, looking at the
// Breakdown & Deviation Log, asked for the opposite: "those entries from MIS
// should also appear in this page and can be responded to from here as well."
// He is right, and the reason is already written in this repo. The header of
// src/lib/maintenanceLog.ts warns, about the ticket/response mirror:
//
//     "Left one-way, maintenance gets two inboxes and production two places to
//      look for the same answer — and the one that is staler is the one someone
//      will read."
//
// The split we shipped was exactly that failure at the level of the PAGE rather
// than the row. On the day the owner looked, /maintenance read "Open 0 /
// Awaiting a first reply 0 / Nothing logged yet" while /mis listed eight
// downtime rows, none of them answered. The maintenance manager's own page told
// him his queue was empty. So this is not a reversal of that reasoning: it is
// the completion of it. Two views, one queue, and the answer follows whichever
// screen it was typed on.
//
// WHAT IS DECIDED HERE, and why the arithmetic is not left in the page:
//   - which MIS rows are incidents at all (the zero-minute rule below);
//   - which items are open, and which are still waiting for a first reply —
//     the four KPI cards at the top of /maintenance, which are the first thing
//     the owner will check and must be provable without a database;
//   - that an incident which already has a ticket raised from it is ONE item,
//     never a ticket and an unrelated incident sitting apart in the same list;
//   - that "we could not read the answers" is a third state, never "unanswered".
//
// Relative import with the explicit .ts extension, not "@/lib/…": the path alias
// is a tsconfig/bundler feature `node --test` does not resolve, and this module
// has to be reachable by the test runner with no database and no build step.
import { isClosed, sortTickets } from "./downtimeShared.ts";

// ---------------------------------------------------------------------------
// Input shapes — structural, so a real IncidentRow/Ticket and a test fixture
// both satisfy them and nothing here has to import the prisma-backed modules.
// ---------------------------------------------------------------------------

/** The parts of an MIS hourly row (src/lib/downtime.ts IncidentRow) this needs. */
export interface InboxIncident {
  id: string;
  /** Total stoppage in the hour, all four delay buckets. */
  minutes: number;
  /** IST calendar day, "YYYY-MM-DD", or null on a row with no date. */
  date: string | null;
  /** MIS hour bucket, "06 - 07" (see misShiftHours.ts), or null. */
  hour: string | null;
}

/** The parts of a maintenance_ticket row (src/lib/maintenanceLog.ts Ticket) this needs. */
export interface InboxTicket {
  id: string;
  /** The downtime incident it was raised from, when it was raised from one. */
  misId: string | null;
  status: string;
  priority: string;
  /** ISO instant, genuine UTC — the column is written with Postgres now(). */
  raisedAt: string;
}

/** The parts of a downtime_response row this needs (src/lib/downtimeResponse.ts). */
export interface InboxResponse {
  status: string;
}

// ---------------------------------------------------------------------------
// Which MIS rows are incidents
// ---------------------------------------------------------------------------

/**
 * A row is an incident when the line actually stopped for some of that hour.
 *
 * getDowntimeReport() is deliberately more generous: it also keeps a zero-minute
 * row that carries an RCA number, a details note or a "breakdown? yes" flag,
 * because /mis is a REPORT and those rows are part of the record. Three of the
 * eight rows in the owner's screenshot are exactly that — "—" under Down, "No
 * delay" under detail. They are hours somebody logged as fine.
 *
 * An inbox is not a report. Padding a work queue with hours where nothing
 * happened is how the real ones stop being read, and a KPI card reading "8 open"
 * when five of them are non-events teaches the manager to distrust the number.
 * Those rows keep their place in the full log on /mis; they do not get a line in
 * somebody's queue.
 *
 * Rounded before the comparison so a stored 0.4 min — which the log renders as
 * "0m" — does not open a ticket-shaped hole nobody can close.
 */
export function isRealIncident(i: Pick<InboxIncident, "minutes">): boolean {
  const m = Number(i?.minutes);
  return Number.isFinite(m) && Math.round(m) > 0;
}

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------
// TWO CLOCKS IN ONE LIST, and mixing them silently is a wrong "raised 5 h ago".
// maintenance_ticket.raised_at is Postgres now(), i.e. a true UTC instant. The
// Mis row is naive IST — IST wall-clock stored as UTC — which is the convention
// downtime.ts builds its window from. Ordering a queue and printing an age both
// need ONE clock, so every item is normalised to a real UTC instant here, once,
// rather than in each renderer that happens to need it.

export const IST_OFFSET_MIN = 330;
const IST_OFFSET_MS = IST_OFFSET_MIN * 60_000;

/**
 * The UTC instant an MIS hour began, from its naive-IST date and hour bucket.
 * Null when the row has no date — see the sort note in buildInbox for what then
 * happens to it. The hour bucket is "HH - HH"; anything that does not start with
 * two digits falls back to midnight, which keeps the row on its own day rather
 * than dropping it out of the order entirely.
 */
export function incidentInstant(date: string | null, hour: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hh = /^\d{2}/.test(hour ?? "") ? (hour as string).slice(0, 2) : "00";
  const wall = Date.parse(`${date}T${hh}:00:00.000Z`);
  if (!Number.isFinite(wall)) return null;
  // `date` is the PRODUCTION day the downtime report puts the incident on, and
  // a production day runs 06:00 to 06:00 — so its 00:00-05:59 hours fall on the
  // NEXT calendar day. Without this the small hours were dated a day early and
  // every night-shift stoppage in the queue read a full 24 h more overdue than
  // it was, which is exactly backwards for the hours nobody is awake to answer.
  const h = Number(hh);
  const rollover = Number.isFinite(h) && h < 6 ? 86_400_000 : 0;
  return new Date(wall + rollover - IST_OFFSET_MS).toISOString();
}

/** The PRODUCTION day, "YYYY-MM-DD", for an instant — 06:00→06:00 IST, the day
 *  the floor works to and the day getDowntimeReport windows on. It was the IST
 *  CALENDAR day, which between midnight and 06:00 named a day that had not
 *  begun: the queue then asked for a range starting after it ended and rendered
 *  an empty incident list for the exact six hours a night shift is logging its
 *  stoppages. */
export function istDay(nowMs: number): string {
  return new Date(nowMs + IST_OFFSET_MS - 6 * 3600_000).toISOString().slice(0, 10);
}

/**
 * How far back the inbox looks by default.
 *
 * /mis defaults to TODAY, which is right for a report you open to ask "how did
 * today go". It is wrong for a queue: an unanswered stoppage from Tuesday is
 * more overdue than one from this morning, and a default that hides it is the
 * "Open 0" bug again in a smaller form. Seven days is /mis's own next preset, so
 * the two pages still speak the same language, and every preset there is offered
 * here as well for the manager who wants to look further back.
 */
export const INBOX_DEFAULT_DAYS = 7;

/** The default from/to pair, in the IST-day form getDowntimeReport() expects. */
export function inboxWindow(nowMs: number, days: number = INBOX_DEFAULT_DAYS): { from: string; to: string } {
  const span = Math.max(1, Math.floor(days));
  return { from: istDay(nowMs - (span - 1) * 86_400_000), to: istDay(nowMs) };
}

/**
 * How many items are RENDERED, however many were counted.
 *
 * THIS IS NOT THE SAME CAP getDowntimeReport() APPLIES, and the difference is the
 * whole point. That function returns `incidents` sliced to the first 300 unless
 * asked for `allIncidents`, and its slice is taken from a list sorted OLDEST
 * FIRST — so on the 90-day preset the page would have received the oldest 300
 * hours of the quarter and nothing from this week, then counted its KPI cards off
 * that. Measured against the live database on 2026-08-14: 992 real incidents in
 * 90 days, of which the capped call would have shown 235 — and today's stoppages
 * would not have been among them. A maintenance queue silently missing this
 * morning is the reported bug wearing a different hat, so the page now asks for
 * all of them, COUNTS all of them, and truncates here instead — after the sort
 * that puts open, urgent and oldest at the top, so what falls off the end is the
 * least urgent, and the page says how many did.
 */
export const INBOX_RENDER_LIMIT = 300;

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type InboxKind = "ticket" | "incident";

export interface InboxItem<I extends InboxIncident, T extends InboxTicket> {
  /** React key and identity. Prefixed because a ticket id and a mis id are both
   *  opaque strings and a collision would silently drop a row. */
  key: string;
  /** Where the fact ORIGINATED. A ticket raised from an hourly row is an
   *  "incident" — the stoppage came first — which is also what keeps the two
   *  count buckets disjoint. */
  kind: InboxKind;
  incident: I | null;
  ticket: T | null;
  /** The effective answer. null with known=true means nobody has answered yet;
   *  null with known=false means we could not find out. */
  status: string | null;
  /** False only when the responses lookup failed AND there is no ticket to read
   *  the answer off instead. */
  known: boolean;
  open: boolean;
  /** Open, and nobody has replied to it yet. */
  awaiting: boolean;
  /** Known to be finished. Distinct from !open: an unknown item is neither. */
  closed: boolean;
  /** Tickets carry a priority; an hourly row does not (see buildInbox). */
  priority: string;
  /** True UTC instant this item dates from, or null when the row has no date. */
  at: string | null;
}

export interface InboxCounts {
  /** Open tickets + open incidents. THE number the owner is checking. */
  open: number;
  openTickets: number;
  openIncidents: number;
  /** Open and priority "Line down" — tickets only; see buildInbox. */
  lineDown: number;
  /** Open with no reply of any kind yet. */
  awaiting: number;
  /** Everything in the window, counted whether or not it is rendered. */
  total: number;
  totalTickets: number;
  totalIncidents: number;
  /** items.length — what the board actually received. */
  shown: number;
  /** total - shown. Non-zero means the tail of the queue was truncated; the page
   *  must say so, or a manager reading "992 in this view" over a list of 300 will
   *  reasonably conclude the list is the truth and the number is broken. */
  hidden: number;
  /** Items whose answer could not be read. Counted here and NOWHERE else — not
   *  in open, not in awaiting — so a failed lookup can never inflate or deflate
   *  a figure the manager acts on. The page says the number out loud. */
  unknown: number;
}

export interface Inbox<I extends InboxIncident, T extends InboxTicket> {
  items: InboxItem<I, T>[];
  counts: InboxCounts;
}

/** An hourly row with no date cannot be placed by age. Park it at the END of the
 *  open queue rather than at the top, where a Date.parse of "" (0 → 1970) would
 *  make the one row nobody can date look like the most overdue thing on the floor. */
const UNDATED = "9999-12-31T00:00:00.000Z";

/** Both a ticket and an incident count as "nobody has replied" in these states.
 *  An absent downtime_response row is the incident's version of Pending. */
const isFirstReplyPending = (status: string | null) => status === null || status === "Pending";

/**
 * Build the queue.
 *
 * tickets === null means the maintenance_ticket table is not on this deployment
 * (fresh deploy, 0036 not run). That used to blank the whole page; it no longer
 * may, because the incidents do not live in that table and the manager still has
 * to answer them. The caller shows its banner and passes null; the incidents
 * come through regardless.
 *
 * responses === null means the LOOKUP failed — honour it. getDowntimeResponses()
 * returns null for exactly this and /mis renders a warning off it; an empty map
 * here would paint every answered incident as unanswered, and the KPI cards
 * would report a queue of work that is already done.
 */
export function buildInbox<I extends InboxIncident, T extends InboxTicket>(input: {
  tickets: readonly T[] | null;
  incidents: readonly I[];
  responses: Readonly<Record<string, InboxResponse | undefined>> | null;
  /** Rendering cap; the COUNTS are always over everything. Defaults to
   *  INBOX_RENDER_LIMIT so a caller cannot forget it and ship a quarter of
   *  hourly rows into a client component; pass null to render the lot. */
  limit?: number | null;
}): Inbox<I, T> {
  const tickets = input.tickets ?? [];
  const responses = input.responses;

  // ONE ROW PER FACT. maintenanceLog.ts keeps a ticket and the downtime response
  // in step in both directions when the ticket carries mis_id, so rendering them
  // as two independent rows would put the SAME conversation in the list twice —
  // the "two places to look for the same answer" this whole change exists to
  // end, reproduced inside a single card.
  const byMis = new Map<string, T>();
  for (const t of tickets) {
    if (!t.misId) continue;
    // First wins: listTickets() is ordered newest-first, and if two tickets were
    // ever raised from one hour the newest is the live one.
    if (!byMis.has(t.misId)) byMis.set(t.misId, t);
  }

  const items: InboxItem<I, T>[] = [];
  const merged = new Set<string>();

  for (const inc of input.incidents) {
    if (!inc?.id || !isRealIncident(inc)) continue;
    const ticket = byMis.get(inc.id) ?? null;
    if (ticket) merged.add(ticket.id);

    // WHERE THE ANSWER IS READ FROM, in order of what we can actually trust:
    //  1. the linked ticket, when there is one. The mirror in maintenanceLog.ts
    //     writes both rows on every answer, so the ticket IS the response — and
    //     it stays readable when downtime_response could not be read at all.
    //  2. the response row.
    //  3. nothing — which is only "unanswered" if the lookup succeeded.
    let status: string | null;
    let known: boolean;
    if (ticket) {
      status = ticket.status;
      known = true;
    } else if (responses === null) {
      status = null;
      known = false;
    } else {
      status = responses[inc.id]?.status ?? null;
      known = true;
    }

    const open = known && !isClosed(status ?? "Pending");
    items.push({
      key: `i:${inc.id}`,
      kind: "incident",
      incident: inc,
      ticket,
      status,
      known,
      open,
      awaiting: open && isFirstReplyPending(status),
      closed: known && !open,
      // An hourly row asserts no priority, and none is invented for it. The
      // stoppage is over by the time the row exists, so calling it "Line down"
      // would file history under the count that means "production is stopped
      // right now" — the one number nobody may be allowed to distrust. A ticket
      // raised from the incident does assert one, and that is used.
      priority: ticket?.priority ?? "Normal",
      at: incidentInstant(inc.date, inc.hour),
    });
  }

  for (const t of tickets) {
    if (merged.has(t.id)) continue; // already rendered as its incident
    const open = !isClosed(t.status);
    items.push({
      key: `t:${t.id}`,
      kind: "ticket",
      incident: null,
      ticket: t,
      status: t.status,
      known: true,
      open,
      awaiting: open && isFirstReplyPending(t.status),
      closed: !open,
      priority: t.priority,
      at: t.raisedAt,
    });
  }

  // ONE queue order for both kinds, borrowed whole from sortTickets(): open
  // before closed, then urgency, then oldest-first while open. Two sorts would
  // be two opinions about which job to walk to next.
  //
  // An unknown item sorts as Pending — it belongs in the open half of the list,
  // because "we could not read the answer" is not evidence the work is done.
  const ordered = sortTickets(
    items.map((it) => ({
      priority: it.priority,
      status: it.known ? it.status ?? "Pending" : "Pending",
      raisedAt: it.at ?? UNDATED,
      it,
    })),
  ).map((w) => w.it);

  // COUNTED OVER THE WHOLE QUEUE, BEFORE THE RENDER CAP BELOW. A KPI card is a
  // claim about the work, not about the list — "Open 300" under a list of 300
  // when 992 are open is the same lie as the "Open 0" that started this, only
  // harder to spot.
  const counts: InboxCounts = {
    open: 0, openTickets: 0, openIncidents: 0, lineDown: 0, awaiting: 0,
    total: ordered.length, totalTickets: 0, totalIncidents: 0,
    shown: ordered.length, hidden: 0, unknown: 0,
  };
  for (const it of ordered) {
    if (it.kind === "ticket") counts.totalTickets++; else counts.totalIncidents++;
    if (!it.known) { counts.unknown++; continue; }
    if (!it.open) continue;
    counts.open++;
    if (it.kind === "ticket") counts.openTickets++; else counts.openIncidents++;
    if (it.priority === "Line down") counts.lineDown++;
    if (it.awaiting) counts.awaiting++;
  }

  const limit = input.limit === undefined ? INBOX_RENDER_LIMIT : input.limit;
  const listed = limit != null && ordered.length > limit ? ordered.slice(0, limit) : ordered;
  counts.shown = listed.length;
  counts.hidden = ordered.length - listed.length;

  return { items: listed, counts };
}
