// Telegram bot commands — the group can ASK the bot (free: no AI, just live
// DB queries through the same builders the scheduled reports use).
//   /status - the running hour's MIS entry (or missed-entry alert)
//   /shift  - the current/last shift's report so far
//   /day    - today's production + downtime so far
//   /yesterday - yesterday's daily report
//   /help   - this list
// Security: Telegram must present X-Telegram-Bot-Api-Secret-Token matching
// TELEGRAM_WEBHOOK_SECRET, and only the configured group chat is answered.
import { sendTelegramTo, telegramChatIds } from "@/lib/telegram";
import { hourlyMessage, shiftMessage, dailyMessage, lastCompletedHourIST, ymdIST } from "@/lib/telegramReports";
import { shiftOfHour } from "@/lib/misShiftHours";
import { secretEqual } from "@/lib/secretEqual";

export const dynamic = "force-dynamic";
// /ask builds a large pack (several seconds of queries) and then calls a model
// that thinks on quality questions. At 30s a slow one was killed by the platform
// OUTSIDE the try/catch, so the group got silence and Telegram retried the
// webhook. 60 is the ceiling on Vercel's Hobby plan and is plenty; aiAnswer
// aborts its own model call well before this and answers with a friendly line.
export const maxDuration = 60;

const HELP = [
  "🤖 <b>Pacific ERP bot</b> — ask me:",
  "/status — this hour's MIS entry",
  "/shift — the running shift's report",
  "/day — today so far",
  "/yesterday — yesterday's daily report",
  "/ask &lt;question&gt; — free-text (AI) answer from live data",
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

const HELP_ASK = "/ask &lt;question&gt; — e.g. /ask how many slabs did we lose to downtime this week?";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Constant-time compare - see lib/secretEqual for why `!==` is not used.
  if (!secret || !secretEqual(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const update = await req.json().catch(() => null);
    const msg = update?.message ?? update?.channel_post;
    const text = String(msg?.text ?? "").trim();
    const chatId = String(msg?.chat?.id ?? "");
    // only serve approved chats: the report group(s) + TELEGRAM_EXTRA_CHAT_IDS
    // (comma-separated, commands/Q&A only — no scheduled reports there)
    const extra = String(process.env.TELEGRAM_EXTRA_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const allowed = new Set([...telegramChatIds(), ...extra]);
    if (!text.startsWith("/") || !allowed.has(chatId)) {
      return Response.json({ ok: true });
    }
    const cmd = text.split(/[\s@]/)[0].toLowerCase(); // "/status@PacificERPbot" -> "/status"
    let reply: string | null;
    if (cmd === "/ask") {
      const q = text.replace(/^\/ask(@\S+)?\s*/i, "").trim();
      const { aiAnswer } = await import("@/lib/telegramAsk");
      reply = q ? await aiAnswer(q) : HELP_ASK;
    } else {
      reply = await answer(cmd);
    }
    if (reply) await sendTelegramTo(chatId, reply); // answer in the chat that asked
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Telegram webhook error:", e);
    return Response.json({ ok: true }); // never make Telegram retry-storm
  }
}
