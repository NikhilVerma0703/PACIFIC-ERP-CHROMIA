// Reclassifying a logged delay: MOVING minutes from one delay bucket to another
// on a single MIS hourly row. Pure — no prisma, no I/O, no React — so the server
// action, both client views and `node --test` all share one set of rules. Same
// split as shiftScoreMath.ts against shiftScore.ts, and downtimeShared.ts against
// downtime.ts.
//
// WHY THIS EXISTS AT ALL, given downtimeResponse.ts already has a dispute.
// The production incharge fills the MIS form and files the stoppage under the
// wrong delay type — most often charging maintenance for what was really a
// cleaning changeover, sometimes the reverse. The existing DISPUTE was built for
// a different disagreement: it records maintenance's own duration BESIDE
// production's, and its header says plainly that nothing there writes to the MIS
// row — "a visible disagreement, not a second set of books". That decision was
// right for "we disagree about how long it was", and it stands; the dispute is
// untouched by this file.
//
// It is the wrong shape for "those minutes are in the wrong bucket". The four
// buckets ARE the downtime totals, the type chips, every chart and the uptime
// score, so a counter-claim that nothing reads leaves every one of them wrong.
// The owner asked for a correction, so this is a deliberate reversal of that
// decision for THIS case, and a knowingly stronger action: a reclass rewrites the
// MIS row, and the audit trail lives in mis_delay_reclass beside it. Two actions,
// two meanings — dispute the duration, reclassify the type.
//
// WHY IT IS A MOVE AND NOT AN EDIT. src/app/tables/actions.ts caps the four
// buckets at 60 minutes per hour, on create AND on edit, because an hour cannot
// hold more than 60 minutes of stoppage. If reclassification let you set two
// figures independently it would be a second, unguarded way past that cap. A move
// keeps the hour's total EXACTLY unchanged, so a row that satisfied the cap still
// does, and — just as important — the three rows already in the database that
// exceed 60 minutes stay correctable instead of being locked out by a validator
// that refuses to touch them.
//
// WHY EVERY MOVE IS ATTRIBUTABLE. src/lib/shiftScore.ts computes uptime from the
// breakdown and power-out minutes, and the ELECTRICAL and MECHANICAL incharges'
// share of the monthly incentive pool is ranked on that uptime. Moving minutes OUT
// of `breakdown` raises the maintenance team's own payout. The manager is editing
// an input to his own incentive — which is why the reason is mandatory, why the
// log is append-only (an undo is an inverse row, never a DELETE), and why the
// owner asked for the colour mark that describeReclass() below produces.

// Relative with the explicit .ts extension, not "@/lib/downtimeShared": the path
// alias is a tsconfig/bundler feature that `node --test` does not resolve, and
// this module has to be reachable by the test runner with no database and no
// build step. Same reason src/lib/finance/extract.ts imports "./gstin.ts".
import { DELAY_FIELDS, DELAY_LABEL, fmtDur } from "./downtimeShared.ts";

// ---------------------------------------------------------------------------
// Vocabulary — derived from DELAY_FIELDS, never restated
// ---------------------------------------------------------------------------
// Hand-writing `"process" | "cleaning" | ...` here would be a second copy of the
// bucket list that compiles perfectly while disagreeing with downtimeShared.ts.
// Deriving it means adding a fifth bucket there is a type error everywhere here
// that needs one, which is the outcome worth having.

export type DelayKey = (typeof DELAY_FIELDS)[number]["key"];

export const DELAY_KEYS: readonly DelayKey[] = DELAY_FIELDS.map((d) => d.key);

/** delay key -> the Mis column it lives in, for the caller building the update.
 *  Derived, so the column names exist in exactly one place in the codebase. */
export const DELAY_COL: Record<DelayKey, string> = Object.fromEntries(
  DELAY_FIELDS.map((d) => [d.key, d.col]),
) as Record<DelayKey, string>;

export function isDelayKey(v: unknown): v is DelayKey {
  return typeof v === "string" && (DELAY_KEYS as readonly string[]).includes(v);
}

/** The four minute counts for one hour. */
export type DelayBuckets = Record<DelayKey, number>;

/** What a caller can hand in: the Mis columns are nullable Floats, and an hour
 *  with no cleaning delay stores NULL rather than 0. Absent and null both read
 *  as zero — that is what they mean — but a present, nonsense value does not. */
