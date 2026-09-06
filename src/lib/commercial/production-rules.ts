// Production requests and the planning queue — the PURE half. The shortfall
// arithmetic, where a new request lands in the queue, what a drag-reorder
// writes, which body fields need the `plan` action, what each status change
// stamps, and the "received since the request" hint — all run by
// tests/commercialProduction.test.ts under node --test.
//
// The only import is lib/thickness.ts, itself pure (no server modules), the
// way access-rules.ts imports lib/roles.ts: the hint has to compare the stored
// slab thickness ('20mm', '2cm', '2 cm') with the request's canonical '2 cm',
// and re-stating canonThickness here would let the two drift.
import { canonThickness } from "../thickness.ts";

export const PRODUCTION_STATUSES = ["QUEUED", "SCHEDULED", "IN_PRODUCTION", "PRODUCED", "CANCELLED"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

/** The statuses that are still in the queue. PRODUCED and CANCELLED are history. */
export const OPEN_STATUSES: readonly ProductionStatus[] = ["QUEUED", "SCHEDULED", "IN_PRODUCTION"];

export function isProductionStatus(v: unknown): v is ProductionStatus {
  return typeof v === "string" && (PRODUCTION_STATUSES as readonly string[]).includes(v);
}

export function isTerminalRequest(status: string): boolean {
  return status === "PRODUCED" || status === "CANCELLED";
}

/** How many slabs production must make: required minus available, never
 *  negative, whole slabs. Non-numbers count as zero so a blank field cannot
 *  raise a request for NaN slabs. */
export function shortfall(required: unknown, available: unknown): number {
  const r = Math.round(Number(required));
  const a = Math.round(Number(available));
  const req = Number.isFinite(r) ? Math.max(0, r) : 0;
  const av = Number.isFinite(a) ? Math.max(0, a) : 0;
  return Math.max(0, req - av);
}

/** Where a new request lands: after the last one still in the queue. History
 *  rows keep their old priorities but do not push the queue down, so the
 *  numbers stay small and the planner's drag order stays 1..n. */
export function nextPriority(existing: { priority: number; status: string }[]): number {
  let max = 0;
  for (const r of existing) {
    if (isTerminalRequest(r.status)) continue;
    if (Number.isFinite(r.priority) && r.priority > max) max = r.priority;
  }
  return max + 1;
}

/**
 * The reorder write: the ids the planner sent, in the order sent, become
 * priorities 1..n. Only ids that exist in `allRows` are written (a stale
 * screen naming a request that was produced meanwhile writes nothing for it);
 * duplicates count once; rows not named keep the priority they have. Returns
 * the patches to apply, in order.
 */
export function reorderPriorities(ids: unknown, allRows: { id: string }[]): { id: string; priority: number }[] {
  if (!Array.isArray(ids)) return [];
  const known = new Set(allRows.map((r) => r.id));
  const seen = new Set<string>();
  const out: { id: string; priority: number }[] = [];
  for (const v of ids) {
    const id = typeof v === "string" ? v.trim() : "";
    if (!id || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, priority: out.length + 1 });
  }
  return out;
}

/** ▲ / ▼ on the screen: the same list with the row at `index` moved one step. */
export function moveInList<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [row] = out.splice(index, 1);
  out.splice(to, 0, row);
  return out;
}

/** A drop: `dragged` takes `target`'s place, everything between shifts. Unknown
 *  ids or a drop on itself leave the order alone. */
export function reorderOnDrop(ids: readonly string[], dragged: string, target: string): string[] {
  const from = ids.indexOf(dragged);
  const to = ids.indexOf(target);
  if (from === -1 || to === -1 || from === to) return [...ids];
  const out = [...ids];
  out.splice(from, 1);
  out.splice(to, 0, dragged);
  return out;
}

/** Only a login with `plan` reorders the queue or changes a status. */
export function canChangeStatus(actions: readonly string[]): boolean {
  return actions.includes("plan");
}

/** Anyone who may write may add a note to a request. */
export function canEditNotes(actions: readonly string[]): boolean {
  return actions.includes("write") || actions.includes("plan");
}

/** The PATCH fields that are the planner's: a status, the cleaning note, the
 *  planned batch, the produced batch keys. `notes` is Commercial's and needs
 *  only `write`. The route refuses a body naming any planner field without
 *  `plan`, whatever else it carries. */
export const PLAN_FIELDS = ["status", "cleaningNote", "plannedBatch", "producedBatchKeys"] as const;
export function patchNeedsPlan(body: Record<string, unknown>): boolean {
  return PLAN_FIELDS.some((k) => body[k] !== undefined);
}

/**
 * Which status moves the queue allows. Forward along the line, back one step
 * when a plan changes, and CANCELLED from anywhere open. PRODUCED and
 * CANCELLED are final — a produced request that was wrong is a new request.
 */
const NEXT: Record<ProductionStatus, readonly ProductionStatus[]> = {
  QUEUED:        ["SCHEDULED", "IN_PRODUCTION", "CANCELLED"],
  SCHEDULED:     ["IN_PRODUCTION", "QUEUED", "CANCELLED"],
  IN_PRODUCTION: ["PRODUCED", "SCHEDULED", "CANCELLED"],
  PRODUCED:      [],
  CANCELLED:     [],
};

