// Client-safe map of MANDATORY entry-form fields per model (enforced both in
// the browser via `required` and on the server in createRow/saveRow).
// NOTE: supports text/select fields on the slab entry + edit forms. Before
// adding a bool field or a SmartRecordForm (non-slab) model here, wire the
// client `required` hint into those render paths too.
//
// The MIS value rules at the bottom of this file live here for the same reason
// the map does: they have to be enforced in the browser AND on the server, and
// the whole class of bug they answer is a rule that existed in only one of the
// two places. Pure (no prisma, no React) so the server action, MisShiftSheet
// and `node --test` all read the same sentence.

// Relative with the explicit .ts extension, not "@/lib/downtimeShared": the path
// alias is a tsconfig/bundler feature `node --test` does not resolve, and these
// rules have to be reachable by the test runner with no database and no build
// step (same reason src/lib/delayReclass.ts imports it this way).
import { DELAY_FIELDS } from "./downtimeShared.ts";
export const REQUIRED_FORM_FIELDS: Record<string, string[]> = {
  PolishQc: ["polishType"],
  // The shift incentive is paid to whoever this names. An hour that names
  // nobody puts its slabs in the plant total and on no one's row, which
  // quietly raises everyone else's share — 17 of July's 85 shifts did exactly
  // that. The MIS sheet already defaults it to the signed-in operator, so
  // requiring it costs the floor nothing.
  Mis: ["productionInchargeName"],
};

export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  polishType: "Polish Type",
  productionInchargeName: "Production Incharge",
};

export function isRequiredField(model: string, field: string): boolean {
  return (REQUIRED_FORM_FIELDS[model] ?? []).includes(field);
}

// ---------------------------------------------------------------------------
// MIS hourly sheet — value rules that MOVE MONEY, so both sides check them
// ---------------------------------------------------------------------------

/** An hour holds sixty minutes, so no single delay bucket can hold more than
 *  sixty of them either. */
export const MAX_DELAY_MINUTES_PER_HOUR = 60;

/** The four Mis delay columns, DERIVED from downtimeShared's DELAY_FIELDS so a
 *  fifth bucket is added in one place and every checker here follows. */
export const MIS_DELAY_COLUMNS: readonly string[] = DELAY_FIELDS.map((d) => d.col);
const DELAY_COL_LABEL: Record<string, string> = Object.fromEntries(DELAY_FIELDS.map((d) => [d.col, d.label]));

/** Read a form value / column value as a number. Blank and null mean "not
 *  entered" (the Mis delay columns are nullable Floats and an hour with no
 *  cleaning delay stores NULL, not 0); anything unparseable is not a number and
 *  is left to the coercion layer, which stores null for it. */
const asNumber = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * One delay bucket, on its own. Returns the operator-facing refusal, or null.
 *
 * WHY A NEGATIVE IS REFUSED AND NOT JUST CLAMPED. src/lib/shiftScore.ts SUMS
 * these four columns across the whole shift before shiftScoreMath.ts clamps
 * anything, so breakdown = -45 in one hour cancels a real 45-minute breakdown in
 * another and the shift scores perfect uptime — which is a weight in the payout
 * and a term in the OEE. Storing 0 instead would silently discard whatever the
 * operator meant to type; refusing sends them back to the box while they still
 * remember the hour. src/lib/delayReclass.ts refuses a negative for the same
 * reason on the reclassification path ("would score as bonus uptime"); this is
 * that rule on the entry path, where the number is first written.
 *
 * The upper bound is the per-hour cap applied per FIELD: the entry form's total
 * check is a sum, and a sum lets 90 minutes of breakdown hide behind a -30 in
 * another bucket. Both bounds together are what make the sum trustworthy.
 */
export function misDelayFieldError(col: string, value: unknown): string | null {
  const n = asNumber(value);
  if (n == null) return null;
  const label = DELAY_COL_LABEL[col] ?? col;
  if (n < 0)
    return `⚠ ${label} is ${n} min — a delay cannot be negative. A minus figure does not subtract downtime, it CANCELS a real stoppage logged in another hour and hands the shift uptime it never had. Enter the minutes actually lost, or leave the box empty.`;
  if (n > MAX_DELAY_MINUTES_PER_HOUR)
    return `⚠ ${label} is ${Math.round(n)} min — one hour can lose at most ${MAX_DELAY_MINUTES_PER_HOUR} minutes. Log the rest against the hour it actually happened in.`;
  return null;
}

/**
 * Std slabs/hr is mandatory once Actual says the line produced something.
 *
 * A blank Std is not a blank cell downstream: it deflates the CEO report's
 * target directly (the target is the sum of the Std column), it shifts the
 * downtime page's day rate, and it makes the incentive multiplier 1 — so an
 * hour that names no standard quietly pays as if it met one. The rule was
 * written on the MIS sheet only, which left /tables/Mis create and every
 * /tables/Mis/[id] edit free to save — or BLANK — a Std while Actual stands.
 *
 * When Actual is blank or zero (an hour the line did not run) Std stays
 * optional: there is nothing to measure against a standard.
 */
export function misStdRequiredError(std: unknown, actual: unknown): string | null {
  const a = asNumber(actual);
  if (a == null || a <= 0) return null;
  const s = asNumber(std);
  if (s != null && s > 0) return null;
  return "⚠ Slabs/hr Std. is required once Actual is filled — the target, the day rate and the incentive multiplier are all measured against it, and a blank Std silently lowers all three. Enter the standard for this hour before saving.";
}
