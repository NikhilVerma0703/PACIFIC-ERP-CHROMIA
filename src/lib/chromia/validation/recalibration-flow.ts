import { z } from 'zod';

import { CLOCK_TIME_MESSAGE, normaliseClockTime } from '@/lib/chromia/clock-time';
import { plantInstant, toPlantDateInput } from '@/lib/chromia/plant-time';

/**
 * The two dates a recalibration trip is made of, and the register entry that
 * restarts the slab afterwards.
 *
 * Dates are split and rebuilt in local time rather than handed to `new Date()`:
 * "2026-08-10" read as UTC is half past five in the morning here, and the day
 * before in the Americas. A trip must fall on the day it was written down.
 */
function localDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}

const dayString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');

const optionalDay = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()))
  .refine((value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Enter a valid date')
  .transform((value) => (value === undefined ? undefined : localDay(value)));

/**
 * Sending and receiving.
 *
 * The sent date is required — it is the event being recorded, and it is the
 * only thing that moves the attempt counter. The received date is left empty
 * for as long as the slab is away, which is usually days and sometimes weeks.
 */
/**
 * The register's in-time.
 *
 * Typed by hand rather than picked, so it is checked for being a real time and
 * rewritten into the one spelling the register uses: "930", "9.30" and "09:30"
 * are the same instant and all three are stored as 09:30.
 */
const clockTime = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const tidied = normaliseClockTime(value);
    if (!tidied) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: CLOCK_TIME_MESSAGE });
      return z.NEVER;
    }
    return tidied;
  });

export const recalibrationTripSchema = z.object({
  slabId: z.string().uuid('Pick a slab from the list'),
  sentDate: dayString.transform(localDay),
  receivedDate: optionalDay,
});

export type RecalibrationTripInput = z.infer<typeof recalibrationTripSchema>;

/**
 * Restarting production — the operator's register, for a slab that has been
 * through it before. Everything is pre-filled and everything stays editable:
 * a trip to the recalibration department changes the thickness, and sometimes
 * the design is reassigned on the way back.
 */
export const restartAfterRecalibrationSchema = z.object({
  slabId: z.string().uuid(),
  receivedDate: dayString.transform(localDay),
  batchNo: z.string().trim().min(1, 'Batch number is required').max(60),
  slabNo: z.string().trim().min(1, 'Slab number is required').max(60),
  baseMaterial: z.string().trim().min(1, 'Select a base material / slab name').max(120),
  fileName: z.string().trim().min(1, 'Select a file name / planned design').max(120),
  thicknessCm: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }),
  inTime: clockTime,
});

export type RestartAfterRecalibrationParsed = z.infer<typeof restartAfterRecalibrationSchema>;

/** What the service receives: the register date and time already combined. */
export interface RestartAfterRecalibrationInput
  extends Omit<RestartAfterRecalibrationParsed, 'inTime'> {
  inTime: Date;
}

/**
 * "2026-08-10" + "11:34" → the instant that wall clock names in the plant.
 *
 * The time is read as plant-local (see plant-time.ts), so a restart entered at
 * 11:34 comes back 11:34 through the plant-time formatters, matching the
 * operator's in-time. The day is taken from `day`'s own plant calendar date, so
 * a date stored as midnight lands on the right day whatever the server's clock.
 */
export function combineDayAndTime(day: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const [year, month, date] = toPlantDateInput(day).split('-').map(Number);
  return plantInstant(year as number, month as number, date as number, hours ?? 0, minutes ?? 0);
}
