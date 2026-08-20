import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/chromia/utils/cn';

describe('scaffold', () => {
  it('resolves the @/ path alias and merges Tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