export type DelayBucketsInput = Readonly<Partial<Record<DelayKey, number | null | undefined>>>;

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------
// NOTE ON THE WORD "reason". In this file `reason` ALWAYS means the manager's
// written justification, which is a stored, required field. A rejected request
// carries a `message` instead. Naming both "reason" is how a validation string
// ends up saved into the audit log as the manager's explanation.

export interface Refusal {
  ok: false;
  message: string;
}

const no = (message: string): Refusal => ({ ok: false, message });

// ---------------------------------------------------------------------------
// The reason rule
// ---------------------------------------------------------------------------

/** Four characters, the same bar as the finance duplicate-override
 *  (src/app/api/office/finance/[...path]/route.ts). Long enough to exclude "ok"
 *  and a stray keystroke, short enough that "wet" or "mix" gets through — the
 *  point is to force a thought, not to grade the prose. */
export const RECLASS_REASON_MIN = 4;

/** The reason is REQUIRED, and it is required because of what a reclass does to
 *  the incentive pool: months later, the only defence of a move that raised the
 *  mover's own payout is the sentence written at the time. */
export function validateReclassReason(reason: unknown): { ok: true; reason: string } | Refusal {
  if (typeof reason !== "string") return no("A reason is required for a reclassification.");
  const text = reason.trim();
  if (!text) return no("A reason is required for a reclassification.");
  if (text.length < RECLASS_REASON_MIN)
    return no(`Give a real reason — at least ${RECLASS_REASON_MIN} characters. This move changes the downtime totals and the uptime score.`);
  return { ok: true, reason: text };
}

// ---------------------------------------------------------------------------
// planReclass — the arithmetic and every rule that guards it
// ---------------------------------------------------------------------------

export interface ReclassRequest {
  /** The hour as it stands now, straight off the Mis row. */
  current: DelayBucketsInput;
  /** Bucket the minutes are wrongly sitting in. */
  from: string;
  /** Bucket they belong in. */
  to: string;
  /** Whole minutes to move, > 0. */
  minutes: number;
}

export interface ReclassOk {
  ok: true;
  /** The four values to write back to the Mis row. All four are returned, not
   *  just the two that moved: a partial update invites a caller to write one
   *  column and forget the other, which is the one failure mode that would put
   *  minutes into the hour out of nothing. */
  next: DelayBuckets;
  /** The hour as it was, echoed back for the audit row and the tooltip. */
  before: DelayBuckets;
  from: DelayKey;
  to: DelayKey;
  minutes: number;
  /** Unchanged by construction; returned so a caller can assert it cheaply. */
  total: number;
}

export type ReclassPlan = ReclassOk | Refusal;

/** Normalise the incoming hour. NULL/absent is 0; anything else must be a real,
 *  whole, non-negative number. Fractions are refused rather than rounded because
 *  rounding would silently change the hour's total, which is the one property
 *  this whole module exists to preserve. (Verified 2026-08-14: all 3,754 mis rows
 *  carrying any delay hold whole minutes, so nothing real is being locked out.) */
function readBuckets(input: DelayBucketsInput): { ok: true; buckets: DelayBuckets } | Refusal {
  const buckets = {} as DelayBuckets;
  for (const key of DELAY_KEYS) {
    const raw = input[key];
    if (raw === null || raw === undefined) {
      buckets[key] = 0;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n))
      return no(`This hour's ${(DELAY_LABEL[key] ?? key).toLowerCase()} figure is not a number — fix the MIS entry first.`);
    if (n < 0)
      return no(`This hour's ${(DELAY_LABEL[key] ?? key).toLowerCase()} figure is negative — fix the MIS entry first.`);
    if (!Number.isInteger(n))
      return no(`This hour's ${(DELAY_LABEL[key] ?? key).toLowerCase()} figure is ${n} minutes, not a whole number — it cannot be split without changing the hour's total. Fix the MIS entry first.`);
    buckets[key] = n;
  }
  return { ok: true, buckets };
}

const sum = (b: DelayBuckets): number => DELAY_KEYS.reduce((a, k) => a + b[k], 0);

/**
 * Work out what the hour becomes when `minutes` move from one bucket to another,
 * or refuse and say why in words the maintenance manager can act on.
 *
 * Pure and total: it never throws and never touches the database. The caller
 * writes `next` to the Mis row and appends the audit row only on ok:true, in that
 * order — a Mis row rewritten with no audit row beside it is precisely the
 * unattributable edit the log exists to prevent.
 */
