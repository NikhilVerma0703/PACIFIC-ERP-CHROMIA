import { z } from 'zod';

/**
 * Read a date the way a person typed it.
 *
 * `<input type="date">` submits "2026-08-05", and `new Date()` reads that as
 * **UTC midnight** — which in India is half past five in the morning, and in
 * the Americas is the day before. The register records calendar days, so the
 * string is split and rebuilt in local time: the day you typed is the day that
 * gets stored, wherever the machine is.
 */
function toLocalDate(value: string | Date): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;

  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dayOnly) {
    return new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const optionalString = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value));

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    return toLocalDate(value);
  });

/*
 * Slab intake — what the in-charge adds after processing.
 *
 * Identity, material, artwork and thickness are all recorded by the operator
 * when the slab goes on the line, so this never asked for them again. What is
 * left is the QC decision below, and nothing else:
 *
 * FULLY PRINTED DATE IS GONE FROM THE UI TOO.
 *
 * It was the one thing the old separate intake page asked for, and it was
 * asked for twice over: the slab comes off the line the same shift it goes on,
 * so the date was always the production date already on the record, retyped by
 * somebody who was not there when it happened. Removed at the plant's request
 * along with the separate page it lived on.
 *
 * The COLUMN stays. ChromiaProcessCycle.fullyPrintedDate holds a real figure
 * for every slab imported from the monthly register — that sheet has the
 * column and fills it per slab — and dropping it would throw that away and
 * break the importer, which uses it as the out-time. Nothing writes it by hand
 * any more; the importer still does.
 */



/**
 * QC Section of the intake page.
 *
 * The in-charge picks a grade, then the outcome allowed for that grade
 * (`GRADE_ALLOWED_DISPOSITIONS`). "Slab remarks" mirrors the REMARK column of
 * the paper register, which holds exactly the chosen outcome — Dispatch,
 * Stock, Sample cutting — and is left for the operator to write freely when
 * the slab goes for recalibration.
 *
 * The outcome-specific fields are all optional: the disposition services fill
 * sensible defaults (today's date, the default stock rack) when they are blank.
 */
export const intakeQcSchema = z.object({
  grade: z.enum(['A', 'B', 'C'], { message: 'Decide a grade' }),
  disposition: z.enum(['DISPATCH', 'STOCK', 'SAMPLE_CUTTING', 'WASTE', 'RECALIBRATION'], {
    message: 'Choose what happens to the slab',
  }),
  slabRemarks: optionalString,

  // Dispatch
  dispatchDate: optionalDate,

  // Stock — the rack is chosen on the floor, not decided at the QC bench, so
  // stocking here puts the slab on the default rack.
  stockDate: optionalDate,
  stockNotes: optionalString,

  // Sample cutting — the date, and nothing else. How many pieces came off a
  // slab and where they went is counted at the saw, not predicted at QC.
  cutDate: optionalDate,

  // Recalibration — carried through to the Recalibration page.
  recalibrationReason: optionalString,

  // Waste
  finalDefectTypeId: optionalId,
  rootCause: optionalString,
  disposalRef: optionalString,
});

export type IntakeQcInput = z.infer<typeof intakeQcSchema>;
