import { describe, expect, it } from 'vitest';

import {
  BASE_FIELDS,
  EXPORT_KIND_DATE_LABEL,
  EXPORT_KIND_LABELS,
  EXPORT_KINDS,
  baseColumns,
  baseFieldLabel,
  baseFields,
  buildExportQuery,
  buildRangeQuery,
  exportFileName,
  isExportKind,
  isRangePreset,
  isWithinRangeDays,
  padRange,
  parseExportQuery,
  parseRangeQuery,
  productionColumns,
  productionFileName,
  recentMonths,
  resolveRange,
  toDateInput,
  toMonthInput,
  type ExportQuery,
} from '@/lib/chromia/exports';

/** Fixed "now" so the maths is deterministic: Fri 14 Aug 2026, 15:30 local. */
const NOW = new Date(2026, 7, 14, 15, 30);

function query(overrides: Partial<ExportQuery> = {}): ExportQuery {
  return {
    kind: 'DISPATCH',
    preset: 'TODAY',
    month: '2026-08',
    from: '2026-08-01',
    to: '2026-08-14',
    ...overrides,
  };
}

describe('range presets', () => {
  it('today covers the whole current day', () => {
    const range = resolveRange(query({ preset: 'TODAY' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-08-14');
    expect(toDateInput(range.to)).toBe('2026-08-14');
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
  });

  it('last week reaches back seven days from today', () => {
    const range = resolveRange(query({ preset: 'LAST_WEEK' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-08-07');
    expect(toDateInput(range.to)).toBe('2026-08-14');
  });

  it('last month reaches back thirty days from today', () => {
    const range = resolveRange(query({ preset: 'LAST_MONTH' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-07-15');
    expect(toDateInput(range.to)).toBe('2026-08-14');
  });

  it('month wise covers the whole calendar month', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: '2026-07' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-07-01');
    expect(toDateInput(range.to)).toBe('2026-07-31');
  });

  it('month wise handles February in a leap year', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: '2028-02' }), NOW);
    expect(toDateInput(range.to)).toBe('2028-02-29');
  });

  it('month wise falls back to today when the month is malformed', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: 'nonsense' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-08-14');
  });

  it('custom uses the given dates, inclusive of the end day', () => {
    const range = resolveRange(
      query({ preset: 'CUSTOM', from: '2026-05-01', to: '2026-05-31' }),
      NOW,
    );
    expect(toDateInput(range.from)).toBe('2026-05-01');
    expect(toDateInput(range.to)).toBe('2026-05-31');
    expect(range.to.getHours()).toBe(23);
  });

  it('custom swaps a backwards range instead of returning nothing', () => {
    const range = resolveRange(
      query({ preset: 'CUSTOM', from: '2026-05-31', to: '2026-05-01' }),
      NOW,
    );
    expect(toDateInput(range.from)).toBe('2026-05-01');
    expect(toDateInput(range.to)).toBe('2026-05-31');
  });
});

describe('guards and parsing', () => {
  it('recognises valid kinds and presets only', () => {
    expect(isExportKind('STOCK')).toBe(true);
    expect(isExportKind('RECALIBRATION')).toBe(true);
    expect(isExportKind('ANYTHING')).toBe(false);
    expect(isRangePreset('MONTH')).toBe(true);
    expect(isRangePreset('YEARLY')).toBe(false);
  });

  it('offers a sheet for every outcome the in-charge asks for', () => {
    expect([...EXPORT_KINDS]).toEqual(['DISPATCH', 'STOCK', 'SAMPLE_CUTTING', 'RECALIBRATION']);
  });

  it('names the date each sheet is filtered on', () => {
    // The caption under each choice is built from this, so a sheet without a
    // date label would ship a card that says "Filtered on undefined".
    for (const kind of EXPORT_KINDS) {
      expect(EXPORT_KIND_LABELS[kind]).toBeTruthy();
      expect(EXPORT_KIND_DATE_LABEL[kind]).toMatch(/Date$/);
    }
  });

  it('defaults to today’s dispatch sheet', () => {
    const parsed = parseExportQuery({}, NOW);
    expect(parsed.kind).toBe('DISPATCH');
    expect(parsed.preset).toBe('TODAY');
    expect(parsed.month).toBe('2026-08');
    expect(parsed.from).toBe('2026-08-14');
  });

  it('rejects rubbish and keeps the defaults', () => {
    const parsed = parseExportQuery({ kind: 'HACK', preset: 'HACK', month: '13', from: 'x' }, NOW);
    expect(parsed.kind).toBe('DISPATCH');
    expect(parsed.preset).toBe('TODAY');
    expect(parsed.month).toBe('2026-08');
  });

  it('takes the first value when a param repeats', () => {
    const parsed = parseExportQuery({ kind: ['STOCK', 'DISPATCH'] }, NOW);
    expect(parsed.kind).toBe('STOCK');
  });
});

describe('query building', () => {
  it('carries only the fields the preset needs', () => {
    expect(buildExportQuery(query({ preset: 'TODAY' }))).toBe('kind=DISPATCH&preset=TODAY');

    const monthly = buildExportQuery(query({ preset: 'MONTH', month: '2026-07' }));
    expect(monthly).toContain('month=2026-07');
    expect(monthly).not.toContain('from=');

    const custom = buildExportQuery(query({ preset: 'CUSTOM' }));
    expect(custom).toContain('from=2026-08-01');
    expect(custom).toContain('to=2026-08-14');
  });
});

describe('helpers', () => {
  it('names the file after the sheet and the range', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: '2026-07' }), NOW);
    expect(exportFileName('SAMPLE_CUTTING', range)).toBe(
      'chromia-sample-cutting_2026-07-01_to_2026-07-31.xlsx',
    );
  });

  it('lists recent months newest first', () => {
    const months = recentMonths(3, NOW);
    expect(months.map((m) => m.value)).toEqual(['2026-08', '2026-07', '2026-06']);
    expect(months[0]?.label).toBe('August 2026');
  });

  it('formats month and date in local time', () => {
    expect(toMonthInput(new Date(2026, 0, 31, 23, 30))).toBe('2026-01');
    expect(toDateInput(new Date(2026, 0, 31, 23, 30))).toBe('2026-01-31');
  });
});