export function planReclass(req: ReclassRequest): ReclassPlan {
  const { from, to, minutes } = req;

  if (!isDelayKey(from)) return no(`"${String(from)}" is not a delay type.`);
  if (!isDelayKey(to)) return no(`"${String(to)}" is not a delay type.`);
  // Not merely pointless: a same-bucket "move" would write an audit row claiming
  // a correction was made and mark the hour in colour, with nothing behind it.
  if (from === to) return no("Pick a different delay type to move the minutes into — from and to are the same.");

  if (typeof minutes !== "number" || !Number.isFinite(minutes))
    return no("Enter how many minutes to move.");
  // Zero is refused here although the dispute action accepts it: a zero-minute
  // dispute says something ("there was no breakdown"), a zero-minute move says
  // nothing and still stamps the hour as corrected.
  if (minutes <= 0) return no("Minutes to move must be more than zero.");
  if (!Number.isInteger(minutes)) return no("Minutes to move must be a whole number.");

  const read = readBuckets(req.current);
  if (!read.ok) return read;
  const before = read.buckets;

  // You cannot move out what is not there. Without this the `from` bucket goes
  // negative and the hour's total is preserved only in arithmetic, not in
  // meaning — and a negative feeding shiftScore.ts would score as bonus uptime.
  if (minutes > before[from]) {
    const held = before[from];
    return held === 0
      ? no(`This hour logs no ${(DELAY_LABEL[from] ?? from).toLowerCase()} time, so there is nothing to move out of it.`)
      : no(`This hour only logs ${fmtDur(held)} of ${(DELAY_LABEL[from] ?? from).toLowerCase()} — you cannot move ${fmtDur(minutes)} out of it.`);
  }

  const next: DelayBuckets = { ...before };
  next[from] = before[from] - minutes;
  next[to] = before[to] + minutes;

  // Belt to the braces above. Every rule so far makes these two impossible, so
  // reaching them means a rule was weakened or removed — and the honest response
  // to "I can no longer prove this is safe" is to refuse the write, not to
  // perform it and hope. The cost of the check is four additions.
  const total = sum(before);
  if (sum(next) !== total)
    return no("Refused: that change would alter the hour's total downtime. A reclassification only moves minutes between types.");
  for (const key of DELAY_KEYS) {
    if (!Number.isInteger(next[key]) || next[key] < 0)
      return no("Refused: that change would leave an impossible figure on the hour.");
  }

  return { ok: true, next, before, from, to, minutes, total };
}

/** planReclass plus the reason rule, so a caller cannot enforce one and forget
 *  the other. This is the entry point the server action should use. */
export function prepareReclass(
  req: ReclassRequest & { reason: unknown },
): (ReclassOk & { reason: string }) | Refusal {
  // Reason first: told "write a proper reason" before doing the sums, the manager
  // does not have to re-key the numbers after being bounced.
  const r = validateReclassReason(req.reason);
  if (!r.ok) return r;
  const plan = planReclass(req);
  if (!plan.ok) return plan;
  return { ...plan, reason: r.reason };
}

// ---------------------------------------------------------------------------
// Crossing to the Mis row — the plain objects the server action hands Prisma
// ---------------------------------------------------------------------------
// These build objects, not queries: no prisma import, so `node --test` still
// reaches them, and the four column names stay derived from DELAY_COL instead of
// being retyped at the one call site where a typo would write a delay figure
// into the wrong field and pass type-checking (Prisma's `data` is loosely typed
// once the keys are dynamic).

/** The Mis row's four delay columns, re-keyed to the bucket vocabulary. Anything
 *  the row does not carry reads as absent, which planReclass treats as zero. */
export function bucketsFromMisRow(row: Readonly<Record<string, unknown>>): DelayBucketsInput {
  const out: Partial<Record<DelayKey, number | null | undefined>> = {};
  for (const key of DELAY_KEYS) {
    const v = row[DELAY_COL[key]];
    out[key] = v === null || v === undefined ? null : Number(v);
  }
  return out;
}

/** All four values, for the Mis update. Every bucket is written even though only
 *  two moved — see ReclassOk.next: a partial update is the one mistake that could
 *  add minutes to the hour out of nothing. */
export function misDelayUpdate(next: DelayBuckets): Record<string, number> {
  const data: Record<string, number> = {};
  for (const key of DELAY_KEYS) data[DELAY_COL[key]] = next[key];
  return data;
}

