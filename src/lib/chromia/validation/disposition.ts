import { z } from 'zod';

const optionalText = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value))
  .pipe(z.coerce.date().optional());

const positiveInt = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  });

/**
 * Grade A → Dispatch. Also reachable from stock.
 *
 * The Chromia in-charge decides *whether* a slab is dispatched and *when*.
 * Order numbers, invoices, vehicles and destinations belong to the dispatch
 * department's own system — they are deliberately not captured here.
 */
export const dispatchSchema = z.object({
  slabId: z.string().uuid(),
  dispatchDate: optionalDate,
});

/** Grade A or B → Stock. */
export const stockSchema = z.object({
  slabId: z.string().uuid(),
  stockDate: optionalDate,
  locationId: optionalId,
  notes: optionalText,
});

/** Grade B → Sample Cutting. Also reachable from stock. */
export const sampleCuttingSchema = z.object({
  slabId: z.string().uuid(),
  cutDate: optionalDate,
  piecesProduced: positiveInt,
  purpose: optionalText,
  destination: optionalText,
  notes: optionalText,
});

/** Grade C with all five attempts used → Waste. */
export const wasteSchema = z.object({
  slabId: z.string().uuid(),
  finalDefectTypeId: optionalId,
  rootCause: optionalText,
  disposalRef: optionalText,
  notes: optionalText,
});

export type DispatchInput = z.infer<typeof dispatchSchema>;
export type StockInput = z.infer<typeof stockSchema>;
export type SampleCuttingInput = z.infer<typeof sampleCuttingSchema>;
export type WasteInput = z.infer<typeof wasteSchema>;
