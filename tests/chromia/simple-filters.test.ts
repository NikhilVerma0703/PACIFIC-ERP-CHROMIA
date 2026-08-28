import { describe, expect, it } from 'vitest';

import {
  buildSimpleQuery,
  hasSimpleFilters,
  parseSimpleFilters,
  productionDateRange,
  simpleSlabWhere,
} from '@/lib/chromia/simple-filters';

/**
 * The three-field filter Stockyard and Recalibration share. Pure, so the rules
 * are pinned without a database: what parses, what counts as "filtered", and
 * the shape of the where fragment each page ANDs onto its own base query.
 */

describe('parsing the three fields', () => {
  it('reads batch, slab and a production date', () => {
    const f = parseSimpleFilters({ batchNo: ' 1245 ', slabNo: '85477', productionDate: '2026-02-14' });
    expect(f.batchNo).toBe('1245'); // trimmed
    expect(f.slabNo).toBe('85477');
    expect(f.productionDate).toBeInstanceOf(Date);
    expect(f.productionDate?.getFullYear()).toBe(2026);
  });

  it('is empty when nothing is given', () => {
    const f = parseSimpleFilters({});
    expect(f).toEqual({ productionDate: null, batchNo: '', slabNo: '' });
    expect(hasSimpleFilters(f)).toBe(false);
  });

  it('drops a production date that is not a date', () => {
    expect(parseSimpleFilters({ productionDate: 'someday' }).productionDate).toBeNull();
  });

  it('takes the first value when a param arrives more than once', () => {
    expect(parseSimpleFilters({ slabNo: ['85477', '99999'] }).slabNo).toBe('85477');
  });

  it('counts as filtered when any one field is set', () => {
    expect(hasSimpleFilters(parseSimpleFilters({ batchNo: '1245' }))).toBe(true);
    expect(hasSimpleFilters(parseSimpleFilters({ slabNo: '85477' }))).toBe(true);
    expect(hasSimpleFilters(parseSimpleFilters({ productionDate: '2026-02-14' }))).toBe(true);
  });
});

describe('the where fragment', () => {
  it('matches batch and slab partially and case-insensitively', () => {
    const where = simpleSlabWhere(parseSimpleFilters({ batchNo: '1245', slabNo: '854' }));
    expect(where.slabNo).toEqual({ contains: '854', mode: 'insensitive' });
    expect(where.batch).toEqual({ batchNo: { contains: '1245', mode: 'insensitive' } });
  });

  it('turns one production date into that whole day', () => {
    const where = simpleSlabWhere(parseSimpleFilters({ productionDate: '2026-02-14' })) as {
      receivedDate: { gte: Date; lte: Date };
    };
    expect(where.receivedDate.gte.getHours()).toBe(0);
    expect(where.receivedDate.gte.getDate()).toBe(14);
    expect(where.receivedDate.lte.getHours()).toBe(23);
    expect(where.receivedDate.lte.getDate()).toBe(14);
  });

  it('is empty when nothing is set, so the base query is untouched', () => {
    expect(simpleSlabWhere(parseSimpleFilters({}))).toEqual({});
  });
});

describe('the production-date range, for callers that take from/to', () => {
  it('is the whole day, or nulls when unset', () => {
    const { from, to } = productionDateRange(parseSimpleFilters({ productionDate: '2026-02-14' }));
    expect(from?.getHours()).toBe(0);
    expect(to?.getHours()).toBe(23);
    expect(productionDateRange(parseSimpleFilters({}))).toEqual({ from: null, to: null });
  });
});

describe('rebuilding the query string', () => {
  it('keeps only what is set', () => {
    const q = buildSimpleQuery(parseSimpleFilters({ batchNo: '1245', productionDate: '2026-02-14' }));
    const params = new URLSearchParams(q);
    expect(params.get('batchNo')).toBe('1245');
    expect(params.get('productionDate')).toBe('2026-02-14');
    expect(params.get('slabNo')).toBeNull();
  });

  it('is empty for empty filters', () => {
    expect(buildSimpleQuery(parseSimpleFilters({}))).toBe('');
  });
});
