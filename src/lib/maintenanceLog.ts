// The maintenance log: anything from incharge up can raise a fault here, and
// maintenance answers it. Backed by the raw `maintenance_ticket` table (modeled
// in schema.prisma as MaintenanceTicket so `db push` won't DROP it; access stays
// raw SQL, like downtime_response and batch_range_edit).
//
// WHY IT EXISTS. Maintenance could previously only be asked something THROUGH a
// downtime incident, because downtime_response hangs off an MIS hourly row. A
// fault with no stoppage behind it — a bearing starting to sing, a guard that
// will not latch, a gauge reading wrong — had nowhere to go. Those are the ones
// worth catching before they become an incident.
//
// TWO-WAY WITH THE DOWNTIME RESPONSE, AND THAT IS THE HARD PART. A ticket
// raised from a downtime incident carries its `mis_id`. From then on the two
// rows are one fact in two places, so every write goes through here and updates
// both: answer on the maintenance page and the MIS card shows it; answer on the
// MIS card and the ticket closes. Left one-way, maintenance gets two inboxes and
// production two places to look for the same answer — and the one that is
// staler is the one someone will read.
//
// The status vocabulary is downtime_response's own (DOWNTIME_STATUSES), not a
// parallel set. Two spellings of "Resolved" is how a fault reads closed on one
// screen and open on the other.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { localId } from "@/lib/rbac";
import { writeDowntimeResponse } from "@/lib/downtimeResponse";
// The vocabulary and the queue rule live in the PURE module so a client
// component and `node --test` can both reach them — neither can import this
// file, which pulls in prisma.
import {
  DOWNTIME_STATUSES, PRIORITIES, isClosed, sortTickets,
  type DowntimeStatus, type Priority,
} from "@/lib/downtimeShared";

const db = prisma as any;

export { DOWNTIME_STATUSES, PRIORITIES, isClosed, sortTickets };
export type TicketStatus = DowntimeStatus;
export type { Priority };


export interface Ticket {
  id: string;
  ref: string;
  title: string;
  detail: string | null;
  area: string | null;
  priority: string;
  status: string;
  raisedBy: string | null;
  raisedAt: string;
  /** The downtime incident this came from, when it came from one. */
  misId: string | null;
  response: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  closedAt: string | null;
}

const fmt = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toTicket(r: any): Ticket {
  return {
    id: String(r.id),
    ref: String(r.ref),
    title: String(r.title),
    detail: r.detail ?? null,
    area: r.area ?? null,
    priority: String(r.priority),
    status: String(r.status),
    raisedBy: r.raised_by ?? null,
    raisedAt: fmt(r.raised_at) ?? new Date().toISOString(),
    misId: r.mis_id ?? null,
    response: r.response ?? null,
    respondedBy: r.responded_by ?? null,
    respondedAt: fmt(r.responded_at),
    closedAt: fmt(r.closed_at),
  };
}

/** MT-0001, MT-0002 … and MT-10000 when we get there — the padding is a floor,
 *  never a ceiling. */
const fmtRef = (n: number) => `MT-${String(n).padStart(4, "0")}`;

/** Next human reference: MT-0001, MT-0002 … Sequential rather than the cuid
 *  because this gets spoken across a noisy floor and written on a whiteboard.
 *
 *  THE SEQUENCE FIRST, THE SCAN ONLY AS A FALLBACK. Deriving the next number by
 *  reading the highest one broke in two ways at once:
 *
 *    THE RACE. Two incharges raising a fault in the same second both read the
 *    same MAX and both built the same ref; one of them lost the INSERT to the
 *    UNIQUE on `ref` and was told "could not raise it" for a fault that was
 *    real, which teaches a floor to stop reporting. nextval() cannot hand the
 *    same number out twice and does not wait on anyone else's open transaction.
 *
 *    THE JAM AT FIVE DIGITS. `ORDER BY ref DESC` is a TEXT sort, so the moment
 *    MT-10000 exists it sorts below MT-9999: the scan kept returning MT-9999 as
 *    the newest, kept proposing MT-10000, and every raise after the ten
 *    thousandth failed on the unique index for ever. The fallback below orders
 *    on the number, not the string.
 *
 *  scripts/0067-maintenance-ticket-ref-seq.sql creates the sequence. Until it is
 *  applied — and on any deployment that has not run it — the scan still answers,
 *  so both shapes work and neither needs the other. */
