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
  alreadyPresent: 0,
  blankRows: 0,
  unreadable: 0,
  failed: 0,
  ...over,
});

describe('the status a register import records', () => {
  it('is COMPLETED for a clean first import of the real May register', () => {
    // 186 written; 13 left alone because the sheet repeats those slab numbers
    // when a slab comes back from recalibration; 67 blank spacer rows. The old
    // logic said PARTIAL, next to a "Failed: 0" that contradicted it.
    expect(importStatus(counts({ imported: 186, alreadyPresent: 13, blankRows: 67 }))).toBe(
      'COMPLETED',
    );
  });

  it('is COMPLETED — not FAILED — when the same good file is imported again', () => {
    // The reported symptom. Every row is already in the ERP, so nothing is
    // written; that is a no-op, not a failure, and calling it one sent people
    // looking for a problem that does not exist.
    expect(importStatus(counts({ imported: 0, alreadyPresent: 199, blankRows: 67 }))).toBe('COMPLETED');
  });

  it('is FAILED only when nothing was written AND something went wrong', () => {
    expect(importStatus(counts({ imported: 0, failed: 12 }))).toBe('FAILED');
    expect(importStatus(counts({ imported: 0, unreadable: 4 }))).toBe('FAILED');
    expect(importStatus(counts({ imported: 0, alreadyPresent: 50, failed: 3 }))).toBe('FAILED');
  });

  it('is PARTIAL when some rows landed and others did not', () => {
    expect(importStatus(counts({ imported: 100, failed: 2 }))).toBe('PARTIAL');
    expect(importStatus(counts({ imported: 100, unreadable: 5 }))).toBe('PARTIAL');
    expect(importStatus(counts({ imported: 100, alreadyPresent: 20, unreadable: 1 }))).toBe('PARTIAL');
  });

  it('never lets a skip alone change the status', () => {
    // A skip is the documented behaviour — live data wins over an import — so
    // it is a note, not a fault. This is the whole correction, stated once.
    for (const alreadyPresent of [0, 1, 13, 199, 266]) {
      expect(importStatus(counts({ imported: 5, alreadyPresent }))).toBe('COMPLETED');
    }
    // and a sheet full of spacers is not a problem either
    expect(importStatus(counts({ imported: 5, blankRows: 999 }))).toBe('COMPLETED');
  });

  it('treats an empty run as nothing to report rather than a failure', () => {
    expect(importStatus(counts())).toBe('COMPLETED');
  });
});

describe('the line shown beside it', () => {
  it('says plainly when there was simply nothing new', () => {
    // 199 slabs and 67 spacers. It must say 199: the count is of slabs, and a
    // sentence claiming 266 slabs in a 199-row sheet is what this replaces.
    expect(importSummaryLine(counts({ imported: 0, alreadyPresent: 199, blankRows: 67 }))).toBe(
      'Nothing new — all 199 slabs in this sheet are already in the ERP, and were left untouched.',
    );
    expect(importSummaryLine(counts({ imported: 0, alreadyPresent: 1 }))).toBe(
      'Nothing new — the one slab in this sheet is already in the ERP, and was left untouched.',
    );
  });

  it('never counts a blank spacer row as a slab', () => {
    // The sheet is full of them by design — see import/pro-register.ts.
    expect(importSummaryLine(counts({ imported: 186, alreadyPresent: 13, blankRows: 67 }))).toBe(
      '186 slabs imported · 13 already in the ERP, left untouched.',
    );
    expect(importSummaryLine(counts({ imported: 4, blankRows: 40 }))).toBe('4 slabs imported.');
  });

  it('counts the real first import the way a person would read it', () => {
    expect(importSummaryLine(counts({ imported: 186, alreadyPresent: 13, blankRows: 67 }))).toBe(
      '186 slabs imported · 13 already in the ERP, left untouched.',
    );
  });

  it('names each kind of problem separately, so none hides behind another', () => {
    expect(
      importSummaryLine(counts({ imported: 100, alreadyPresent: 20, unreadable: 3, failed: 2 })),
    ).toBe(
      '100 slabs imported · 20 already in the ERP, left untouched · 3 rows could not be read · 2 failed to save.',
    );
  });

  it('agrees with the status it sits next to', () => {
    // Both are decided from the same counts, which is why they are in one
    // module: a sheet that says "nothing failed" under a heading that says
    // FAILED is what this replaces.
    const nothingNew = counts({ imported: 0, alreadyPresent: 199, blankRows: 67 });
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
