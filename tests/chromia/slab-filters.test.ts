import { describe, expect, it } from 'vitest';

import { PAGINATION } from '@/lib/chromia/constants/app';
import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import {
  buildQuery,
  buildSlabWhere,
  hasActiveFilters,
  pageCount,
  parseSlabFilters,
} from '@/lib/chromia/slab-filters';

describe('parsing search params', () => {
  it('defaults to an empty first page', () => {
    const f = parseSlabFilters({});
    expect(f.slabNo).toBe('');
    expect(f.batchNo).toBe('');
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(PAGINATION.defaultPageSize);
    expect(hasActiveFilters(f)).toBe(false);
  });

  it('trims and caps the slab and batch text', () => {
    expect(parseSlabFilters({ slabNo: '  85477 ' }).slabNo).toBe('85477');
    expect(parseSlabFilters({ batchNo: '  1245 ' }).batchNo).toBe('1245');
    expect(parseSlabFilters({ slabNo: 'x'.repeat(200) }).slabNo).toHaveLength(80);
  });

  it('accepts only valid enum values', () => {
    expect(parseSlabFilters({ status: SlabStatus.IN_STOCK }).status).toBe(SlabStatus.IN_STOCK);
    expect(parseSlabFilters({ status: 'NONSENSE' }).status).toBeNull();
    expect(parseSlabFilters({ grade: 'D' }).grade).toBeNull();
    expect(parseSlabFilters({ grade: SlabGrade.C }).grade).toBe(SlabGrade.C);
  });

  it('rejects a bad page and clamps the page size', () => {
    expect(parseSlabFilters({ page: '0' }).page).toBe(1);
    expect(parseSlabFilters({ page: '-3' }).page).toBe(1);
    expect(parseSlabFilters({ page: 'abc' }).page).toBe(1);
    expect(parseSlabFilters({ pageSize: '99999' }).pageSize).toBe(PAGINATION.maxPageSize);
  });

  it('ignores an unparseable date', () => {
    expect(parseSlabFilters({ receivedFrom: 'not-a-date' }).receivedFrom).toBeNull();
    expect(parseSlabFilters({ receivedFrom: '2026-05-01' }).receivedFrom).toBeInstanceOf(Date);
  });

  it('takes the first value when a param repeats', () => {
    expect(parseSlabFilters({ slabNo: ['first', 'second'] }).slabNo).toBe('first');
  });
});

describe('building the where clause', () => {
  it('always excludes soft-deleted slabs', () => {
    expect(buildSlabWhere(parseSlabFilters({}))).toEqual({ deletedAt: null });
  });

  it('matches the slab number partially and case-insensitively', () => {
    const where = buildSlabWhere(parseSlabFilters({ slabNo: '8547' })) as {
      slabNo: { contains: string; mode: string };
    };
    expect(where.slabNo).toEqual({ contains: '8547', mode: 'insensitive' });
  });

  it('matches the batch number through the batch relation', () => {
    const where = buildSlabWhere(parseSlabFilters({ batchNo: '124' })) as {
      batch: { batchNo: { contains: string; mode: string } };
    };
    expect(where.batch.batchNo).toEqual({ contains: '124', mode: 'insensitive' });
  });

  it('narrows when slab and batch are given together', () => {
    const where = buildSlabWhere(parseSlabFilters({ slabNo: '20', batchNo: '1245' }));
    expect(where).toHaveProperty('slabNo');
    expect(where).toHaveProperty('batch');
  });

  it('maps each filter to its column', () => {
    const where = buildSlabWhere(
      parseSlabFilters({
        status: SlabStatus.GRADED,
        grade: SlabGrade.B,
        disposition: Disposition.STOCK,
        out: '1',
      }),
    );
    expect(where).toMatchObject({
      status: SlabStatus.GRADED,
      currentGrade: SlabGrade.B,
      currentDisposition: Disposition.STOCK,
      isRecalibrationOut: true,
    });
  });

  it('makes the received-date range inclusive of both end days', () => {
    const where = buildSlabWhere(
      parseSlabFilters({ receivedFrom: '2026-05-01', receivedTo: '2026-05-31' }),
    ) as { receivedDate: { gte: Date; lte: Date } };
    expect(where.receivedDate.gte.getTime()).toBeLessThan(where.receivedDate.lte.getTime());
    // Both ends are local, so a slab received at midnight on the first day and
    // one received late on the last are both inside the range wherever the
    // server is. Reading the "from" day as UTC would have dropped the first.
    expect(where.receivedDate.gte.getHours()).toBe(0);
    expect(where.receivedDate.gte.getDate()).toBe(1);
    expect(where.receivedDate.lte.getHours()).toBe(23);
    expect(where.receivedDate.lte.getDate()).toBe(31);
  });

  it('takes a single received day as one whole day', () => {
    const where = buildSlabWhere(parseSlabFilters({ receivedOn: '2026-05-12' })) as {
      receivedDate: { gte: Date; lte: Date };
    };
    expect(where.receivedDate.gte.getDate()).toBe(12);
    expect(where.receivedDate.gte.getHours()).toBe(0);
    expect(where.receivedDate.lte.getDate()).toBe(12);
    expect(where.receivedDate.lte.getHours()).toBe(23);
  });

  it('narrows, rather than overriding, when a day and a range are both given', () => {
    // Three controls, one column. Written naively the last one wins and the
    // other two silently do nothing.
    const where = buildSlabWhere(
      parseSlabFilters({
        receivedFrom: '2026-05-01',
        receivedTo: '2026-05-31',
        receivedOn: '2026-05-12',
      }),
    ) as { receivedDate: { gte: Date; lte: Date } };

    expect(where.receivedDate.gte.getDate()).toBe(12);
    expect(where.receivedDate.lte.getDate()).toBe(12);
  });

  it('filters on grade, which the bar now offers', () => {
    const where = buildSlabWhere(parseSlabFilters({ grade: SlabGrade.C }));
    expect(where).toMatchObject({ currentGrade: SlabGrade.C });
  });

  it('counts a single received day as an active filter', () => {
    expect(hasActiveFilters(parseSlabFilters({}))).toBe(false);
    expect(hasActiveFilters(parseSlabFilters({ receivedOn: '2026-05-12' }))).toBe(true);
  });

  it('keeps the single day in the query string', () => {
    expect(buildQuery(parseSlabFilters({ receivedOn: '2026-05-12' }))).toContain(
      'receivedOn=2026-05-12',
    );
  });
});

describe('query building and paging', () => {
  it('drops empty values and keeps the set ones', () => {
    const query = buildQuery(parseSlabFilters({ slabNo: '8547', status: SlabStatus.IN_STOCK }));
    expect(query).toContain('slabNo=8547');
    expect(query).toContain(`status=${SlabStatus.IN_STOCK}`);
    expect(query).not.toContain('grade=');
  });

  it('overrides the page without losing the filters', () => {
    const query = buildQuery(parseSlabFilters({ slabNo: '8547' }), { page: 3 });
    expect(query).toContain('slabNo=8547');
    expect(query).toContain('page=3');
  });

  it('counts pages, never fewer than one', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(51, 25)).toBe(3);
  });
});