async function nextRef(): Promise<string> {
  try {
    const rows: any[] = await db.$queryRaw(Prisma.sql`
      SELECT nextval('maintenance_ticket_ref_seq')::bigint AS n`);
    const n = Number(rows[0]?.n);
    if (Number.isFinite(n) && n > 0) return fmtRef(n);
  } catch {
    // No sequence on this deployment yet (0067 not applied). Not an error —
    // fall through to the scan, which is what the table shipped with.
  }
  const rows: any[] = await db.$queryRaw(Prisma.sql`
    SELECT ref FROM maintenance_ticket
     WHERE ref ~ '^MT-[0-9]+$'
     ORDER BY substring(ref from 4)::bigint DESC
     LIMIT 1`);
  const last = rows[0]?.ref ? Number(String(rows[0].ref).slice(3)) : 0;
  return fmtRef(Number.isFinite(last) ? last + 1 : 1);
}

export interface NewTicket {
  title: string;
  detail?: string | null;
  area?: string | null;
  priority?: string | null;
  /** Set when raised from a downtime incident; links the two from birth. */
  misId?: string | null;
}

/** Raise a ticket. Returns null when the table is not there yet (fresh deploy,
 *  migration not run) so the page degrades to "feature off" rather than a 500. */
export async function raiseTicket(t: NewTicket, by: string | null): Promise<Ticket | null> {
  const title = (t.title ?? "").trim();
  if (!title) throw new Error("A one-line summary is required.");
  const priority = PRIORITIES.includes((t.priority ?? "") as Priority) ? t.priority! : "Normal";
  // THREE ATTEMPTS, and only ever against the ref collision. On a deployment
  // that has not run 0067 the reference still comes from a scan, so two
  // simultaneous raises can still pick the same number — and the UNIQUE on `ref`
  // is what catches it. Losing that coin toss should cost the incharge a
  // millisecond, not the fault report: the second attempt reads a MAX that now
  // includes the winner. Three is generous for a table that sees a handful of
  // rows a day; a fourth collision means something other than a race.
  for (let attempt = 1; ; attempt++) {
    try {
      const ref = await nextRef();
      const rows: any[] = await db.$queryRaw(Prisma.sql`
        INSERT INTO maintenance_ticket (id, ref, title, detail, area, priority, status, raised_by, raised_at, mis_id, updated_at)
        VALUES (${localId("mt")}, ${ref}, ${title}, ${(t.detail ?? "")
          .trim() || null}, ${(t.area ?? "").trim() || null}, ${priority}, 'Pending', ${by}, now(), ${t.misId || null}, now())
        RETURNING *`);
      return rows[0] ? toTicket(rows[0]) : null;
    } catch (e) {
      if (missingTable(e)) return null;
      if (duplicateRef(e) && attempt < 3) continue;
      throw e;
    }
  }
}

/** Postgres 23505 on the UNIQUE over `ref` — i.e. somebody else took the number
 *  between our read and our insert. Narrow deliberately: any OTHER unique
 *  violation on this table is a bug we must not retry into a loop. */
function duplicateRef(e: unknown): boolean {
  const meta = (e as { meta?: { code?: string } })?.meta;
  const msg = String((e as Error)?.message ?? e);
  return (meta?.code === "23505" || /duplicate key value/i.test(msg))
    && /maintenance_ticket.*ref|ref.*maintenance_ticket/i.test(msg);
}

/**
 * Answer a ticket — and keep the downtime incident in step.
 *
 * The downtime write is deliberately NOT inside a transaction with the ticket
 * write. downtime_response may not exist on a deployment that has not run 0029,
 * and a ticket answered is worth keeping even if the mirror fails; the MIS card
 * falls back to its own row either way. The reverse (a downtime response with no
 * ticket) is the pre-existing behaviour and is fine.
 *
 * BUT NOT SILENTLY. Returns what became of the mirror so a caller can say so —
 * see MirrorOutcome.
 */
export async function answerTicket(
  id: string,
  status: string,
  response: string | null,
  by: string | null,
): Promise<MirrorOutcome> {
  if (!id) return "none";
  if (!DOWNTIME_STATUSES.includes(status as DowntimeStatus)) {
    throw new Error(`Unknown status "${status}".`);
  }
  const note = (response ?? "").trim() || null;
  const rows: any[] = await db.$queryRaw(Prisma.sql`
    UPDATE maintenance_ticket
       SET status = ${status}, response = ${note}, responded_by = ${by}, responded_at = now(),
           closed_at = CASE WHEN ${isClosed(status)} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE id = ${id}
    RETURNING mis_id`);
  const misId = rows[0]?.mis_id as string | null | undefined;
  // THE MIRROR. A ticket that came from a downtime incident answers that
  // incident too, or the MIS card goes on showing it unattended.
  if (!misId) return "none";
  try {
    await writeDowntimeResponse(misId, status, note, by);
    return "ok";
  } catch (e) {
    // NARROWED, the way delayReclassLog.ts narrows its own. `.catch(() => {})`
    // read every failure as "nothing to mirror": a dropped column, a type
    // mismatch, a dead connection — all of them left the MIS card showing the
    // fault unattended with nothing anywhere saying why, and the maintenance
    // page cheerfully answering "Saved." Only a downtime_response table that is
    // not there is benign, and that is one specific deployment state (0029 not
    // run), not a category of accident.
    const msg = String((e as Error)?.message ?? e);
    if ((e as any)?.meta?.code === "42P01"
      || /relation "(?:public\.)?downtime_response" does not exist/i.test(msg)) return "off";
    console.error("answerTicket: downtime mirror failed for mis", misId, e);
    return "failed";
  }
}