describe('the prefixed period picker', () => {
  it('reads its own namespaced params', () => {
    const parsed = parseRangeQuery(
      { pPreset: 'MONTH', pMonth: '2026-05', preset: 'CUSTOM', month: '2026-01' },
      'p',
      NOW,
    );
    // The unprefixed params belong to the other picker and must be ignored.
    expect(parsed.preset).toBe('MONTH');
    expect(parsed.month).toBe('2026-05');
  });

  it('reads unprefixed params when no prefix is given', () => {
    expect(parseRangeQuery({ preset: 'LAST_WEEK' }, '', NOW).preset).toBe('LAST_WEEK');
  });

  it('falls back to today when its params are absent or rubbish', () => {
    const parsed = parseRangeQuery({ pPreset: 'NONSENSE' }, 'p', NOW);
    expect(parsed.preset).toBe('TODAY');
    expect(parsed.month).toBe('2026-08');
  });

  it('resolves the same ranges as the outcome picker', () => {
    const range = resolveRange(
      parseRangeQuery({ pPreset: 'MONTH', pMonth: '2026-05' }, 'p', NOW),
      NOW,
    );
    expect(toDateInput(range.from)).toBe('2026-05-01');
    expect(toDateInput(range.to)).toBe('2026-05-31');
  });

  it('carries only the fields its preset needs', () => {
    expect(buildRangeQuery({ preset: 'TODAY', month: '2026-08', from: 'x', to: 'y' })).toBe(
      'preset=TODAY',
    );
    expect(
      buildRangeQuery({ preset: 'CUSTOM', month: '2026-08', from: '2026-05-01', to: '2026-05-31' }),
    ).toContain('from=2026-05-01');
  });

  it('names the production file after the range', () => {
    const range = resolveRange({ preset: 'MONTH', month: '2026-07', from: '', to: '' }, NOW);
    expect(productionFileName(range)).toBe('chromia-production_2026-07-01_to_2026-07-31.xlsx');
  });

  it('gives the production sheet a full column set', () => {
    const columns = productionColumns();
    expect(columns.map((column) => column.label)).toContain('Recalibrations');
    expect(columns.map((column) => column.label)).toContain('Dispatch Date');
    // Fourteen, not fifteen: Fully Printed Date went with the field. Nothing
    // types it any more — see lib/chromia/validation/slab.ts.
    expect(columns.map((column) => column.label)).not.toContain('Fully Printed Date');
    expect(columns).toHaveLength(14);
  });
});

