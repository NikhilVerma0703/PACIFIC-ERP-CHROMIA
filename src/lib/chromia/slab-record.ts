/**
 * Correcting a slab record.
 *
 * The register is written by hand at speed, and a hand writing at speed gets a
 * digit wrong: 12334 for 12354. Until now the only way to fix that was to leave
 * it wrong, because a slab number is the one thing every other table points at.
 *
 * So a correction is a first-class thing here, and it is a correction and not a
 * quiet overwrite: the change is described in words and kept in the slab's own
 * history as an event, exactly as the schema always intended ("corrections are
 * recorded as new events of type CORRECTION"). Nothing that already happened to
 * the slab — its cycles, its QC, its trips — is touched.
 *
 * Pure, so the wording can be unit-tested without a database.
 */

/**
 * One message, everywhere a duplicate is refused.
 *
 * The operator sees the same sentence whether they hit it on the register, on
 * a correction, or on a restart after recalibration — three code paths, one
 * thing that went wrong.
 */
export const DUPLICATE_SLAB_NO_MESSAGE =
  'Duplicate Slab No. — this slab number already exists.';

/** The fields a person typed, in the order the form shows them. */
export interface SlabRecordFields {
  receivedDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessCm: string;
  inTime: string;
  fullyPrintedDate: string;
  remarks: string;
}

const LABELS: Record<keyof SlabRecordFields, string> = {
  receivedDate: 'Production Date',
  batchNo: 'Batch No.',
  slabNo: 'Slab No.',
  baseMaterial: 'Base Material / Slab Name',
  fileName: 'File Name / Planned Design',
  thicknessCm: 'Thickness (cm)',
  inTime: 'In-time',
  fullyPrintedDate: 'Fully Printed Date',
  remarks: 'Slab Remarks',
};

/** The order the edit form asks for them, so the note reads top to bottom. */
const ORDER: (keyof SlabRecordFields)[] = [
  'receivedDate',
  'batchNo',
  'slabNo',
  'baseMaterial',
  'fileName',
  'thicknessCm',
  'inTime',
  'fullyPrintedDate',
  'remarks',
];

export interface SlabRecordChange {
  field: keyof SlabRecordFields;
  label: string;
  from: string;
  to: string;
}

/** Only what actually moved. An untouched field is not a correction. */
export function diffSlabRecord(
  before: SlabRecordFields,
  after: SlabRecordFields,
): SlabRecordChange[] {
  return ORDER.filter((field) => (before[field] ?? '') !== (after[field] ?? '')).map((field) => ({
    field,
    label: LABELS[field],
    from: before[field] ?? '',
    to: after[field] ?? '',
  }));
}

/**
 * The sentence written into the slab's history.
 *
 * Reads as a person would say it out loud — "Slab No. 12334 → 12354" — because
 * the whole point of keeping it is that somebody can later see what the record
 * used to say without going to the database for it. A blank is written as "—"
 * rather than as nothing, so clearing a field is visibly a change and not a
 * gap in the note.
 */
export function describeSlabRecordChanges(changes: readonly SlabRecordChange[]): string {
  if (changes.length === 0) return 'Record corrected — no field changed';

  const parts = changes.map(
    (change) => `${change.label} ${change.from || '—'} → ${change.to || '—'}`,
  );

  return `Record corrected — ${parts.join('; ')}`;
}