/** What became of the downtime mirror on an answered ticket. The ticket itself
 *  is saved in every one of these cases — see answerTicket's header for why the
 *  two writes are deliberately not one transaction.
 *
 *    none    the ticket carries no mis_id; there was nothing to mirror.
 *    ok      the downtime response was written.
 *    off     downtime_response does not exist here (0029 not run) — feature off.
 *    failed  the mirror genuinely failed. The MIS card is now STALE and someone
 *            has to answer it there too. */
export type MirrorOutcome = "none" | "ok" | "off" | "failed";

/**
 * The other direction: the MIS card was answered, so bring its ticket along.
 *
 * Called by the downtime respond action AFTER its own write. Silent when the
 * incident has no ticket, which is the common case.
 */
export async function mirrorDowntimeToTicket(
  misId: string,
  status: string,
  note: string | null,
  by: string | null,
): Promise<void> {
  if (!misId) return;
  try {
    await db.$executeRaw(Prisma.sql`
      UPDATE maintenance_ticket
         SET status = ${status}, response = ${note}, responded_by = ${by}, responded_at = now(),
             closed_at = CASE WHEN ${isClosed(status)} THEN now() ELSE NULL END,
             updated_at = now()
       WHERE mis_id = ${misId}`);
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

/** Every ticket, ordered for working through. Null when the table is absent.
 *
 *  TWO READS, ONE LIST, AND THE CAP NEVER DECIDES WHAT IS OPEN. This was a
 *  single `ORDER BY raised_at DESC LIMIT 500`, and buildInbox() counts the Open
 *  and Awaiting KPI cards off exactly the rows it is handed — so the 501st-newest
 *  ticket stopped being counted as open. The row that falls off that end is by
 *  definition the OLDEST one, i.e. the fault raised months ago and never
 *  answered: precisely the ticket the queue exists to keep shouting about, and
 *  the only one whose disappearance nobody would notice, because a card reading
 *  "Open 3" looks like good news.
 *
 *  So every unclosed row comes back regardless of age, and the newest 500 of
 *  everything comes back beside it for the history. closed_at is the same fact
 *  as isClosed(status) — answerTicket and mirrorDowntimeToTicket each write the
 *  two in one statement — so the filter cannot disagree with the queue's own
 *  idea of closed. The open set is small by nature: it is what maintenance still
 *  owes the floor, and if it is ever big enough to be a payload problem, that is
 *  a fact the manager needs to see, not one to cap away. */
export async function listTickets(): Promise<Ticket[] | null> {
  try {
    const [open, recent]: any[][] = await Promise.all([
      db.$queryRaw(Prisma.sql`
        SELECT * FROM maintenance_ticket WHERE closed_at IS NULL ORDER BY raised_at DESC`),
      db.$queryRaw(Prisma.sql`
        SELECT * FROM maintenance_ticket ORDER BY raised_at DESC LIMIT 500`),
    ]);
    // Keyed by id: the two reads overlap on every recent open ticket, and one
    // fault must never render as two cards.
    const byId = new Map<string, Ticket>();
    for (const r of [...open, ...recent]) {
      const t = toTicket(r);
      byId.set(t.id, t);
    }
    return sortTickets([...byId.values()]);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** Tickets for a set of downtime incidents, keyed by mis_id — so the MIS card
 *  can show "MT-0007 · Attended" against the row it belongs to. Null means the
 *  lookup itself failed and the caller must treat it as unknown, not none. */
export async function ticketsByMisId(misIds: string[]): Promise<Map<string, Ticket> | null> {
  const ids = [...new Set(misIds.filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const rows: any[] = await db.$queryRaw(Prisma.sql`
      SELECT * FROM maintenance_ticket WHERE mis_id = ANY(${ids}::text[])`);
    const out = new Map<string, Ticket>();
    for (const r of rows) if (r.mis_id) out.set(String(r.mis_id), toTicket(r));
    return out;
  } catch (e) {
    if (missingTable(e)) return new Map();
    return null;
  }
}

/** Postgres 42P01. A deployment that has not run 0036 should show the feature
 *  as off, not fall over — the same courtesy downtimeResponse extends. */
function missingTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = String((e as Error)?.message ?? "");
  return code === "42P01" || /relation .*maintenance_ticket.* does not exist/i.test(msg);
}
