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
// The shade rule (answer 13) is the design master's; the queue applies it row
// by row and must not restate it, or the two would drift.
import { cleaningHoursFor, isAbruptJump, parseShade, type PlanningSettingsLike } from "./design-rules.ts";

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

/** Anyone who may write may add a note to a request, and — answer 15 — edit
 *  the cleaning note and the planned batch by hand. */
export function canEditNotes(actions: readonly string[]): boolean {
  return actions.includes("write") || actions.includes("plan");
}

/** Only a login with `plan` edits the planned slabs / hours (answer 13). */
export function canEditPlan(actions: readonly string[]): boolean {
  return actions.includes("plan");
}

/** The PATCH fields that are the planner's: a status, the produced batch keys
 *  and — answer 13 — the plan's own figures. `notes`, the cleaning note and
 *  the planned batch are the hand-edits answer 15 gives anyone who may write.
 *  The route refuses a body naming any planner field without `plan`,
 *  whatever else it carries. */
export const PLAN_FIELDS = ["status", "producedBatchKeys", "plannedSlabs", "plannedHours", "cleaningHours"] as const;
export const WRITE_FIELDS = ["notes", "cleaningNote", "plannedBatch"] as const;
export function patchNeedsPlan(body: Record<string, unknown>): boolean {
  return PLAN_FIELDS.some((k) => body[k] !== undefined);
}

// ───────────────────────── the plan's own figures (answer 13) ────────────────

export const PLAN_FIGURE_FIELDS = ["plannedSlabs", "plannedHours", "cleaningHours"] as const;
export type PlanFigureField = (typeof PLAN_FIGURE_FIELDS)[number];
export type PlanFigures = Partial<Record<PlanFigureField, number | null>>;

/**
 * The figures a body asks to set, only for the keys it names. Slabs are whole
 * and hours are kept to one decimal (the columns are Decimal(6,1) / (4,1));
 * negatives and non-numbers are refused rather than stored as zero, because a
 * zero written by a typo is a reduction the change log would then record as
 * the planner's decision. Null or "" clears the figure.
 */
export function parsePlanFigures(body: Record<string, unknown>): { ok: true; figures: PlanFigures } | { ok: false; reason: string } {
  const figures: PlanFigures = {};
  for (const k of PLAN_FIGURE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, k) || body[k] === undefined) continue;
    const raw = body[k];
    if (raw === null || raw === "") { figures[k] = null; continue; }
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0) return { ok: false, reason: `${figureLabel(k)} must be a number of zero or more` };
    figures[k] = k === "plannedSlabs" ? Math.round(n) : Math.round(n * 10) / 10;
  }
  return { ok: true, figures };
}

export function figureLabel(field: string): string {
  switch (field) {
    case "plannedSlabs": return "Planned slabs";
    case "plannedHours": return "Planned hours";
    case "cleaningHours": return "Cleaning hours";
    default: return field;
  }
}

export interface PlanChangeRowInput {
  requestId: string;
  field: PlanFigureField;
  fromValue: number | null;
  toValue: number | null;
  delta: number;
  reason: string | null;
  status: "OPEN" | "ADDED_BACK";
  changedById: string | null;
  changedByName: string | null;
  changedAt: Date;
  resolvedAt: Date | null;
  resolvedById: string | null;
}

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The commercial_production_plan_change rows an edit writes: one per figure
 * that actually changed, with from / to / delta. A REDUCTION is inserted OPEN
 * — it is what the "Planned but not scheduled" panel shows, so a slab the
 * planner took off the plan is never simply gone (answer 13). An increase is
 * logged too, for the history, but arrives already resolved as ADDED_BACK:
 * nothing was taken away, so there is nothing to add back or remove.
 *
 * A figure that was never set (null) and is set now counts from zero; a
 * figure cleared to null counts as reduced to zero. Same value in, same
 * value out (or null → null) writes nothing.
 */
export function planChanges(
  before: Partial<Record<PlanFigureField, unknown>>,
  after: PlanFigures,
  by: { id: string | null; name: string | null },
  opts: { requestId: string; now: Date; reason?: string | null },
): PlanChangeRowInput[] {
  const out: PlanChangeRowInput[] = [];
  for (const field of PLAN_FIGURE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(after, field)) continue;
    const from = asNum(before[field]);
    const to = after[field] ?? null;
    if (from === to) continue;
    const delta = Math.round(((to ?? 0) - (from ?? 0)) * 10) / 10;
    if (delta === 0) continue;
    const reduction = delta < 0;
    out.push({
      requestId: opts.requestId,
      field,
      fromValue: from,
      toValue: to,
      delta,
      reason: opts.reason ?? null,
      status: reduction ? "OPEN" : "ADDED_BACK",
      changedById: by.id,
      changedByName: by.name,
      changedAt: opts.now,
      resolvedAt: reduction ? null : opts.now,
      resolvedById: reduction ? null : by.id,
    });
  }
  return out;
}