/**
 * A WHERE fragment asserting the hour still holds exactly the figures the plan
 * was computed from — an optimistic lock, to be ANDed with the row id so the
 * update writes nothing if anything moved in between.
 *
 * WHY IT EXISTS. Two people can have the same hour open: production editing the
 * MIS entry in /tables while the maintenance manager reclassifies it, or the
 * manager double-submitting. Without this, the second write lands on figures it
 * never read and the hour's total silently changes — the one property this
 * module exists to preserve — or 20 minutes get moved out of a bucket that only
 * had 20, twice.
 *
 * THE NULL CLAUSE IS THE WHOLE TRICK. An hour with no cleaning delay stores NULL,
 * not 0, and readBuckets deliberately reads both as zero. A guard written as the
 * obvious `{ cleaningDelayDurationMinutes: 0 }` therefore matches no row at all,
 * and every move INTO an empty bucket — which is most of them — would be refused
 * as a phantom conflict forever.
 */
export function misDelayUnchanged(before: DelayBuckets): Record<string, unknown>[] {
  return DELAY_KEYS.map((key) => {
    const col = DELAY_COL[key];
    return before[key] === 0 ? { OR: [{ [col]: 0 }, { [col]: null }] } : { [col]: before[key] };
  });
}

// ---------------------------------------------------------------------------
// The colour mark — shared by the Downtime Log and the MIS hourly log
// ---------------------------------------------------------------------------
// The owner's third ask: "mark in some color when these gets change by my
// maintenance team". Both views build the mark from THIS function so the two
// screens cannot drift into describing the same correction differently — the same
// argument as the one vocabulary in downtimeShared.ts.

/** One row of mis_delay_reclass, structurally: a database row, an API payload
 *  and a test fixture all satisfy it. */
export interface ReclassRecord {
  fromType: string;
  toType: string;
  minutes: number;
  reason?: string | null;
  changedBy?: string | null;
  /** ISO string or Date. Rendered as a plain date — see fmtChangedOn. */
  changedAt?: string | Date | null;
}

export interface ReclassMark {
  /** 0 means no reclassification: draw nothing, no colour, no dot. */
  count: number;
  /** Badge text, e.g. "Reclassified" / "Reclassified x2". */
  label: string;
  /** Hover text: one line per move, newest last, in the owner's own phrasing. */
  tooltip: string;
  /** The tooltip's lines unjoined, for a view that wants to render them as JSX
   *  rather than a title attribute. */
  lines: string[];
  /** Signed minutes this log added to (+) or took out of (-) each bucket. A view
   *  marks an individual figure when its entry here is non-zero, which is how the
   *  colour lands on the number that changed rather than the whole row. */
  netByType: DelayBuckets;
}

/** Recommended Tailwind tone for the mark, exported so the two views cannot pick
 *  different colours for the same thing.
 *
 *  VIOLET, deliberately not amber: amber already means "maintenance disputes this
 *  figure and it is still unresolved" on the very same rows (DowntimeRespond.tsx,
 *  DowntimeLogCard.tsx). A reclassification is the opposite state — an applied,
 *  settled correction — and reusing amber would make an answered row look like an
 *  open argument. Red is wrong for the same reason: nothing here is an error. */
export const RECLASS_TONE = {
  badge: "bg-violet-100 text-violet-700",
  dot: "text-violet-600",
  panel: "border-violet-200 bg-violet-50/60",
  text: "text-violet-800",
} as const;

const labelOf = (key: string): string => DELAY_LABEL[key] ?? key;

/** Date only, and sliced rather than re-formatted through the local timezone.
 *  Dates in this database are naive IST stored as UTC (see downtime.ts); running
 *  changed_at through a locale formatter on a machine set to anything else moves
 *  a late-evening correction to the previous day in the tooltip. */
function fmtChangedOn(at: string | Date | null | undefined): string | null {
  if (!at) return null;
  if (at instanceof Date) return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
  const s = String(at).trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s || null;
}

/**
 * One line per move, in the phrasing the owner asked for:
 *
 *   "Cleaning 20m moved to Breakdown (mech/elec) by R. Kumar on 2026-08-14 — filter change logged as breakdown"
 *
 * Clauses drop out cleanly when their field is missing, so a row written before
 * a field existed still reads as a sentence rather than showing "by null".
 */
export function describeReclassRecord(rec: ReclassRecord): string {
  const mins = Number(rec.minutes);
  const shown = Number.isFinite(mins) ? fmtDur(Math.abs(mins)) : "?";
  let line = `${labelOf(rec.fromType)} ${shown} moved to ${labelOf(rec.toType)}`;
  // "maintenance" rather than "unknown": the action only lets the maintenance
  // manager or an admin write these, so the collective noun is true even when the
  // session carried no display name.
  line += ` by ${(rec.changedBy ?? "").trim() || "maintenance"}`;
  const on = fmtChangedOn(rec.changedAt);
  if (on) line += ` on ${on}`;
  const why = (rec.reason ?? "").trim();
  if (why) line += ` — ${why}`;
  return line;
}

