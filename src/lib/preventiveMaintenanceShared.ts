// The preventive-maintenance register's client-safe half: the hour
// vocabulary, the cap, the shapes and the validation. MUST stay free of
// prisma / server-only imports — the board (a client component) uses the
// hour list and the types, exactly like misShiftHours.ts.

import { SHIFT_HOURS } from "./misShiftHours.ts";

export const PM_HOURS = [...SHIFT_HOURS.A, ...SHIFT_HOURS.B, ...SHIFT_HOURS.C];

/** A day of preventive work rarely exceeds a shift; 480 min is the cap so a
 *  fat-fingered "3000" cannot quietly claim a whole week of wrench time. */
export const PM_MAX_MINUTES = 480;

export interface NewPmEntry {
  date: string;        // "YYYY-MM-DD", the calendar day the work was done
  hour: string;        // the plant's hour vocabulary, "06 - 07"
  minutes: number;
  station: string;
  description: string;
}

export interface PmEntry extends NewPmEntry {
  id: string;
  actor: string | null;
  createdAt: string;   // ISO, for "logged 2 d after the work" honesty on screen
}

/** Reject before touching the DB; the message is for the person, not a log. */
export function validatePmEntry(e: NewPmEntry): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Pick the day the work was done.";
  if (!PM_HOURS.includes(e.hour)) return "Pick the hour from the list.";
  const m = Number(e.minutes);
  if (!Number.isInteger(m) || m < 1) return "Minutes must be a whole number, at least 1.";
  if (m > PM_MAX_MINUTES) return `Minutes can be at most ${PM_MAX_MINUTES} for one entry — split longer work across its hours.`;
  if (!e.station.trim()) return "Name the station or machine the work was done on.";
  if (!e.description.trim()) return "Describe what was done — this register is the record of it.";
  if (e.description.length > 2000) return "Keep the description under 2000 characters.";
  return null;
}
