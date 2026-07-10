// Telegram group notifications via the Bot API. No-ops (returns false) when
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not configured, so the ERP never
// breaks because Telegram is down or unset. HTML parse mode; 4096-char cap.
/** TELEGRAM_CHAT_ID may be a comma-separated list — reports broadcast to all. */
export function telegramChatIds(): string[] {
  return String(process.env.TELEGRAM_CHAT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Send to ONE specific chat (used by the webhook to reply where asked). */
export async function sendTelegramTo(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("Telegram send failed:", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.error("Telegram send error:", e);
    return false;
  }
}

/** Broadcast to every configured chat; true when at least one delivery worked. */
export async function sendTelegram(text: string): Promise<boolean> {
  const ids = telegramChatIds();
  if (!ids.length) return false;
  const results = await Promise.all(ids.map((id) => sendTelegramTo(id, text)));
  return results.some(Boolean);
}

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Send a photo (raw bytes) with caption to the group. Falls back to false on
 * any failure — callers treat Telegram as strictly best-effort. */
export async function sendTelegramPhoto(caption: string, data: Uint8Array, filename = "photo.jpg", mime = "image/jpeg"): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = telegramChatIds();
  if (!token || !ids.length) return false;
  let ok = false;
  for (const chatId of ids) {
  try {
    const fd = new FormData();
    fd.set("chat_id", chatId);
    fd.set("caption", caption.slice(0, 1024));
    fd.set("parse_mode", "HTML");
    fd.set("photo", new Blob([data as BlobPart], { type: mime }), filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: fd });
    if (!res.ok) console.error("Telegram photo failed:", res.status, await res.text().catch(() => ""));
    ok = ok || res.ok;
  } catch (e) {
    console.error("Telegram photo error:", e);
  }
  }
  return ok;
}
