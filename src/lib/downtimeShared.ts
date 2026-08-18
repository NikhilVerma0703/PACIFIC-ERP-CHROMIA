// Pure downtime constants + formatters, importable from CLIENT components.
// lib/downtime.ts re-exports these so its existing (server-side) importers are
// untouched — but downtime.ts itself pulls in prisma, which a client bundle
// must never do, hence this split.

export const DELAY_FIELDS = [
  { key: "process", label: "Process delay", col: "processDelayDurationMinutes" },
  { key: "cleaning", label: "Cleaning", col: "cleaningDelayDurationMinutes" },
  { key: "breakdown", label: "Breakdown (mech/elec)", col: "breakdownDelayDurationMechanicalOrElectricalMinutes" },
  { key: "powerout", label: "Power-out", col: "poweroutDelayDurationMinutes" },
] as const;
export const DELAY_LABEL: Record<string, string> = Object.fromEntries(DELAY_FIELDS.map((d) => [d.key, d.label]));

/** "750 min" -> "12h 30m" */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// ---------------------------------------------------------------------------
// Maintenance vocabulary and queue rules
// ---------------------------------------------------------------------------
// ONE vocabulary for the downtime response and the maintenance log, because
// they are two views of the same conversation. Two spellings of "Resolved" is
// how a fault reads closed on one screen and open on the other.
//
// These live HERE rather than in downtimeResponse.ts / maintenanceLog.ts for
// the reason at the top of this file: both of those pull in prisma, so neither
// a client component nor `node --test` can reach them. Same split as
// shiftScoreMath.ts against shiftScore.ts.

export const DOWNTIME_STATUSES = ["Pending", "Attended", "Resolved", "Not required"] as const;
export type DowntimeStatus = (typeof DOWNTIME_STATUSES)[number];

/** "Line down" is not "very high" — it is a different thing, and it is why the
 *  queue is not sorted by age alone. */
export const PRIORITIES = ["Line down", "High", "Normal", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Lower is more urgent, so a plain ascending sort is correct. */
const PRIORITY_RANK: Record<string, number> = { "Line down": 0, High: 1, Normal: 2, Low: 3 };

/** A ticket in one of these is done and drops out of the open queue.
 *
 *  ATTENDED IS NOT CLOSED, deliberately: somebody looked at it, the machine is
 *  not necessarily fixed. Treating it as done is how a half-repair disappears. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["Resolved", "Not required"]);

export function isClosed(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

/** The shape the queue sort needs. Structural, so a database row and a test
 *  fixture both satisfy it. */
export interface QueueItem {
  priority: string;
  status: string;
  raisedAt: string;
}

/**
 * Order the queue the way it has to be worked: open first, then urgency, then
 * age. Pinned in code rather than left to whatever SQL returned, because this
 * decides which fault a fitter walks to next.
 */
export function sortTickets<T extends QueueItem>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    // Open before closed whatever the priority: a resolved line-down is
    // history, an open Low is somebody still waiting.
    const ac = isClosed(a.status) ? 1 : 0;
    const bc = isClosed(b.status) ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const ap = PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.Normal;
    const bp = PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.Normal;
    if (ap !== bp) return ap - bp;
    const at = Date.parse(a.raisedAt) || 0;
    const bt = Date.parse(b.raisedAt) || 0;
    // Oldest first while open — longest-waiting is most overdue. Closed reads
    // better newest-first: it is a record, not a queue.
    return ac ? bt - at : at - bt;
  });
}