describe('calendar-day filtering', () => {
  const may = resolveRange({ preset: 'MONTH', month: '2026-05', from: '', to: '' }, NOW);

  it('pads the query range by a day at each end', () => {
    const padded = padRange(may);
    expect(toDateInput(padded.gte)).toBe('2026-04-30');
    expect(toDateInput(padded.lte)).toBe('2026-06-01');
  });

  it('accepts an instant sitting exactly on the first midnight', () => {
    // The case that lost the whole May import: a slab received "1 May" is
    // stored as local midnight, the same instant the range begins.
    expect(isWithinRangeDays(new Date(2026, 4, 1, 0, 0, 0), may)).toBe(true);
  });

  it('accepts an instant a few seconds before that midnight, on the same day', () => {
    // Excel serial arithmetic can land a second early; the calendar day is
    // what matters, not the instant.
    expect(isWithinRangeDays(new Date(2026, 4, 1, 0, 0, 1), may)).toBe(true);
  });

  it('accepts the last moment of the final day', () => {
    expect(isWithinRangeDays(new Date(2026, 4, 31, 23, 59, 59), may)).toBe(true);
  });

  it('still rejects the days either side', () => {
    expect(isWithinRangeDays(new Date(2026, 3, 30, 23, 59), may)).toBe(false);
    expect(isWithinRangeDays(new Date(2026, 5, 1, 0, 0), may)).toBe(false);
  });

  it('treats a missing date as outside the range', () => {
    expect(isWithinRangeDays(null, may)).toBe(false);
  });
});

describe('the order a sheet writes its columns in', () => {
  it("opens every sheet with the production date, then that sheet's own date", () => {
    for (const kind of EXPORT_KINDS) {
      const labels = baseColumns(kind).map((column) => column.label);

      expect(labels[0]).toBe('Production Date');
      expect(labels[1]).toBe(EXPORT_KIND_DATE_LABEL[kind]);
    }
  });

  it('never leaves the production date buried in the middle of a sheet', () => {
    // Where it used to sit: sixth, just after the file name. Column one is the
    // one somebody reads a sheet down.
    for (const kind of EXPORT_KINDS) {
      const labels = baseColumns(kind).map((column) => column.label);
      expect(labels.indexOf('Production Date')).toBe(0);
    }
  });

  it('leaves everything after those two exactly as it was', () => {
    const tail = [
      'Batch No.',
      'Slab No.',
      'Base Material / Slab Name',
      'File Name / Planned Design',
      'Thickness (cm)',
      'In-time',
      'Out-time',
      // Fully Printed Date sat here until the field that fed it was removed.
      'Status',
      'Outcome',
    ];

    expect(baseColumns('DISPATCH').map((column) => column.label)).toEqual([
      'Production Date',
      'Dispatch Date',
      ...tail,
    ]);
    expect(baseColumns('STOCK').map((column) => column.label)).toEqual([
      'Production Date',
      'Stock Date',
      ...tail,
    ]);
    expect(baseColumns('SAMPLE_CUTTING').map((column) => column.label)).toEqual([
      'Production Date',
      'Cut Date',
      ...tail,
    ]);
    expect(baseColumns('RECALIBRATION').map((column) => column.label)).toEqual([
      'Production Date',
      'Recalibration Date',
      ...tail,
    ]);
  });

  it('puts Recalibration in the same order, with its own extras still last', () => {
    expect(baseColumns('RECALIBRATION').map((column) => column.label).slice(0, 3)).toEqual([
      'Production Date',
      'Recalibration Date',
      'Batch No.',
    ]);
  });

  it('carries every field on every sheet — a reorder is not a removal', () => {
    for (const kind of EXPORT_KINDS) {
      expect([...baseFields(kind)].sort()).toEqual([...BASE_FIELDS].sort());
    }
  });

  it('names the headings and the values from one list', () => {
    // The workbook maps values through `baseFields` and headings through
    // `baseColumns`. If these two ever disagreed, a column would sit above the
    // wrong values — the failure this shared order exists to prevent.
    for (const kind of EXPORT_KINDS) {
      const fields = baseFields(kind);
      const labels = baseColumns(kind).map((column) => column.label);

      expect(labels).toEqual(fields.map((field) => baseFieldLabel(field, kind)));
    }
  });
});

describe('the columns every sheet carries', () => {
  it('puts the thickness straight after the design, where the register has it', () => {
    for (const kind of EXPORT_KINDS) {
      const labels = baseColumns(kind).map((column) => column.label);
      const design = labels.indexOf('File Name / Planned Design');

      expect(design).toBeGreaterThan(-1);
      expect(labels[design + 1]).toBe('Thickness (cm)');
    }
  });

  it('names the material and the design the way every screen names them', () => {
    // The same two headings the operator reads on Slab Records and on the
    // register. A sheet that calls them something shorter reads as a different
    // system's export.
    for (const kind of EXPORT_KINDS) {
      const labels = baseColumns(kind).map((column) => column.label);
      expect(labels).toContain('Base Material / Slab Name');
      expect(labels).toContain('File Name / Planned Design');
      expect(labels).not.toContain('Base Material');
      expect(labels).not.toContain('File Name / Design');
    }
  });

  it('carries all three on the complete-production sheet too', () => {
    const labels = productionColumns().map((column) => column.label);

    expect(labels.slice(3, 6)).toEqual([
      'Base Material / Slab Name',
      'File Name / Planned Design',
      'Thickness (cm)',
    ]);
  });
});
