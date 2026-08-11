// The maintenance log: anything from incharge up can raise a fault here, and
// maintenance answers it. Backed by the raw `maintenance_ticket` table (no
// Prisma model, like downtime_response and batch_range_edit).
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

/** Next human reference: MT-0001, MT-0002 … Sequential rather than the cuid
 *  because this gets spoken across a noisy floor and written on a whiteboard. */
async function nextRef(): Promise<string> {
  const rows: any[] = await db.$queryRaw(Prisma.sql`
    SELECT ref FROM maintenance_ticket WHERE ref LIKE 'MT-%' ORDER BY ref DESC LIMIT 1`);
  const last = rows[0]?.ref ? Number(String(rows[0].ref).slice(3)) : 0;
  const n = Number.isFinite(last) ? last + 1 : 1;
  return `MT-${String(n).padStart(4, "0")}`;
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
    throw e;
  }
}

/**
 * Answer a ticket — and keep the downtime incident in step.
 *
 * The downtime write is deliberately NOT inside a transaction with the ticket
 * write. downtime_response may not exist on a deployment that has not run 0029,
 * and a ticket answered is worth keeping even if the mirror fails; the MIS card
 * falls back to its own row either way. The reverse (a downtime response with no
 * ticket) is the pre-existing behaviour and is fine.
 */
export async function answerTicket(
  id: string,
  status: string,
  response: string | null,
  by: string | null,
): Promise<void> {
  if (!id) return;
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
  if (misId) {
    await writeDowntimeResponse(misId, status, note, by).catch(() => {});
  }
}

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

/** Every ticket, ordered for working through. Null when the table is absent. */
export async function listTickets(): Promise<Ticket[] | null> {
  try {
    const rows: any[] = await db.$queryRaw(Prisma.sql`
      SELECT * FROM maintenance_ticket ORDER BY raised_at DESC LIMIT 500`);
    return sortTickets(rows.map(toTicket));
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
