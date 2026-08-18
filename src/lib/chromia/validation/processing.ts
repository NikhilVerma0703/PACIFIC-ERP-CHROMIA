import { z } from 'zod';

const optionalNote = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * Record the out-time — the slab has finished every production stage
 * (Base Primer through UV Polishing) and is ready for Quality Check.
 */
export const recordOutTimeSchema = z.object({
  cycleId: z.string().uuid(),
  /** Blank means "now". */
  outTime: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value))
    .pipe(z.coerce.date().optional()),
  locationId: optionalId,
  notes: optionalNote,
});

export type RecordOutTimeInput = z.infer<typeof recordOutTimeSchema>;
