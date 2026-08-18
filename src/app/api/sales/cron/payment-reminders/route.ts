/**
 * GET /api/sales/cron/payment-reminders
 *
 * Secured with CRON_SECRET environment variable.
 * Register this URL on cron-job.org (free) to run daily at 10:00 AM.
 * Add header:  x-cron-secret: <your CRON_SECRET value>
 *
 * To test manually: GET /api/sales/cron/payment-reminders
 *   with header x-cron-secret matching your env var.
 */
import { NextResponse } from "next/server";
import { runPaymentDeadlineReminders } from "@/lib/sales/paymentReminderJob";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  const provided = req.headers.get("x-cron-secret");
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await runPaymentDeadlineReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[cron/payment-reminders]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
