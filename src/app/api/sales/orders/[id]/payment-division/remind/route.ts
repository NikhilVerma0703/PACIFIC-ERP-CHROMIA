/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/orders/[id]/payment-division/remind
 * Manually triggers a payment reminder for a specific division.
 *
 * Body: { divisionId: string, force?: boolean }
 *   force=true  → send regardless of which milestones were already sent (useful for testing)
 *   force=false → only send milestones not yet sent (same logic as the daily cron)
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { NextResponse } from "next/server";
import { sendSingleDivisionReminder } from "@/lib/sales/paymentReminderJob";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const sysRole   = (session.user as any).role      as string | null;
  if (!salesRole && sysRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: orderId } = await params;
  const refused = await assertOrderVisible(session.user, orderId);
  if (refused) return refused;
  const { divisionId, force = false, milestone } = await req.json() as { divisionId: string; force?: boolean; milestone?: string };

  if (!divisionId) return NextResponse.json({ error: "divisionId required" }, { status: 400 });

  try {
    const result = await sendSingleDivisionReminder(orderId, divisionId, force, milestone);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
