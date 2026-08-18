/**
 * Operator register helpers — pure, so they can be unit-tested.
 *
 * The operator's paper register has exactly six columns:
 *
 *   Date | S.No. | Batch No. | Slab No. | File name | In-time
 *
 * Nothing else is written by hand. The six production stages (Base Primer,
 * Printing, Moulding, Cooling, Polishing, UV Polishing) run as one block —
 * the slab goes into Base Primer and comes out three to four hours later, and
 * is only looked at again at QC. So the operator stamps one in-time and stops.
 */

import { isClockTime } from '@/lib/chromia/clock-time';

/** `2026-08-03` + `09:15` → a local Date. */
export function combineDateAndTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // A real time of day, not merely two digits and a colon — the in-time is
  // typed now, and `new Date('...T25:70:00')` is silently Invalid Date.
  if (!isClockTime(time)) return null;

  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Midnight (local) of the given `yyyy-mm-dd` string. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Midnight (local) of the day after. */
export function endOfDay(date: Date): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

/** `yyyy-mm-dd` in local time — not `toISOString`, which shifts to UTC. */
export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `HH:mm` in local time. */
export function toTimeInput(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * A design "code" derived from the file name the operator writes.
 *
 * "Lighter Thaj 3.tif" → "LIGHTER-THAJ-3-TIF". Codes must be unique, so the
 * caller passes the codes already taken and gets the first free variant.
 */
export function designCodeFromFileName(fileName: string, taken: readonly string[] = []): string {
  const base =
    fileName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'DESIGN';

  if (!taken.includes(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }

  throw new Error(`Cannot derive a unique design code for "${fileName}"`);
}

/** Loose match so "lighter thaj 3" and "Lighter Thaj 3" are the same design. */
export function normaliseFileName(fileName: string): string {
  return fileName.trim().replace(/\s+/g, ' ').toLowerCase();
}
