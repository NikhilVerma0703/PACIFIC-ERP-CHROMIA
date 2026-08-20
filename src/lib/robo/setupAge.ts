/**
 * How old a production setup is, for the warning on the Edit setup screen.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * setupMasters.ts, slabSearch.ts and nextNumbers.ts use.
 *
 * WHY THERE IS A WARNING AND NOT A CUTOFF. A setup can be corrected however
 * old it is — a slab logged under the wrong design in May is still wrong in
 * August, and refusing the correction only means the register stays wrong.
 * What changes with age is the cost of being casual about it: a setup from
 * last week is probably only in this screen, while one from three months ago
 * has been through the monthly report and the Excel export, and the numbers
 * someone already circulated will no longer match. So the screen says how old
 * it is and how many slabs it speaks for, and lets the person decide.
 *
 * ONE MONTH is the line because that is the plant's reporting period. Inside
 * it a correction is ordinary; outside it, it is worth a sentence.
 */

/** The reporting period, in days. Anything older is flagged, never blocked. */
export const SETUP_EDIT_WINDOW_DAYS = 31;

/**
 * The plant's calendar. Every date in the Robo register is a plant-local
 * yyyy-mm-dd string typed on a tablet standing in Coimbatore, so "today" has
 * to mean today THERE — the server this renders on is in UTC, and from
 * midnight to 05:30 IST (18:30–24:00 UTC) its own date is still the day
 * before, which is exactly when the night shift is logging.
 */
export const PLANT_TIME_ZONE = "Asia/Kolkata";

/** The plant-local calendar date at a given instant, as yyyy-mm-dd. */
export function plantDate(at: Date, timeZone: string = PLANT_TIME_ZONE): string {
  // en-CA is the locale that formats as yyyy-mm-dd; the parts are pinned
  // explicitly rather than trusting the locale's default shape.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A yyyy-mm-dd string this module can read as a real calendar date. */
export function isIsoDate(s: string | null | undefined): boolean {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Date.parse accepts 2026-02-31 by rolling over; compare back so it doesn't.
  return new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * The day a setup belongs to.
 *
 * The production date the operator typed wins, because that is the point of
 * the field: a run entered late, or corrected the next morning, belongs to the
 * day it was produced. The shift's own date is the fallback for setups saved
 * before that field existed. See RoboBatchRecipe.productionDate in the schema.
 */
export function setupDate(
  productionDate: string | null | undefined,
  shiftDate: string | null | undefined,
): string | null {
  if (isIsoDate(productionDate)) return (productionDate as string);
  if (isIsoDate(shiftDate)) return (shiftDate as string);
  return null;
}

/**
 * Whole days from one yyyy-mm-dd to another, or null when either is unreadable.
 *
 * Anchored at UTC midnight on both sides so a clock change inside the range
 * cannot turn 31 days into 30.96 and round the wrong way. A future date gives
 * a negative number rather than being clamped — a setup dated next week is a
 * typo worth seeing, not an age of zero.
 */
export function daysBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** How many days ago this setup's run was, or null when it carries no date. */
export function setupAgeDays(
  productionDate: string | null | undefined,
  shiftDate: string | null | undefined,
  todayIso: string,
): number | null {
  return daysBetween(setupDate(productionDate, shiftDate), todayIso);
}

/**
 * Is this setup outside the reporting period, and so worth a warning?
 *
 * An unknown age is NOT stale. A setup with no date at all is old plumbing
 * rather than an old run, and warning about it would train people to click
 * past the warning that matters.
 */
export function isSetupStale(ageDays: number | null, windowDays = SETUP_EDIT_WINDOW_DAYS): boolean {
  return ageDays !== null && ageDays > windowDays;
}

/** "47 days ago" / "today" / "yesterday" — how the age is said on screen. */
export function describeAge(ageDays: number | null): string {
  if (ageDays === null) return "an unrecorded date";
  if (ageDays < 0) return `a date ${Math.abs(ageDays)} day${Math.abs(ageDays) === 1 ? "" : "s"} in the future`;
  if (ageDays === 0) return "today";
  if (ageDays === 1) return "yesterday";
  return `${ageDays} days ago`;
}
