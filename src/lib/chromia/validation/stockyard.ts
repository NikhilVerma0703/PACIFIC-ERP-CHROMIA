import { z } from 'zod';

/**
 * Stockyard release — a stocked slab leaving the plant.
 *
 * Deliberately its own schema rather than a reuse of `dispatchSchema`: there
 * the date is optional and blank means today, because the in-charge is deciding
 * the outcome at the moment of QC. Here the slab has been sitting on a rack for
 * days and somebody is recording an event that already happened, so the date is
 * the whole point of the form and is required.
 */
export const stockReleaseSchema = z.object({
  slabId: z.string().uuid('Pick a slab from the list'),
  dispatchDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the dispatch date')
    // Split and rebuilt in local time: "2026-08-08" read as UTC is 05:30 in
    // India and the previous day in the Americas.
    .transform((value) => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year as number, (month as number) - 1, day as number);
    }),
});

export type StockReleaseInput = z.infer<typeof stockReleaseSchema>;
