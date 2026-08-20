import { z } from 'zod';

import { CLOCK_TIME_MESSAGE, normaliseClockTime } from '@/lib/chromia/clock-time';

/**
 * Operator entry — the digital version of the shop-floor register.
 *
 * Everything the operator sees on the register page. Grade, outcome and
 * recalibration are decided later by the in-charge.
 */
/**
 * The register's in-time.
 *
 * Typed by hand rather than picked, so two things have to be true and only one
 * of them used to be. It has to be a real time — the old `\d{2}:\d{2}` pattern
 * called "25:70" a time and the database stored it as ten past one the next
 * morning. And it has to be written one way, whatever was typed: "930", "9.30"
 * and "09:30" are the same instant and the register should not show three
 * spellings of it.
 *
 * AND IT IS OPTIONAL. It is the one column of the register that is genuinely sometimes not known
 * when the row is written — a slab booked in from a note, or a day being
 * caught up afterwards. Refusing the whole entry over it pushed operators into
 * typing a time they were guessing at, and a guessed in-time is worse than a
 * blank one: nothing downstream can tell it from a measured one, and the
 * processing window is computed from it.
 *
 * Blank means blank. Anything actually typed is still held to the same rule as
 * before — "25:70" is refused rather than stored as ten past one.
 */
const optionalClockTime = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === '') return undefined;
    const tidied = normaliseClockTime(value);
    if (!tidied) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: CLOCK_TIME_MESSAGE });
      return z.NEVER;
    }
    return tidied;
  });

export const operatorEntrySchema = z.object({
  entryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  inTime: optionalClockTime,
  batchNo: z.string().trim().min(1, 'Batch number is required').max(60, 'Batch number is too long'),
  slabNo: z.string().trim().min(1, 'Slab number is required').max(60, 'Slab number is too long'),
  baseMaterial: z
    .string()
    .trim()
    .min(1, 'Select a base material / slab name')
    .max(120, 'Base material is too long'),
  fileName: z
    .string()
    .trim()
    .min(1, 'Select a file name / planned design')
    .max(120, 'File name is too long'),
  /**
   * The register writes thickness in centimetres; the database stores
   * millimetres so it matches the recalibration measurements.
   */
  thicknessCm: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }),
});

export type OperatorEntryInput = z.infer<typeof operatorEntrySchema>;