/**
 * Turn an hour's reclass rows into the badge, the tooltip and the per-bucket
 * deltas the views need. Give it the rows for ONE MIS row; an empty list returns
 * count 0 and the view draws nothing.
 */
export function describeReclass(records: readonly ReclassRecord[]): ReclassMark {
  const netByType = Object.fromEntries(DELAY_KEYS.map((k) => [k, 0])) as DelayBuckets;
  const lines: string[] = [];

  for (const rec of records) {
    const mins = Number(rec.minutes);
    // An unreadable minutes value must not poison the deltas — the line still
    // renders (with "?") so the correction stays visible and auditable, but it
    // contributes nothing to a figure a view might colour or subtract.
    if (Number.isFinite(mins) && mins > 0) {
      if (isDelayKey(rec.fromType)) netByType[rec.fromType] -= mins;
      if (isDelayKey(rec.toType)) netByType[rec.toType] += mins;
    }
    lines.push(describeReclassRecord(rec));
  }

  const count = records.length;
  return {
    count,
    label: count === 0 ? "" : count === 1 ? "Reclassified" : `Reclassified x${count}`,
    tooltip: lines.join("\n"),
    lines,
    netByType,
  };
}

/** The two buckets src/lib/shiftScore.ts reads into the uptime that ranks the
 *  ELECTRICAL and MECHANICAL incharges and splits their incentive pool:
 *  uptime = 1 - (breakdown + power-out) / (hoursLogged x 60). Named here, once,
 *  so the scoreboard banner and any future consumer cannot pick a different pair
 *  from the four and quietly report the wrong impact. (Mechanical is rolled on
 *  breakdown alone and electrical on both — hence two figures, not one sum.) */
export const SCORED_DELAY_KEYS = ["breakdown", "powerout"] as const satisfies readonly DelayKey[];

/**
 * How many PAID minutes a set of corrections took out of the scored buckets.
 *
 * Positive means downtime shrank, i.e. uptime rose, i.e. the maintenance team's
 * own share of the pool went up — which is the number the admin signing the
 * payout has to see, and the reason /scoreboard carries a banner at all. It is
 * the negation of the log's net, not a second traversal, so it can never
 * disagree with the violet marks the two MIS views draw from the same records.
 */
export function scoredMinutesRemoved(records: readonly ReclassRecord[]): Record<(typeof SCORED_DELAY_KEYS)[number], number> {
  const { netByType } = describeReclass(records);
  // `|| 0` is not redundant: negating a zero net gives -0, which formats as "-0"
  // and compares unequal to 0 under Object.is. A banner reading "-0m taken out of
  // Breakdown" on a window where nothing moved is exactly the sort of detail that
  // makes an admin distrust the whole page.
  return { breakdown: -netByType.breakdown || 0, powerout: -netByType.powerout || 0 };
}

/**
 * What the hour looked like BEFORE maintenance touched it — the "what did it used
 * to be" the owner wants on hover, and the figure any later argument about a
 * payout starts from. Reconstructed as current minus the log's net, which is why
 * the log stores the moves rather than a flag.
 *
 * CAVEAT the caller must respect: production can edit their MIS entry after a
 * reclassification, and then this reconstruction is only "the hour minus
 * maintenance's moves", not a snapshot of any state that ever existed. A negative
 * value here is the tell that exactly that happened — check with
 * reconstructionSound() before showing the numbers as history.
 */
export function originalBuckets(current: DelayBucketsInput, records: readonly ReclassRecord[]): DelayBuckets {
  const { netByType } = describeReclass(records);
  const out = {} as DelayBuckets;
  for (const key of DELAY_KEYS) {
    const raw = current[key];
    const n = raw === null || raw === undefined ? 0 : Number(raw);
    out[key] = (Number.isFinite(n) ? n : 0) - netByType[key];
  }
  return out;
}

/** False when the reconstruction produced an impossible hour, meaning the MIS row
 *  was edited independently of the log. Show the tooltip, not the before-figures. */
export function reconstructionSound(before: DelayBuckets): boolean {
  return DELAY_KEYS.every((k) => Number.isFinite(before[k]) && before[k] >= 0);
}
