import { describe, expect, it } from 'vitest';

import { ChromiaDisposition as Disposition } from '@prisma/client';
import { buildOutcomeSplit, OUTCOME_GROUPS } from '@/lib/chromia/dashboard-live';
import { buildOverallTiles, inPlantNow, type OverallCounts } from '@/lib/chromia/dashboard-totals';

const counts: OverallCounts = {
  received: 40,
  dispatched: 12,
  writtenOff: 3,
  inProcessing: 9,
  qcDone: 31,
  stocked: 8,
  sampleCut: 4,
  recalibration: 4,
};

describe('live plant inventory', () => {
  it('is what came in, less what has definitively left', () => {
    // Counting statuses that "look like still here" drifts the moment a status
    // is added and nobody remembers to include it. A slab leaves in exactly two
    // ways, so counting those cannot.
    expect(inPlantNow(counts)).toBe(25);
  });

  it('counts an empty plant as nothing, not as a negative', () => {
    expect(inPlantNow({ received: 0, dispatched: 0, writtenOff: 0 })).toBe(0);
  });

  it('never shows a negative, whatever the data says', () => {
    // "−3 slabs in the plant" on a shop-floor screen sends someone looking.
    expect(inPlantNow({ received: 5, dispatched: 6, writtenOff: 2 })).toBe(0);
  });

  it('falls as slabs are dispatched and written off', () => {
    const after = { ...counts, dispatched: counts.dispatched + 1 };
    expect(inPlantNow(after)).toBe(inPlantNow(counts) - 1);
  });
});

describe('the Overall Production tiles', () => {
  const tiles = buildOverallTiles(counts);

  it('shows the eight figures in the order they are read', () => {
    expect(tiles.map((tile) => tile.label)).toEqual([
      'Total Slabs Received',
      'Total Slabs in the Plant',
      'Total In Processing Slabs',
      'Total Quality Checks Done',
      'Total Dispatched Slabs',
      'Total Stock Slabs',
      'Total Sample Cutting Slabs',
      'Total Recalibration Slabs',
    ]);
  });

  it('puts the plant figure on the arithmetic, not on a second count', () => {
    expect(tiles[1]?.value).toBe(inPlantNow(counts));
  });

  it('carries no explanatory line under any tile', () => {
    // The figures speak for themselves; the arithmetic lives in the code and
    // in this test, not on the shop-floor screen.
    expect(tiles.every((tile) => tile.hint === undefined)).toBe(true);
  });

  it('passes every other figure through untouched', () => {
    expect(tiles[0]?.value).toBe(counts.received);
    expect(tiles[2]?.value).toBe(counts.inProcessing);
    expect(tiles[3]?.value).toBe(counts.qcDone);
    expect(tiles[4]?.value).toBe(counts.dispatched);
    expect(tiles[5]?.value).toBe(counts.stocked);
    expect(tiles[6]?.value).toBe(counts.sampleCut);
    expect(tiles[7]?.value).toBe(counts.recalibration);
  });

  it('survives a plant that has never received a slab', () => {
    const empty = buildOverallTiles({
      received: 0,
      dispatched: 0,
      writtenOff: 0,
      inProcessing: 0,
      qcDone: 0,
      stocked: 0,
      sampleCut: 0,
      recalibration: 0,
    });
    expect(empty.every((tile) => tile.value === 0)).toBe(true);
  });
});

describe('where they are', () => {
  const split = buildOutcomeSplit({
    [Disposition.DISPATCH]: 12,
    [Disposition.STOCK]: 8,
    [Disposition.SAMPLE_CUTTING]: 4,
    [Disposition.RECALIBRATION]: 4,
    IN_PROCESSING: 9,
  });

  it('adds up to the whole', () => {
    expect(split.reduce((sum, slice) => sum + slice.count, 0)).toBe(37);
    expect(split.reduce((sum, slice) => sum + slice.percent, 0)).toBeGreaterThanOrEqual(99);
  });

  it('keeps the groups in their fixed order, not in size order', () => {
    expect(split[0]?.label).toBe('Dispatched');
    expect(split.at(-1)?.label).toBe('In processing');
  });

  it('drops a group that never happened rather than drawing a zero', () => {
    expect(split.some((slice) => slice.label === 'Waste')).toBe(false);
  });

  it('gives every group a colour, and the same one every time', () => {
    expect(split.every((slice) => /^#[0-9a-f]{6}$/i.test(slice.color))).toBe(true);
    expect(OUTCOME_GROUPS.map((group) => group.color)).toEqual([
      '#16a34a',
      '#327dff',
      '#d97706',
      '#9333ea',
      '#94a3b8',
      '#dc2626',
    ]);
  });

  it('shows nothing at all before the first slab', () => {
    expect(buildOutcomeSplit({})).toEqual([]);
  });

  it('agrees with the Overall Production tiles, because both read one grouping', () => {
    const tiles = buildOverallTiles(counts);
    const stock = split.find((slice) => slice.label === 'Stock')?.count;
    expect(stock).toBe(tiles.find((tile) => tile.label === 'Total Stock Slabs')?.value);
  });
});
