/**
 * One clock for the whole Chromia module: the plant's, Asia/Kolkata.
 *
 * ── THE BUG THIS FIXES ────────────────────────────────────────────────────
 * Every date-time in the module was read and written in the SERVER's timezone,
 * and the server runs in UTC. Two things went wrong from that one fact:
 *
 *   • Instants stamped by the database — a QC saved at 14:53, a slab entered at
 *     14:53, any created/updated time — were FORMATTED in UTC, so the screen
 *     showed 09:23 for something that happened at 14:53. Off by the whole India
 *     offset, on every row.
 *
 *   • Times the operator TYPED — an in-time of 09:15 — were parsed in UTC and
 *     displayed in UTC, so they happened to round-trip, but only because both
 *     ends were wrong in the same direction. The moment the displays are fixed
 *     to plant time, the parsing has to move with them or a typed 09:15 comes
 *     back 14:45.
 *
 * So both ends are pinned here, to one timezone, explicitly — never to the
 * server's. Format an instant → plant time. Parse a typed wall-clock → the
 * instant that wall-clock names in the plant. The result is server-independent:
 * it is correct on a UTC host, an IST host, or anywhere else.
 *
 * India Standard Time is a fixed +05:30 with no daylight saving, ever, which is
 * why the offset can be a constant and the arithmetic is exact.
 *
 * Date-ONLY values (a production date, a dispatch date) are stored as midnight
 * and only ever shown as a day; +05:30 keeps them on the same calendar day, so
 * they read correctly through the plant-time formatters without any change to
 * how they are stored or filtered.
 */

export const PLANT_TIME_ZONE = 'Asia/Kolkata';

/** +05:30, in milliseconds. IST has no DST, so this never varies. */
const PLANT_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

/** The plant-local calendar/clock parts of an instant. */
function plantParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
} {
  // Shift the instant by the offset, then read UTC parts: with no DST to worry
  // about, that is exactly the plant-local wall clock.
  const shifted = new Date(date.getTime() + PLANT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/**
 * The instant a plant-local wall clock names.
 *
 * `plantInstant(2026, 8, 24, 14, 53)` is 14:53 in the plant — 09:23 UTC. This
 * is how a typed date and time become a stored instant, so the value that comes
 * back through the formatters below is the one that was typed.
 */
export function plantInstant(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds) - PLANT_OFFSET_MS);
}

/** `yyyy-mm-dd` in plant time — for date inputs and day keys. */
export function toPlantDateInput(date: Date): string {
  const p = plantParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `HH:mm` in plant time — for time inputs and the "now" default. */
export function toPlantTimeInput(date: Date): string {
  const p = plantParts(date);
  return `${pad(p.hours)}:${pad(p.minutes)}`;
}

/*
 * Display formatters, all pinned to plant time and built once. Each mirrors the
 * option shape a page was already using, so the ONLY thing that changes on
 * screen is the offset — "24 Aug, 09:23" becomes "24 Aug, 14:53", not a
 * different layout.
 */
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: PLANT_TIME_ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: PLANT_TIME_ZONE,
});

const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: PLANT_TIME_ZONE,
});

/** "24 Aug 2026". */
export const formatPlantDate = (date: Date): string => DATE.format(date);

/** "24 Aug, 14:53". */
export const formatPlantDateTime = (date: Date): string => DATE_TIME.format(date);

/** "14:53". */
export const formatPlantTime = (date: Date): string => TIME.format(date);

/** `yyyy-mm-dd` in plant time, or "" — the export sheets' date-only cells. */
export const plantDateCell = (date: Date | null): string => (date ? toPlantDateInput(date) : '');

/** `HH:mm` in plant time, or "" — the export sheets' time-only cells. */
export const plantTimeCell = (date: Date | null): string => (date ? toPlantTimeInput(date) : '');
