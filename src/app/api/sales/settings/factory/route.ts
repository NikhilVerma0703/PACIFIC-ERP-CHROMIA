/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PATCH /api/sales/settings/factory
 * Body: { userId: string, factory: "QUARTZ" | "GRANITE" | null }
 * Admin-only: sets the salesFactory scope for a Commercial or Accounts user.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const sysRole   = (session.user as any).role      as string | null;
  if (salesRole !== "SALES_ADMIN" && sysRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — SALES_ADMIN only" }, { status: 403 });
  }

  const { userId, factory } = await req.json() as { userId: string; factory: string | null };

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (factory !== null && factory !== "QUARTZ" && factory !== "GRANITE") {
    return NextResponse.json({ error: "factory must be QUARTZ, GRANITE, or null" }, { status: 400 });
  }

  // Only allow setting factory for Commercial / Accounts users
  const target = await db.$queryRawUnsafe(
    `SELECT id, sales_role FROM users WHERE id = $1`, userId
  ) as any[];
  if (!target.length) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const targetRole = target[0].sales_role;
  if (targetRole !== "COMMERCIAL" && targetRole !== "ACCOUNTS") {
    return NextResponse.json(
      { error: "Factory scope can only be set for COMMERCIAL and ACCOUNTS users" },
      { status: 400 }
    );
  }

  await db.$queryRawUnsafe(
    `UPDATE users SET sales_factory = $1 WHERE id = $2`,
    factory,
    userId
  );

  return NextResponse.json({ ok: true });
}
