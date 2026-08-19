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

/** Reject before touching the DB; the message is for the person, not a log.
 *  Treats the input as untrusted in SHAPE too — a server action is its own
 *  POST endpoint, so nothing guarantees these fields arrive as strings, and a
 *  validator that throws on bad shape turns a polite refusal into a 500. */
export function validatePmEntry(e: NewPmEntry): string | null {
  if (typeof e?.date !== "string" || typeof e?.hour !== "string"
    || typeof e?.station !== "string" || typeof e?.description !== "string") {
    return "That request was not shaped like the form sends — reload and try again.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Pick the day the work was done.";
  // The regex admits impossible days ("2026-02-31") which Date would silently
  // roll into March; a round-trip catches those AND out-of-range months.
  const d = new Date(`${e.date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.date) {
    return "That day does not exist on the calendar.";
  }
  if (!PM_HOURS.includes(e.hour)) return "Pick the hour from the list.";
  const m = Number(e.minutes);
  if (!Number.isInteger(m) || m < 1) return "Minutes must be a whole number, at least 1.";
  if (m > PM_MAX_MINUTES) return `Minutes can be at most ${PM_MAX_MINUTES} for one entry — split longer work across its hours.`;
  if (!e.station.trim()) return "Name the station or machine the work was done on.";
  if (e.station.length > 200) return "Keep the station under 200 characters — put the detail in the description.";
  if (!e.description.trim()) return "Describe what was done — this register is the record of it.";
  if (e.description.length > 2000) return "Keep the description under 2000 characters.";
  return null;
}
