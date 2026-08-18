import { describe, expect, it } from 'vitest';

import { intakeQcSchema, slabIntakeSchema } from '@/lib/chromia/validation/slab';

/**
 * The QC section renders only the panel for the outcome that was chosen, so on
 * a dispatch every stock and sample-cutting field is simply not in the page.
 * `FormData.get` answers **null** for a field that is not there — and null is
 * not "absent", it is a value the optional schemas reject.
 *
 * That is the bug these tests exist to prevent: the form was rejected on fields
 * the user could not see, so the errors had nowhere to appear, nothing saved,
 * and the screen sat still. The action must read absent fields as undefined.
 */
describe('the intake form accepts a partly rendered QC section', () => {
  it('takes a dispatch with every other outcome’s fields absent', () => {
    const result = intakeQcSchema.safeParse({
      grade: 'A',
      disposition: 'DISPATCH',
      dispatchDate: '2026-08-05',
      slabRemarks: 'Dispatch',
      // stockDate, cutDate, piecesProduced … are not in the document at all.
    });

    expect(result.success).toBe(true);
    expect(result.data?.dispatchDate).toBeInstanceOf(Date);
    expect(result.data?.stockDate).toBeUndefined();
  });

  it('takes a recalibration with only its own fields', () => {
    const result = intakeQcSchema.safeParse({
      grade: 'C',
      disposition: 'RECALIBRATION',
      recalibrationReason: 'Roller Mark',
      slabRemarks: 'RECALIBRATE - Colour Mismatch',
    });

    expect(result.success).toBe(true);
    expect(result.data?.recalibrationReason).toBe('Roller Mark');
  });

  it('rejects null, which is what an unrendered field would send', () => {
    // Documents the trap rather than the fix: null must never reach the schema.
    const result = intakeQcSchema.safeParse({
      grade: 'A',
      disposition: 'DISPATCH',
      stockDate: null,
      piecesProduced: null,
    });

    expect(result.success).toBe(false);
  });

  it('still refuses a QC decision with no grade or outcome', () => {
    expect(intakeQcSchema.safeParse({}).success).toBe(false);
    expect(intakeQcSchema.safeParse({ grade: 'A' }).success).toBe(false);
  });

  it('treats an empty optional field as not filled in', () => {
    const result = intakeQcSchema.safeParse({
      grade: 'B',
      disposition: 'STOCK',
      stockDate: '',
      stockNotes: '',
    });

    expect(result.success).toBe(true);
    expect(result.data?.stockDate).toBeUndefined();
    expect(result.data?.stockNotes).toBeUndefined();
  });
});

describe('the intake form no longer asks for the slab’s identity', () => {
  /**
   * Batch, slab number, material, artwork and thickness are all written by the
   * operator when the slab goes on the line. Asking a second time here only
   * invited a second, different answer, so the schema now holds one field.
   */
  it('takes the printed date on its own', () => {
    const result = slabIntakeSchema.safeParse({ fullyPrintedDate: '2026-08-05' });
    expect(result.success).toBe(true);
  });

  it('ignores identity fields if anything still sends them', () => {
    const result = slabIntakeSchema.safeParse({
      fullyPrintedDate: '2026-08-05',
      batchNo: '356',
      slabNo: '954356',
    });
    expect(result.success).toBe(true);
    expect(Object.keys(result.data ?? {})).toEqual(['fullyPrintedDate']);
  });
});

describe('dates are read as the day that was typed', () => {
  /** Local calendar day — what the register means by a date. */
  const day = (date: Date | undefined) => {
    if (!date) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  it('keeps the fully printed date on its own day, not on UTC midnight', () => {
    // "2026-08-05" read as UTC lands at 05:30 in India and on 4 August in the
    // Americas. The day typed must be the day stored, wherever the server is.
    const result = slabIntakeSchema.safeParse({ fullyPrintedDate: '2026-08-05' });
    expect(day(result.data?.fullyPrintedDate)).toBe('2026-08-05');
    expect(result.data?.fullyPrintedDate?.getHours()).toBe(0);
  });

  it('does the same for the outcome dates', () => {
    const result = intakeQcSchema.safeParse({
      grade: 'A',
      disposition: 'DISPATCH',
      dispatchDate: '2026-08-05',
    });
    expect(day(result.data?.dispatchDate)).toBe('2026-08-05');
  });

  it('reads an unreadable date as not filled in', () => {
    const result = slabIntakeSchema.safeParse({ fullyPrintedDate: 'yesterday' });
    expect(result.data?.fullyPrintedDate).toBeUndefined();
  });
});

describe('reference fields accept anything typed', () => {
  it('takes a recalibration reason nobody has used before', () => {
    const result = intakeQcSchema.safeParse({
      grade: 'C',
      disposition: 'RECALIBRATION',
      recalibrationReason: 'Conveyor Scuff',
    });
    expect(result.success).toBe(true);
    expect(result.data?.recalibrationReason).toBe('Conveyor Scuff');
  });
});

describe('what QC asks for, and what it leaves to the floor', () => {
  it('takes a sample cutting on its date alone', () => {
    const result = intakeQcSchema.safeParse({
      grade: 'B',
      disposition: 'SAMPLE_CUTTING',
      cutDate: '2026-08-05',
    });

    expect(result.success).toBe(true);
    expect(result.data?.cutDate).toEqual(new Date('2026-08-05T00:00:00'));
  });

  it('no longer carries a rack, a piece count, a purpose or a destination', () => {
    // Removed from the bench because none of them are known there: the rack is
    // chosen when the slab is carried out, and the pieces are counted at the saw.
    const result = intakeQcSchema.safeParse({
      grade: 'B',
      disposition: 'SAMPLE_CUTTING',
      cutDate: '2026-08-05',
      stockLocationId: 'rack-3',
      piecesProduced: '12',
      purpose: 'Showroom',
      destination: 'Dealer',
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('stockLocationId');
    expect(result.data).not.toHaveProperty('piecesProduced');
    expect(result.data).not.toHaveProperty('purpose');
    expect(result.data).not.toHaveProperty('destination');
  });
});
