/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * getAssignedSpIds
 * For REPORTING_MANAGER: returns [their own id, ...assigned SP ids].
 * RM is also an SP, so they see their own records plus their team.
 * Returns null for all other roles (no SP-level restriction).
 */
import { prisma } from "@/lib/prisma";

const db = prisma as any;

export async function getAssignedSpIds(
  userId: string,
  salesRole: string | null
): Promise<string[] | null> {
  if (salesRole !== "REPORTING_MANAGER") return null;

  const rows = await db.$queryRawUnsafe(
    `SELECT sp_id AS "spId" FROM sales_manager_assignments WHERE manager_id = $1 AND is_active = true`,
    userId
  ) as Array<{ spId: string }>;

  // Include RM's own ID (they are also an SP)
  const spIds = rows.map((r: any) => r.spId);
  if (!spIds.includes(userId)) spIds.unshift(userId);
  return spIds;
}

/**
 * getAssignedSps
 * Like getAssignedSpIds but returns full { id, name } for UI dropdowns.
 */
export async function getAssignedSps(
  userId: string,
  salesRole: string | null
): Promise<Array<{ id: string; name: string }>> {
  if (salesRole !== "REPORTING_MANAGER") return [];

  const rows = await db.$queryRawUnsafe(
    `SELECT u.id, u.name
     FROM sales_manager_assignments sma
     JOIN users u ON u.id = sma.sp_id
     WHERE sma.manager_id = $1 AND sma.is_active = true`,
    userId
  ) as Array<{ id: string; name: string }>;

  // Prepend self
  const self = await db.$queryRawUnsafe(
    `SELECT id, name FROM users WHERE id = $1`, userId
  ) as Array<{ id: string; name: string }>;

  const all = [...(self[0] ? [self[0]] : []), ...rows.filter((r: any) => r.id !== userId)];
  return all;
}
