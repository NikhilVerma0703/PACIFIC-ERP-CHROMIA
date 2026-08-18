import { describe, expect, it } from 'vitest';

import {
  ALL_ROLES,
  MANAGEMENT_ROLES,
  PRODUCTION_ROLES,
  QUALITY_ROLES,
  ROLE_LABELS,
  STORE_ROLES,
} from '@/lib/chromia/constants/roles';
import { ChromiaRole as Role } from '@prisma/client';

describe('roles', () => {
  it('exposes every role declared in the schema', () => {
    expect([...ALL_ROLES].sort()).toEqual([...Object.values(Role)].sort());
  });

  it('labels every role', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('always includes ADMIN in every permission group', () => {
    for (const group of [MANAGEMENT_ROLES, PRODUCTION_ROLES, QUALITY_ROLES, STORE_ROLES]) {
      expect(group).toContain(Role.ADMIN);
    }
  });

  it('keeps read-only viewers out of every write group', () => {
    for (const group of [PRODUCTION_ROLES, QUALITY_ROLES, STORE_ROLES]) {
      expect(group).not.toContain(Role.VIEWER);
    }
  });
});
