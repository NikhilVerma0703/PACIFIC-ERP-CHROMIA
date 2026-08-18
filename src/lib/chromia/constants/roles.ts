/**
 * Role catalogue.
 *
 * Values come from the Prisma `Role` enum; this module adds labels and the
 * role groupings used by authorization guards and navigation filtering.
 */
import { ChromiaRole as Role, type ChromiaRole as RoleType } from '@prisma/client';

// Re-exports both the const object and the union type named `Role`.
export { Role };

export const ROLES = Role;

export const ROLE_LABELS: Record<RoleType, string> = {
  ADMIN: 'Administrator',
  PRODUCTION_MANAGER: 'Production Manager',
  SUPERVISOR: 'Shift Supervisor',
  OPERATOR: 'Machine Operator',
  QUALITY_INSPECTOR: 'Quality Inspector',
  STORE_KEEPER: 'Store Keeper',
  VIEWER: 'Viewer (read only)',
};

export const ALL_ROLES: readonly RoleType[] = Object.values(Role);

/** Roles that may change master data and user accounts. */
export const ADMIN_ROLES: readonly RoleType[] = [Role.ADMIN];

/** Roles that may see plant-wide dashboards and reports. */
export const MANAGEMENT_ROLES: readonly RoleType[] = [
  Role.ADMIN,
  Role.PRODUCTION_MANAGER,
  Role.SUPERVISOR,
];

/** Roles that may record stage progress on the shop floor. */
export const PRODUCTION_ROLES: readonly RoleType[] = [
  Role.ADMIN,
  Role.PRODUCTION_MANAGER,
  Role.SUPERVISOR,
  Role.OPERATOR,
];

/** Roles that may record quality checks and grade decisions. */
export const QUALITY_ROLES: readonly RoleType[] = [
  Role.ADMIN,
  Role.PRODUCTION_MANAGER,
  Role.QUALITY_INSPECTOR,
];

/** Roles that may record dispatch, stock and sample cutting. */
export const STORE_ROLES: readonly RoleType[] = [
  Role.ADMIN,
  Role.PRODUCTION_MANAGER,
  Role.STORE_KEEPER,
];