export const CHANGE_ACTIONS = ["addBack", "remove"] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export function parseChangeAction(v: unknown): ChangeAction | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "addBack" || s === "add_back" || s === "add-back") return "addBack";
  if (s === "remove") return "remove";
  return null;
}

export interface PlanChangeLike {
  field: string;
  fromValue: unknown;
  toValue: unknown;
  status: string;
}

/**
 * What resolving an OPEN reduction does. Add back restores the figure the
 * plan had BEFORE the reduction and marks the row ADDED_BACK; remove leaves
 * the plan as it is and marks the row REMOVED, so the panel stops asking. A
 * row that is not OPEN was already answered — answering it twice would
 * restore a figure somebody has since changed again.
 */
export function resolveChange(change: PlanChangeLike, action: ChangeAction):
  | { ok: true; status: "ADDED_BACK"; restore: { field: PlanFigureField; value: number | null } }
  | { ok: true; status: "REMOVED"; restore: null }
  | { ok: false; reason: string } {
  if (change.status !== "OPEN") {
    const word = change.status === "ADDED_BACK" ? "added back" : change.status === "REMOVED" ? "removed" : String(change.status).toLowerCase();
    return { ok: false, reason: `This change was already ${word}.` };
  }
  if (!(PLAN_FIGURE_FIELDS as readonly string[]).includes(change.field)) return { ok: false, reason: `Unknown plan field ${change.field}` };
  if (action === "remove") return { ok: true, status: "REMOVED", restore: null };
  return { ok: true, status: "ADDED_BACK", restore: { field: change.field as PlanFigureField, value: asNum(change.fromValue) } };
}

/**
 * Answer 15: a request can be deleted by hand. Anyone who may write can
 * delete one that has not reached the plant; once it is IN_PRODUCTION or
 * PRODUCED the plant has acted on it, and only a planner may take that record
 * away. CANCELLED is history nobody acted on — write may tidy it.
 */
export function canDeleteRequest(status: string, actions: readonly string[]): { ok: true } | { ok: false; reason: string } {
  if (actions.includes("plan")) return { ok: true };
  if (!actions.includes("write")) return { ok: false, reason: "Not available for this login." };
  if (status === "IN_PRODUCTION" || status === "PRODUCED") {
    return { ok: false, reason: `A ${label(status).toLowerCase()} request can only be deleted by production planning.` };
  }
  return { ok: true };
}

/** The figures a request is raised with (answer 13): the plan starts as the
 *  shortfall, the shade is the design master's, and the cleaning hours follow
 *  the queue rule against the row that will run before it. */
export function initialPlan(qtyShort: number, shade: unknown, prevShade: unknown, planning?: Partial<PlanningSettingsLike> | null): {
  plannedSlabs: number; shade: string | null; cleaningHours: number;
} {
  return {
    plannedSlabs: Math.max(0, Math.round(Number(qtyShort)) || 0),
    shade: parseShade(shade),
    cleaningHours: cleaningHoursFor(prevShade, shade, planning),
  };
}

export interface ChainRowLike {
  id: string;
  status: string;
  priority: number;
  shade?: string | null;
  cleaningHours?: unknown;
  design?: string;
  /** When PRODUCED: so the most recent run can be found. */
  producedAt?: string | Date | null;
  /** True when the row carries an OPEN cleaningHours reduction — a planner's
   *  hand-set figure nobody has answered yet (see recomputeCleaning). */
  cleaningHeld?: boolean;
}

/**
 * The rows whose cleaning hours the queue order decides — the ones a recompute
 * may REWRITE: QUEUED and SCHEDULED, by priority. A row IN_PRODUCTION has had
 * its changeover; what it cost is history, and re-deriving it from a reorder
 * would rewrite a figure the plant already spent. PRODUCED and CANCELLED are
 * out of the chain.
 */
export function planChain<T extends ChainRowLike>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.status === "QUEUED" || r.status === "SCHEDULED")
    .slice()
    .sort((a, b) => a.priority - b.priority);
}

