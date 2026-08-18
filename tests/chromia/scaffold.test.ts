import { describe, expect, it } from 'vitest';

import { slabIntakeSchema } from '@/lib/chromia/validation/slab';
import { cn } from '@/lib/chromia/utils/cn';

describe('scaffold', () => {
  it('resolves the @/ path alias and merges Tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

describe('slab intake validation', () => {
  it('accepts an intake with nothing but the printed date', () => {
    expect(slabIntakeSchema.safeParse({ fullyPrintedDate: '2026-05-01' }).success).toBe(true);
  });

  it('accepts an intake with no printed date at all', () => {
    const result = slabIntakeSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.fullyPrintedDate).toBeUndefined();
  });

  it('treats a blank printed date as absent', () => {
    const result = slabIntakeSchema.safeParse({ fullyPrintedDate: '' });
    expect(result.success && result.data.fullyPrintedDate).toBeUndefined();
  });

  it('keeps the day that was typed, not UTC midnight', () => {
    const result = slabIntakeSchema.safeParse({ fullyPrintedDate: '2026-05-01' });
    expect(result.data?.fullyPrintedDate?.getDate()).toBe(1);
    expect(result.data?.fullyPrintedDate?.getHours()).toBe(0);
  });
});
