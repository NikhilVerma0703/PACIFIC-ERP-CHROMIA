// Telegram reporting cron. Called hourly (GitHub Actions) with the same
// Bearer CRON_SECRET as /api/sync. AUTO mode (no ?kind): sends the hourly
// MIS message; when the completed hour closes a shift (14/22/06 IST) it also
// sends that shift's report; at 07:00 IST it also sends yesterday's daily.
// Manual testing: ?kind=hourly|shift|daily (&date=YYYY-MM-DD&hour=HH - HH).
import { sendTelegram } from "@/lib/telegram";
import { hourlyMessage, shiftMessage, dailyMessage, lastCompletedHourIST, plusDay, ymdIST } from "@/lib/telegramReports";
import { shiftOfHour } from "@/lib/misShiftHours";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return Response.json({ ok: false, reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" });
  }

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const last = lastCompletedHourIST();
  const bucket = /^\d{2} - \d{2}$/.test(searchParams.get("hour") ?? "") ? String(searchParams.get("hour")) : last.bucket;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("date") ?? "") ? String(searchParams.get("date")) : last.date;
  const sent: string[] = [];
  let attempted = 0;
  const push = async (label: string, text: string) => { attempted++; if (await sendTelegram(text)) sent.push(label); };

  try {
    if (!kind || kind === "hourly") await push("hourly", await hourlyMessage(bucket, date));

    // shift ends when the completed hour is the shift's last (13-14 / 21-22 / 05-06)
    const SHIFT_END: Record<string, "A" | "B" | "C"> = { "13 - 14": "A", "21 - 22": "B", "05 - 06": "C" };
    const endedShift = SHIFT_END[bucket];
    if ((!kind && endedShift) || kind === "shift") {
      const s = kind === "shift" && !endedShift ? shiftOfHour(bucket) : (endedShift ?? "A");
      const anchor = s === "C" ? plusDay(date, Number(bucket.slice(0, 2)) < 12 ? -1 : 0) : date;
      await push("shift", await shiftMessage(anchor, s));
    }

    // daily (yesterday) once the 06-07 hour completes = 07:00 IST
    if ((!kind && bucket === "06 - 07") || kind === "daily") {
      // manual ?kind=daily&date=X reports THAT day; auto mode reports yesterday
      const day = kind === "daily" && searchParams.get("date") ? date : plusDay(ymdIST(), -1);
      await push("daily", await dailyMessage(day));
    }
    // a send that was attempted but failed (revoked token, bot kicked) must
    // turn the cron red instead of rotting silently
    const ok = sent.length === attempted;
    return Response.json({ ok, sent, attempted, bucket, date }, { status: ok ? 200 : 500 });
  } catch (e) {
    console.error("Telegram report error:", e);
    return Response.json({ ok: false, sent }, { status: 500 });
  }
}
