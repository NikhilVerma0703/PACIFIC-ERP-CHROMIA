/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/sales/notifications          → list for current user (unread first)
 * PATCH /api/sales/notifications         → mark one or all as read
 *   body: { id?: string, all?: boolean }
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma }       from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);

  const rows = await db.$queryRawUnsafe(
    `SELECT id, order_id AS "orderId", type, title, body, action_url AS "actionUrl",
            actions, is_read AS "isRead", created_at AS "createdAt"
     FROM   sales_notifications
     WHERE  user_id = $1
     ORDER  BY is_read ASC, created_at DESC
     LIMIT  $2`,
    userId, limit
  ) as any[];

  const unreadCount = rows.filter((r: any) => !r.isRead).length;

  return NextResponse.json({ notifications: rows, unreadCount });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const body   = await req.json().catch(() => ({}));

  if (body.all) {
    await db.$queryRawUnsafe(
      `UPDATE sales_notifications SET is_read = true WHERE user_id = $1`, userId
    );
  } else if (body.id) {
    await db.$queryRawUnsafe(
      `UPDATE sales_notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      body.id, userId
    );
  } else {
    return NextResponse.json({ error: "Provide id or all:true" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
