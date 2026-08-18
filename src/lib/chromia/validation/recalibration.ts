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

const optionalDecimal = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  .refine((value) => value === undefined || value > 0, 'Must be greater than zero');

/** Issue the slab out to the recalibration facility. */
export const sendForRecalibrationSchema = z.object({
  slabId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Enter a recalibrate reason').max(120),
  sentDate: optionalDate,
  expectedReturnDate: optionalDate,
  facilityName: optionalText,
  gatePassNo: optionalText,
  transporter: optionalText,
  vehicleNo: optionalText,
  conditionOnSend: optionalText,
  thicknessBeforeMm: optionalDecimal,
  reasonNotes: optionalText,
});

/** Book the slab back in after the upper surface has been removed. */
export const receiveFromRecalibrationSchema = z.object({
  recalibrationId: z.string().uuid(),
  receivedDate: optionalDate,
  thicknessAfterMm: optionalDecimal,
  conditionOnReturn: optionalText,
  workAccepted: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === 'true')),
  locationId: optionalId,
  notes: optionalText,
});

/** Restart the whole Chromia process — opens the next cycle. */
export const restartAfterRecalibrationSchema = z.object({
  recalibrationId: z.string().uuid(),
  locationId: optionalId,
});

export type SendForRecalibrationInput = z.infer<typeof sendForRecalibrationSchema>;

/** What the service receives once the typed reason has been resolved. */
export type ResolvedSendForRecalibration = Omit<SendForRecalibrationInput, 'reason'> & {
  reasonId: string;
};
export type ReceiveFromRecalibrationInput = z.infer<typeof receiveFromRecalibrationSchema>;
export type RestartAfterRecalibrationInput = z.infer<typeof restartAfterRecalibrationSchema>;

/**
 * The entry form at the top of the Recalibration page.
 *
 * The register records a recalibration as one line — reason, sent date,
 * received date — so all three are mandatory here. Everything the send and
 * receive forms further down the page can capture (facility, gate pass,
 * thickness, condition) stays optional and is filled in there when it matters.
 */
export const recalibrationEntrySchema = z
  .object({
    slabId: z.string().uuid('Select a slab'),
    reason: z.string().trim().min(1, 'Enter a recalibrate reason').max(120),
    sentDate: z.coerce.date({ message: 'Enter the sent date' }),
    receivedDate: z.coerce.date({ message: 'Enter the received date' }),
    reasonNotes: optionalText,
  })
  .refine((value) => value.receivedDate >= value.sentDate, {
    message: 'Received date cannot be before the sent date',
    path: ['receivedDate'],
  });

export type RecalibrationEntryInput = z.infer<typeof recalibrationEntrySchema>;
