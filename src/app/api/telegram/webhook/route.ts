// Telegram bot commands — the group can ASK the bot (free: no AI, just live
// DB queries through the same builders the scheduled reports use).
//   /status - the running hour's MIS entry (or missed-entry alert)
//   /shift  - the current/last shift's report so far
//   /day    - today's production + downtime so far
//   /yesterday - yesterday's daily report
//   /help   - this list
// Security: Telegram must present X-Telegram-Bot-Api-Secret-Token matching
// TELEGRAM_WEBHOOK_SECRET, and only the configured group chat is answered.
import { sendTelegram } from "@/lib/telegram";
import { hourlyMessage, shiftMessage, dailyMessage, lastCompletedHourIST, ymdIST } from "@/lib/telegramReports";
import { shiftOfHour } from "@/lib/misShiftHours";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HELP = [
  "🤖 <b>Pacific ERP bot</b> — ask me:",
  "/status — this hour's MIS entry",
  "/shift — the running shift's report",
  "/day — today so far",
  "/yesterday — yesterday's daily report",
].join("\n");

const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function answer(cmd: string): Promise<string | null> {
  const { bucket, date } = lastCompletedHourIST();
  if (cmd === "/status") return hourlyMessage(bucket, date);
  if (cmd === "/shift") {
    const s = shiftOfHour(bucket);
    const anchor = s === "C" && Number(bucket.slice(0, 2)) < 12 ? plusDay(date, -1) : date;
    return shiftMessage(anchor, s);
  }
  if (cmd === "/day") return dailyMessage(ymdIST());
  if (cmd === "/yesterday") return dailyMessage(plusDay(ymdIST(), -1));
  if (cmd === "/help" || cmd === "/start") return HELP;
  return null; // silence for normal chatter
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const update = await req.json().catch(() => null);
    const msg = update?.message ?? update?.channel_post;
    const text = String(msg?.text ?? "").trim();
    const chatId = String(msg?.chat?.id ?? "");
    // only serve the configured group — ignore DMs and strangers
    if (!text.startsWith("/") || chatId !== String(process.env.TELEGRAM_CHAT_ID ?? "")) {
      return Response.json({ ok: true });
    }
    const cmd = text.split(/[\s@]/)[0].toLowerCase(); // "/status@PacificERPbot" -> "/status"
    const reply = await answer(cmd);
    if (reply) await sendTelegram(reply);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Telegram webhook error:", e);
    return Response.json({ ok: true }); // never make Telegram retry-storm
  }
}
