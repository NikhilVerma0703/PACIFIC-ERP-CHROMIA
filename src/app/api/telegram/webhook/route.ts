// Telegram bot commands — the group can ASK the bot (free: no AI, just live
// DB queries through the same builders the scheduled reports use).
//   /status - the running hour's MIS entry (or missed-entry alert)
//   /shift  - the current/last shift's report so far
//   /day    - today's production + downtime so far
//   /yesterday - yesterday's daily report
//   /help   - this list
// Security: Telegram must present X-Telegram-Bot-Api-Secret-Token matching
// TELEGRAM_WEBHOOK_SECRET, and only the configured group chat is answered.
import { after } from "next/server";
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
//
// STILL 60 EVEN THOUGH THE ANSWER NOW RUNS IN after(). Deferred work is not free
// time: it runs inside the SAME invocation's budget, so a slow /ask is killed at
// the same wall clock it always was. What changed is the consequence — Telegram
// already has its 200, so a kill now costs one unanswered question instead of a
// retry storm.
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
  // The PRODUCTION day, 06:00→06:00 IST — the day getDowntimeReport windows on.
  // On the IST calendar day, /day asked at 02:00 named a day that had not begun
  // and answered "Slabs made: 0 · target 0" for a night shift that was running.
  if (cmd === "/day") return dailyMessage(productionDay());
  if (cmd === "/yesterday") return dailyMessage(plusDay(productionDay(), -1));
  if (cmd === "/help" || cmd === "/start") return HELP;
  return null; // silence for normal chatter
}

const HELP_ASK = "/ask &lt;question&gt; — e.g. /ask how many slabs did we lose to downtime this week?";

/** Today's production day (06:00→06:00 IST). */
const productionDay = () => new Date(Date.now() + (330 - 360) * 60_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Update de-duplication
// ---------------------------------------------------------------------------
// TELEGRAM REDELIVERS ANYTHING IT HAS NOT SEEN A 200 FOR, and it retries the
// same update_id for minutes. Before this the handler did the whole job — for
// /ask, several seconds of queries and then a model call — BEFORE replying, so
// a slow answer was redelivered while the first one was still being computed:
// the group got the same answer twice, and we were billed for the model twice
// for one question. Both halves of that are fixed here: the 200 goes back
// immediately (the work moves into after(), below), and an update_id we have
// already accepted is dropped.
//
// IN MEMORY, AND THAT IS A REAL LIMITATION worth stating plainly. This Set lives
// in ONE serverless instance: a cold start, or a retry routed to a second
// instance, sees an empty set and will answer twice. There is no table for it
// and a migration to hold bot bookkeeping is not worth the weight — the guard
// covers the case that actually happens, which is Telegram retrying the same
// warm instance seconds later while the answer is still being built.
//
// 500 ids is far more than the busiest hour this group has ever produced and
// costs a few KB; ids are only recorded for updates we ACT on (below), so
// ordinary chatter cannot flush a pending /ask out of the window.
const SEEN_LIMIT = 500;
const seenUpdates = new Set<number>();

/** True the first time we see this update_id, false on every redelivery. */
function claimUpdate(id: number): boolean {
  if (seenUpdates.has(id)) return false;
  seenUpdates.add(id);
  // A Set iterates in insertion order, so the first key is always the oldest.
  while (seenUpdates.size > SEEN_LIMIT) {
    const oldest = seenUpdates.values().next().value;
    if (oldest === undefined) break;
    seenUpdates.delete(oldest);
  }
  return true;
}

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
    // Claimed HERE, not at the top: only updates we are actually going to work
    // on take a slot in the window. An update_id that is missing or unparseable
    // is not a Telegram update we recognise, and it is handled rather than
    // dropped — the secret header already proved who sent it.
    const updateId = Number(update?.update_id);
    if (Number.isFinite(updateId) && !claimUpdate(updateId)) {
      return Response.json({ ok: true, duplicate: true });
    }
    const cmd = text.split(/[\s@]/)[0].toLowerCase(); // "/status@PacificERPbot" -> "/status"
    // ACK FIRST, ANSWER AFTER. Everything below this line runs once the 200 is
    // on the wire, so Telegram's retry timer never starts. after() is Next's own
    // deferral (it uses the platform's waitUntil underneath) rather than a
    // floating promise, which on a serverless runtime is killed the moment the
    // response is flushed — the answer would simply never be sent.
    after(async () => {
      try {
        let reply: string | null;
        if (cmd === "/ask") {
          const q = text.replace(/^\/ask(@\S+)?\s*/i, "").trim();
          const { aiAnswer } = await import("@/lib/telegramAsk");
          reply = q ? await aiAnswer(q) : HELP_ASK;
        } else {
          reply = await answer(cmd);
        }
        if (reply) await sendTelegramTo(chatId, reply); // answer in the chat that asked
      } catch (e) {
        // The response is long gone, so this is the only place the failure can
        // be recorded. The group gets silence rather than a wrong answer.
        console.error("Telegram webhook deferred answer failed:", e);
      }
    });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Telegram webhook error:", e);
    return Response.json({ ok: true }); // never make Telegram retry-storm
  }
}
