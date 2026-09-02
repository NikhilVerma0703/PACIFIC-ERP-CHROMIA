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

// ---------------------------------------------------------------------------
// Breakdown trade attribution
// ---------------------------------------------------------------------------
// MIS records breakdown as ONE minutes column — "mechanical OR electrical",
// the trades are not split in the data, which is also why the scoreboard
// measures both incharges on the same figure. The only trade signal an hour
// carries is its typed reasons ("ELECTRICAL - MACHINE FAILURE",
// "MECHANICAL - BELT ISSUE"), so any split is an ATTRIBUTION from those, not a
// measurement — and it must say so when it cannot tell.
//
// Keywords follow classifyReason's conventions in downtime.ts: HMI and supply
// faults are the electrician's; belts are the fitter's.
const ELEC_HINTS = ["ELECTRICAL", "HMI", "SUPPLY", "FAULT ALARM"];
const MECH_HINTS = ["MECHANICAL", "BELT"];

export type BreakdownTrade = "electrical" | "mechanical" | "mixed" | "unknown";

/** Which trade an hour's breakdown minutes belong to, judged from its reasons.
 *  "mixed" = reasons name BOTH trades (one minutes figure, two culprits — the
 *  hour cannot be split honestly). "unknown" = no trade-naming reason at all. */
export function classifyBreakdownTrade(reasons: readonly string[]): BreakdownTrade {
  let elec = false, mech = false;
  for (const r of reasons) {
    const u = String(r ?? "").toUpperCase();
    if (ELEC_HINTS.some((h) => u.includes(h))) elec = true;
    if (MECH_HINTS.some((h) => u.includes(h))) mech = true;
  }
  if (elec && mech) return "mixed";
  if (elec) return "electrical";
  if (mech) return "mechanical";
  return "unknown";
}

/* ------------------------------------------------ capacity: the invariant */
// ACHIEVABLE CAN NEVER BE BELOW ACTUAL. Achievable is what the line could have
// made given the downtime it had; it made `actual`, so achievable is at least
// that. The downtime page broke this for August 2026: target 7,969, delay
// minutes charged at the standard rate came to 1,778 slabs, but the month's
// whole shortfall against target was 1,707 - the minutes claimed MORE capacity
// than was ever missing, achievable printed 6,191 under an actual of 6,262, and
// "lost" clamped to zero without saying why.
//
// The claim is bounded by the shortfall. If downtime minutes account for the
// whole gap (and 71 slabs over, as in August), the cost IS the gap, achievable
// equals actual, and the unexplained loss is zero - which is the honest reading
// of that model, and the page now says the cap applied and by how much. If the
// line beat its standard outright, nothing was lost to downtime in capacity
// terms, however many minutes were logged.
//
// WHY THE MINUTES OVERCLAIM. A process or cleaning delay does not stop the line
// dead - the hour that logged 40 minutes of process delay still pressed slabs -
// but the model charges every logged minute at the full rate. The bound is the
// correction that keeps the three bars consistent without pretending to know
// how much of each delay minute the line kept running through.
export interface CapacityFigures {
  /** target - downtimeCost, never below actual (and never below 0). */
  achievable: number;
  /** achievable - actual: the shortfall the logged downtime does NOT explain. */
  lost: number;
  /** The slabs charged to downtime after the bound. */
  downtimeCost: number;
  /** What the delay minutes claimed before the bound. */
  downtimeCostRaw: number;
  /** True when the raw claim exceeded the shortfall and was cut back to it. */
  costCapped: boolean;
}

export function capacityFigures(target: number, downtimeCostRaw: number, actual: number): CapacityFigures {
  const t = Math.max(0, target), raw = Math.max(0, downtimeCostRaw), a = Math.max(0, actual);
  const shortfall = Math.max(0, t - a);
  const downtimeCost = Math.min(raw, shortfall);
  const achievable = Math.max(a, t - downtimeCost);
  return {
    achievable,
    lost: Math.max(0, achievable - a),
    downtimeCost,
    downtimeCostRaw: raw,
    costCapped: raw > shortfall,
  };
}