const timeOf = (v: string | Date | null | undefined): number => {
  if (!v) return Number.NEGATIVE_INFINITY;
  const t = typeof v === "string" ? new Date(v).getTime() : v.getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * Who the FIRST rewritable row follows (answer 13). Who is rewritten and who
 * counts as the predecessor are two different questions: a row the plant is
 * running now is not rewritten, but it IS what the machine is coming off, so
 * the first queued row's changeover is judged against it — a DARK row in
 * production followed by a LIGHT row queued is the 6-hour case answer 13
 * describes. The last IN_PRODUCTION row by priority is that predecessor; when
 * nothing is running, the most recently PRODUCED row is (the machine last ran
 * it); when the plant has run nothing, null — the ordinary clean.
 */
export function predecessorRow<T extends ChainRowLike>(rows: readonly T[]): T | null {
  const running = rows.filter((r) => r.status === "IN_PRODUCTION").sort((a, b) => a.priority - b.priority);
  if (running.length) return running[running.length - 1];
  const produced = rows.filter((r) => r.status === "PRODUCED");
  if (!produced.length) return null;
  return produced.reduce((best, r) => {
    const tb = timeOf(best.producedAt), tr = timeOf(r.producedAt);
    if (tr > tb) return r;
    if (tr === tb && r.priority > best.priority) return r;
    return best;
  });
}

/** The row a NEW request follows when it lands at the back of the queue: the
 *  last QUEUED / SCHEDULED row, or — when the queue is empty — the running or
 *  last-produced row (predecessorRow). Null when the plant has run nothing. */
export function lastInChain<T extends ChainRowLike>(rows: readonly T[]): T | null {
  return planChain(rows).at(-1) ?? predecessorRow(rows);
}

export interface CleaningPatch { id: string; from: number | null; cleaningHours: number }
/** A hand-set figure the recompute left alone: what was kept and what the rule
 *  would have written, so the board can say so. */
export interface CleaningHold { id: string; design: string; kept: number | null; rule: number }

/**
 * Cleaning hours recomputed down the chain (the reorder, a new request, a
 * deletion, a status move): each rewritable row against the row before it,
 * the first against predecessorRow. Returns only the rows whose stored
 * figure differs, so the route writes nothing when nothing moved.
 *
 * A row whose figure was set by hand is normally overwritten too: the figure
 * is the changeover cost for the row that now precedes it, and after a
 * reorder that is a different row. The EXCEPTION is a row whose hand-set
 * cleaningHours reduction is still OPEN on the "planned but not scheduled"
 * panel (cleaningHeld): overwriting it would silently answer a question the
 * panel is still asking, so the figure is kept and the row is reported in
 * `held` instead. A held row still counts as its shade for the row after it.
 */
export function recomputeCleaning<T extends ChainRowLike>(rows: readonly T[], planning?: Partial<PlanningSettingsLike> | null): { patches: CleaningPatch[]; held: CleaningHold[] } {
  const chain = planChain(rows);
  const patches: CleaningPatch[] = [];
  const held: CleaningHold[] = [];
  let prev: string | null = predecessorRow(rows)?.shade ?? null;
  for (const r of chain) {
    const want = cleaningHoursFor(prev, r.shade, planning);
    const have = asNum(r.cleaningHours);
    if (have !== want) {
      if (r.cleaningHeld) held.push({ id: r.id, design: r.design ?? "", kept: have, rule: want });
      else patches.push({ id: r.id, from: have, cleaningHours: want });
    }
    prev = r.shade ?? null;
  }
  return { patches, held };
}

/** Every abrupt DARK → LIGHT changeover in the chain, for the warning the
 *  queue shows and the reorder route returns. The first chain row is judged
 *  against predecessorRow too, so a LIGHT row queued straight after a DARK
 *  row in production is named. */
export function abruptJumps<T extends ChainRowLike>(rows: readonly T[]): { id: string; afterId: string; design: string; afterDesign: string }[] {
  const chain = planChain(rows);
  const out: { id: string; afterId: string; design: string; afterDesign: string }[] = [];
  let prev: T | null = predecessorRow(rows);
  for (const r of chain) {
    if (prev && isAbruptJump(prev.shade, r.shade)) {
      out.push({ id: r.id, afterId: prev.id, design: r.design ?? "", afterDesign: prev.design ?? "" });
    }
    prev = r;
  }
  return out;
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

export const CHANGE_STATUSES = ["OPEN", "ADDED_BACK", "REMOVED"] as const;
export type PlanChangeStatus = (typeof CHANGE_STATUSES)[number];

/** The plan-change list's status filter: a comma list from the query,
 *  validated; nothing valid → OPEN only, because the list exists for the
 *  "planned but not scheduled" panel and OPEN is what that panel asks. */
export function parseChangeStatusFilter(raw: unknown): PlanChangeStatus[] {
  const parts = String(raw ?? "").split(",").map((s) => s.trim().toUpperCase().replace(/[\s-]+/g, "_")).filter(Boolean);
  const valid = parts.filter((p): p is PlanChangeStatus => (CHANGE_STATUSES as readonly string[]).includes(p));
  const unique = Array.from(new Set(valid));
  return unique.length ? unique : ["OPEN"];
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
