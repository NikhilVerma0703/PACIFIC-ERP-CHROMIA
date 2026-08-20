import { describe, expect, it } from 'vitest';

import {
  describeSlabRecordChanges,
  diffSlabRecord,
  DUPLICATE_SLAB_NO_MESSAGE,
  type SlabRecordFields,
} from '@/lib/chromia/slab-record';
import { slabRecordDeleteSchema, slabRecordEditSchema } from '@/lib/chromia/validation/slab-record';

const RECORD: SlabRecordFields = {
  receivedDate: '2026-08-03',
  batchNo: '1245',
  slabNo: '12334',
  baseMaterial: 'Astral Mist',
  fileName: 'Astral Mist 1',
  thicknessCm: '2',
  inTime: '09:15',
  fullyPrintedDate: '2026-08-03',
  remarks: 'Stock',
};

describe('what changed in a correction', () => {
  it('finds nothing when nothing was touched', () => {
    expect(diffSlabRecord(RECORD, { ...RECORD })).toEqual([]);
  });

  it('finds the one digit that was wrong', () => {
    const changes = diffSlabRecord(RECORD, { ...RECORD, slabNo: '12354' });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'slabNo', from: '12334', to: '12354' });
  });

  it('finds every field, in the order the form asks for them', () => {
    const changes = diffSlabRecord(RECORD, {
      ...RECORD,
      remarks: 'Dispatch',
      slabNo: '12354',
      batchNo: '1300',
    });

    expect(changes.map((change) => change.field)).toEqual(['batchNo', 'slabNo', 'remarks']);
  });

  it('counts clearing a field as a change', () => {
    const changes = diffSlabRecord(RECORD, { ...RECORD, remarks: '' });
    expect(changes).toHaveLength(1);
  });
});

describe('what the history says afterwards', () => {
  it('reads as a person would say it', () => {
    const note = describeSlabRecordChanges(diffSlabRecord(RECORD, { ...RECORD, slabNo: '12354' }));
    expect(note).toBe('Record corrected — Slab No. 12334 → 12354');
  });

  it('keeps both sides of every change, so the old value is not lost', () => {
    const note = describeSlabRecordChanges(
      diffSlabRecord(RECORD, { ...RECORD, slabNo: '12354', thicknessCm: '2.5' }),
    );

    expect(note).toContain('Slab No. 12334 → 12354');
    expect(note).toContain('Thickness (cm) 2 → 2.5');
  });

  it('writes a cleared field as a dash rather than as a gap', () => {
    const note = describeSlabRecordChanges(diffSlabRecord(RECORD, { ...RECORD, remarks: '' }));
    expect(note).toBe('Record corrected — Slab Remarks Stock → —');
  });
});

describe('the correction form', () => {
  const form = {
    slabId: '3f1a5c2e-1b7d-4c6a-9e2f-0a1b2c3d4e5f',
    receivedDate: '2026-08-03',
    inTime: '09:15',
    batchNo: '1245',
    slabNo: '12354',
    baseMaterial: 'Astral Mist',
    fileName: 'Astral Mist 1',
    thicknessCm: '2',
    fullyPrintedDate: '2026-08-03',
    remarks: 'Stock',
  };

  it('accepts a corrected row', () => {
    const parsed = slabRecordEditSchema.safeParse(form);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.slabNo).toBe('12354');
  });

  it('holds a correction to the same rules as the original entry', () => {
    expect(slabRecordEditSchema.safeParse({ ...form, slabNo: '' }).success).toBe(false);
    expect(slabRecordEditSchema.safeParse({ ...form, batchNo: '' }).success).toBe(false);
    expect(slabRecordEditSchema.safeParse({ ...form, baseMaterial: '' }).success).toBe(false);
    expect(slabRecordEditSchema.safeParse({ ...form, fileName: '' }).success).toBe(false);
    expect(slabRecordEditSchema.safeParse({ ...form, inTime: '25:70' }).success).toBe(false);
    expect(slabRecordEditSchema.safeParse({ ...form, receivedDate: 'nope' }).success).toBe(false);
  });

  it('tidies a hand-typed in-time exactly as the register does', () => {
    const parsed = slabRecordEditSchema.safeParse({ ...form, inTime: '930' });
    expect(parsed.success && parsed.data.inTime).toBe('09:30');
  });

  it('lets the optional fields be emptied', () => {
    const parsed = slabRecordEditSchema.safeParse({
      ...form,
      thicknessCm: '',
      fullyPrintedDate: '',
      remarks: '',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.thicknessCm).toBeUndefined();
    expect(parsed.success && parsed.data.remarks).toBeUndefined();
  });

  it('no longer carries a fully printed date at all', () => {
    // The field is gone from every form; anything still sending it is ignored
    // rather than written, so a correction cannot blank the figure the register
    // importer put in that column.
    const parsed = slabRecordEditSchema.safeParse({ ...form, fullyPrintedDate: '2026-08-03' });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.success ? parsed.data : {})).not.toContain('fullyPrintedDate');
  });

  it('accepts a correction with no in-time, like the entry form', () => {
    const parsed = slabRecordEditSchema.safeParse({ ...form, inTime: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.inTime).toBeUndefined();
  });

  it('cannot be aimed at something that is not a slab id', () => {
    expect(slabRecordEditSchema.safeParse({ ...form, slabId: '12354' }).success).toBe(false);
  });
});

describe('deleting a record', () => {
  it('needs both the id and the number that was on the row', () => {
    // The number is what protects a stale page from deleting whatever now sits
    // at that id — the service compares the two before removing anything.
    expect(
      slabRecordDeleteSchema.safeParse({
        slabId: '3f1a5c2e-1b7d-4c6a-9e2f-0a1b2c3d4e5f',
        slabNo: '12354',
      }).success,
    ).toBe(true);

    expect(
      slabRecordDeleteSchema.safeParse({ slabId: '3f1a5c2e-1b7d-4c6a-9e2f-0a1b2c3d4e5f' }).success,
    ).toBe(false);
    expect(slabRecordDeleteSchema.safeParse({ slabId: 'row-3', slabNo: '12354' }).success).toBe(
      false,
    );
  });
});

describe('the duplicate message', () => {
  it('is one sentence, used by every path that refuses a save', () => {
    expect(DUPLICATE_SLAB_NO_MESSAGE).toBe(
      'Duplicate Slab No. — this slab number already exists.',
    );
  });
});
