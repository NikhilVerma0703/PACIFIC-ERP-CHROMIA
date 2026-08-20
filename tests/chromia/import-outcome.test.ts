import { describe, expect, it } from 'vitest';

import {
  importStatus,
  importSummaryLine,
  type ImportCounts,
} from '@/lib/chromia/import/outcome';

/* The Import page showed FAILED on imports where nothing had gone wrong.
   The numbers below are the real ones, measured by replaying the old counters
   over PRO MAY.xlsx: 199 slab rows, 0 unreadable, 67 blank spacers, and 13
   slab numbers the sheet itself repeats. See import/outcome.ts. */

const counts = (over: Partial<ImportCounts> = {}): ImportCounts => ({
  imported: 0,
  skipped: 0,
  unreadable: 0,
  failed: 0,
  ...over,
});

describe('the status a register import records', () => {
  it('is COMPLETED for a clean first import of the real May register', () => {
    // 186 written, 13 skipped because the sheet repeats those slab numbers
    // when a slab comes back from recalibration. The old logic said PARTIAL,
    // next to a "Failed: 0" that contradicted it.
    expect(importStatus(counts({ imported: 186, skipped: 80 }))).toBe('COMPLETED');
  });

  it('is COMPLETED — not FAILED — when the same good file is imported again', () => {
    // The reported symptom. Every row is already in the ERP, so nothing is
    // written; that is a no-op, not a failure, and calling it one sent people
    // looking for a problem that does not exist.
    expect(importStatus(counts({ imported: 0, skipped: 266 }))).toBe('COMPLETED');
  });

  it('is FAILED only when nothing was written AND something went wrong', () => {
    expect(importStatus(counts({ imported: 0, failed: 12 }))).toBe('FAILED');
    expect(importStatus(counts({ imported: 0, unreadable: 4 }))).toBe('FAILED');
    expect(importStatus(counts({ imported: 0, skipped: 50, failed: 3 }))).toBe('FAILED');
  });

  it('is PARTIAL when some rows landed and others did not', () => {
    expect(importStatus(counts({ imported: 100, failed: 2 }))).toBe('PARTIAL');
    expect(importStatus(counts({ imported: 100, unreadable: 5 }))).toBe('PARTIAL');
    expect(importStatus(counts({ imported: 100, skipped: 20, unreadable: 1 }))).toBe('PARTIAL');
  });

  it('never lets a skip alone change the status', () => {
    // A skip is the documented behaviour — live data wins over an import — so
    // it is a note, not a fault. This is the whole correction, stated once.
    for (const skipped of [0, 1, 13, 199, 266]) {
      expect(importStatus(counts({ imported: 5, skipped }))).toBe('COMPLETED');
    }
  });

  it('treats an empty run as nothing to report rather than a failure', () => {
    expect(importStatus(counts())).toBe('COMPLETED');
  });
});

describe('the line shown beside it', () => {
  it('says plainly when there was simply nothing new', () => {
    expect(importSummaryLine(counts({ imported: 0, skipped: 266 }))).toBe(
      'Nothing new — all 266 slabs in this sheet are already in the ERP, and were left untouched.',
    );
    expect(importSummaryLine(counts({ imported: 0, skipped: 1 }))).toBe(
      'Nothing new — the one slab in this sheet is already in the ERP, and was left untouched.',
    );
  });

  it('counts the real first import the way a person would read it', () => {
    expect(importSummaryLine(counts({ imported: 186, skipped: 80 }))).toBe(
      '186 slabs imported · 80 already in the ERP, left untouched.',
    );
  });

  it('names each kind of problem separately, so none hides behind another', () => {
    expect(importSummaryLine(counts({ imported: 100, skipped: 20, unreadable: 3, failed: 2 }))).toBe(
      '100 slabs imported · 20 already in the ERP, left untouched · 3 rows could not be read · 2 failed to save.',
    );
  });

  it('agrees with the status it sits next to', () => {
    // Both are decided from the same counts, which is why they are in one
    // module: a sheet that says "nothing failed" under a heading that says
    // FAILED is what this replaces.
    const nothingNew = counts({ imported: 0, skipped: 266 });
    expect(importStatus(nothingNew)).toBe('COMPLETED');
    expect(importSummaryLine(nothingNew)).toContain('Nothing new');

    const broken = counts({ imported: 0, failed: 7 });
    expect(importStatus(broken)).toBe('FAILED');
    expect(importSummaryLine(broken)).toContain('7 failed to save');
  });

  it('says one slab, not 1 slabs', () => {
    expect(importSummaryLine(counts({ imported: 1 }))).toBe('1 slab imported.');
    expect(importSummaryLine(counts({ imported: 2, unreadable: 1 }))).toBe(
      '2 slabs imported · 1 row could not be read.',
    );
  });
});
