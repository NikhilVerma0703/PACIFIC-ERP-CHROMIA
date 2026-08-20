import { z } from 'zod';

import { CLOCK_TIME_MESSAGE, normaliseClockTime } from '@/lib/chromia/clock-time';

/**
 * Correcting a slab record.
 *
 * The same fields the operator typed in the first place, plus the two the
 * in-charge types at QC, held to exactly the same rules — a correction that
 * could write something the original entry would have refused is not a
 * correction, it is a second way in.
 *
 * Grade, Outcome and Status are deliberately absent. Those are decisions with
 * their own records and their own consequences; changing one by typing over it
 * would leave the grade decision, the dispatch record and the slab disagreeing.
 * They are changed where they are made.
 */

/** Optional, exactly as on the entry form — see validation/operator.ts. */
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

export const slabRecordEditSchema = z.object({
  slabId: z.string().uuid('Reopen the slab from Slab Records'),
  receivedDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
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
  /** Centimetres on the register, millimetres in the database. */
  thicknessCm: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }),
  remarks: z
    .string()
    .trim()
    .max(500, 'Slab remarks are too long')
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value)),
});

export type SlabRecordEditParsed = z.infer<typeof slabRecordEditSchema>;

/** What the service receives: the day and time already combined, or null when
 *  no in-time was recorded. */
export interface SlabRecordEditInput extends Omit<SlabRecordEditParsed, 'inTime'> {
  inTime: Date | null;
}

export const slabRecordDeleteSchema = z.object({
  slabId: z.string().uuid('Reopen the slab from Slab Records'),
  /**
   * The number as it appeared on the row that was clicked.
   *
   * Checked against the record before anything is removed, so a stale page —
   * one left open while somebody else edited or deleted that slab — deletes
   * nothing rather than deleting whatever now sits at that id.
   */
  slabNo: z.string().trim().min(1),
});

export type SlabRecordDeleteInput = z.infer<typeof slabRecordDeleteSchema>;
