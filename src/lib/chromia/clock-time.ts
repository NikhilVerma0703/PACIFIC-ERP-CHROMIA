/**
 * Clock times, typed by hand.
 *
 * The register's times used to be collected with the browser's own time
 * picker. On a shop-floor tablet that control is a spinner: the operator books
 * a run of forty slabs and has to scroll to the minute forty times, and the
 * in-charge correcting a time from the paper book has to scroll there too.
 * Typing "0915" is one gesture; scrolling to 09:15 is dozens.
 *
 * So the field is now plain text, and this file is what makes that safe. A
 * picker could only ever hand back a real time; a text box can hand back
 * anything, including the "25:70" that the old `\d{2}:\d{2}` pattern happily
 * accepted and then stored as half past one the next morning.
 *
 * Two jobs, both pure so they can be unit-tested and shared by the form, the
 * schema and the service:
 *
 *   normaliseClockTime — what the operator meant, in HH:MM
 *   isClockTime        — whether a string really is a time of day
 *
 * One format everywhere: HH:MM, 24-hour, zero-padded. Never 9:15 AM, never
 * 9.15, never 915 — those are all accepted as input and all come back as
 * "09:15", so the register reads the same however it was typed.
 */

/** HH:MM (seconds tolerated), hours 00–23 and minutes 00–59 — nothing else. */
import { toPlantTimeInput } from '@/lib/chromia/plant-time';

export const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/** The one message every in-time field shows for a time it cannot read. */
export const CLOCK_TIME_MESSAGE = 'Enter a valid in-time (HH:MM)';

/** A real time of day, 00:00 through 23:59. */
export function isClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value.trim());
}

const pad = (value: number) => `${value}`.padStart(2, '0');

/**
 * What the operator meant, as HH:MM — or null if it cannot be read as a time.
 *
 * Deliberately forgiving about how a time is written, because a tablet
 * keyboard makes the colon a second keystroke and the shift key a third:
 *
 *   "9"      → 09:00      a bare hour
 *   "930"    → 09:30      the way it is said out loud
 *   "0930"   → 09:30      the way it is written in the book
 *   "9:5"    → 09:05      half-typed
 *   "9.30"   → 09:30      the decimal point is next to nothing useful
 *   "17 30"  → 17:30      the space bar is the biggest key on the keyboard
 *   "9:15 pm"→ 21:15      in case somebody's habit is twelve-hour
 *
 * Strict about what a time is: "25:00" and "12:60" are not times, and neither
 * is "abc". Those come back null and the field says so.
 */
export function normaliseClockTime(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;

  // A twelve-hour habit is rare here but harmless to honour, and silently
  // storing "9:15 pm" as 09:15 would be a twelve-hour error nobody spots.
  let meridiem: 'am' | 'pm' | null = null;
  const withoutMeridiem = value.replace(/\s*([ap])\.?m\.?$/, (_match, letter: string) => {
    meridiem = letter === 'a' ? 'am' : 'pm';
    return '';
  });

  const digits = withoutMeridiem.replace(/[^0-9]/g, '');
  const separated = /[:.\s]/.test(withoutMeridiem);
  if (digits === '' || digits.length > 6) return null;

  let hours: number;
  let minutes: number;

  if (separated) {
    // Anything the operator used as a separator counts as one: the colon is a
    // shifted key on a tablet and the full stop sits right beside the numbers.
    const parts = withoutMeridiem.split(/[:.\s]+/).filter((part) => part !== '');
    if (parts.length < 2 || parts.length > 3) return null;
    if (parts.some((part) => !/^\d{1,2}$/.test(part))) return null;
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
  } else if (digits.length <= 2) {
    // A bare hour. "9" is nine o'clock, which is what the operator means when
    // a slab goes on at the top of the hour.
    hours = Number(digits);
    minutes = 0;
  } else if (digits.length === 3) {
    hours = Number(digits.slice(0, 1));
    minutes = Number(digits.slice(1));
  } else if (digits.length === 4) {
    hours = Number(digits.slice(0, 2));
    minutes = Number(digits.slice(2));
  } else {
    return null;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }

  if (hours > 23 || minutes > 59) return null;

  return `${pad(hours)}:${pad(minutes)}`;
}

/** The current time as HH:MM in plant time, for the field's starting value. */
export function nowClockTime(at: Date = new Date()): string {
  return toPlantTimeInput(at);
}
