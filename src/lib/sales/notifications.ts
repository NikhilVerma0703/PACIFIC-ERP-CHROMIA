/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared notification helper for the Sales module.
 * Inserts rows into sales_notifications.
 */
import { prisma } from "@/lib/prisma";

const db = prisma as any;

export interface NotifPayload {
  userId:    string;
  orderId?:  string;
  type:      string;
  title:     string;
  body?:     string;
  actionUrl?: string;
  actions?:  Array<{ label: string; url: string }>;
}

/**
 * Creates a single notification.
 */
export async function createNotification(p: NotifPayload): Promise<void> {
  await db.$queryRawUnsafe(
    `INSERT INTO sales_notifications
       (id, user_id, order_id, type, title, body, action_url, actions, is_read, created_at)
     VALUES
       (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::jsonb, false, now())`,
    p.userId,
    p.orderId ?? null,
    p.type,
    p.title,
    p.body ?? null,
    p.actionUrl ?? null,
    JSON.stringify(p.actions ?? [])
  );
}

/**
 * Notifies all users who have the given salesRole.
 * Useful for notifying all Commercials, all Admins, etc.
 */
export async function notifyByRole(
  salesRole: string,
  payload: Omit<NotifPayload, "userId">
): Promise<void> {
  const users = await db.$queryRawUnsafe(
    `SELECT id FROM users WHERE sales_role = $1`, salesRole
  ) as Array<{ id: string }>;

  for (const u of users) {
    await createNotification({ ...payload, userId: u.id });
  }
}