export function canMoveStatus(from: string, to: string): { ok: true } | { ok: false; reason: string } {
  if (!isProductionStatus(to)) return { ok: false, reason: `Unknown status ${String(to)}` };
  if (!isProductionStatus(from)) return { ok: false, reason: `Unknown status ${String(from)}` };
  if (from === to) return { ok: false, reason: `Already ${label(to)}` };
  if (isTerminalRequest(from)) return { ok: false, reason: `A ${label(from).toLowerCase()} request cannot change` };
  if (!NEXT[from].includes(to)) return { ok: false, reason: `${label(from)} → ${label(to)} is not a step the queue takes` };
  return { ok: true };
}

export function label(status: string): string {
  switch (status) {
    case "QUEUED": return "Queued";
    case "SCHEDULED": return "Scheduled";
    case "IN_PRODUCTION": return "In production";
    case "PRODUCED": return "Produced";
    case "CANCELLED": return "Cancelled";
    default: return status;
  }
}

/** The buttons a row offers, in the order they read on screen. */
export function nextStatusButtons(from: string): { to: ProductionStatus; label: string }[] {
  if (!isProductionStatus(from)) return [];
  const words: Partial<Record<ProductionStatus, string>> = { SCHEDULED: "Schedule", IN_PRODUCTION: "Start", PRODUCED: "Produced", CANCELLED: "Cancel", QUEUED: "Back to queue" };
  return NEXT[from].map((to) => ({ to, label: words[to] ?? label(to) }));
}

/**
 * The Prisma patch for a status change: the status plus the stamp that step
 * takes. PRODUCED also records who; an earlier stamp is never cleared (a
 * request sent back to SCHEDULED keeps startedAt as history).
 */
export function statusPatch(to: ProductionStatus, now: Date, byId: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: to };
  if (to === "SCHEDULED") patch.scheduledAt = now;
  if (to === "IN_PRODUCTION") patch.startedAt = now;
  if (to === "PRODUCED") { patch.producedAt = now; patch.producedById = byId; }
  if (to === "CANCELLED") patch.cancelledAt = now;
  return patch;
}

/** producedBatchKeys from a body: strings, trimmed, non-empty, de-duplicated. */
export function parseBatchKeys(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === "string" ? x.trim() : String(x ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The queue list's status filter: a comma list from the query, validated;
 *  nothing valid → the three open statuses. */
export function parseStatusFilter(raw: unknown): ProductionStatus[] {
  const parts = String(raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const valid = parts.filter(isProductionStatus) as ProductionStatus[];
  const unique = Array.from(new Set(valid));
  return unique.length ? unique : [...OPEN_STATUSES];
}

/** A list of only history statuses is read newest-first; anything with an
 *  open status is the queue and reads by priority. */
export function historyOnly(statuses: readonly string[]): boolean {
  return statuses.length > 0 && statuses.every(isTerminalRequest);
}

// ───────────────────── "received since the request" hint ─────────────────────

export interface FinishedSlabLike {
  source: string | null;
  design: string | null;
  slabThickness: string | null;
  firstSeenAt: string | Date;
}

export interface RequestLike {
  design: string;
  thickness: string;
  raisedAt: string | Date;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The stored design mapped through the alias table (variant → canonical),
 *  case-insensitively; a design with no alias is its own canonical. */
export function canonicalWith(aliases: Record<string, string>, design: string | null | undefined): string {
  const raw = (design ?? "").trim();
  if (!raw) return "";
  const hit = aliases[raw] ?? aliases[raw.toLowerCase()] ?? Object.entries(aliases).find(([k]) => norm(k) === norm(raw))?.[1];
  return (hit ?? raw).trim();
}

/**
 * Which finished-goods rows answer "has production run since this request?":
 * QC-autolinked (a real QC pass, not a bulk upload or a typed-in row), same
 * canonical design, same canonical thickness, first seen at or after the
 * request was raised. Pure on plain arrays; the route fetches candidates by
 * design and date and runs this for the thickness and the exact rule.
 */
export function suggestMatches<T extends FinishedSlabLike>(rows: T[], request: RequestLike, aliases: Record<string, string> = {}): T[] {
  const wantDesign = norm(canonicalWith(aliases, request.design));
  const wantThk = canonThickness(request.thickness);
  const since = typeof request.raisedAt === "string" ? new Date(request.raisedAt).getTime() : request.raisedAt.getTime();
  if (!wantDesign || !Number.isFinite(since)) return [];
  return rows.filter((r) => {
    if ((r.source ?? "") !== "QC_AUTOLINK") return false;
    if (norm(canonicalWith(aliases, r.design)) !== wantDesign) return false;
    if (wantThk && canonThickness(r.slabThickness) !== wantThk) return false;
    const t = typeof r.firstSeenAt === "string" ? new Date(r.firstSeenAt).getTime() : r.firstSeenAt.getTime();
    return Number.isFinite(t) && t >= since;
  });
}

/** Every spelling of a design the alias table knows, for a database `IN`:
 *  the canonical itself, the raw request spelling, and every variant whose
 *  canonical matches. */
export function designVariants(aliases: Record<string, string>, design: string): string[] {
  const canonical = canonicalWith(aliases, design);
  const out = new Set<string>([design.trim(), canonical]);
  for (const [variant, canon] of Object.entries(aliases)) if (norm(canon) === norm(canonical)) out.add(variant.trim());
  return Array.from(out).filter(Boolean);
}
