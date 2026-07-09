// Telegram group notifications via the Bot API. No-ops (returns false) when
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not configured, so the ERP never
// breaks because Telegram is down or unset. HTML parse mode; 4096-char cap.
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
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

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Send a photo (raw bytes) with caption to the group. Falls back to false on
 * any failure — callers treat Telegram as strictly best-effort. */
export async function sendTelegramPhoto(caption: string, data: Uint8Array, filename = "photo.jpg", mime = "image/jpeg"): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const fd = new FormData();
    fd.set("chat_id", chatId);
    fd.set("caption", caption.slice(0, 1024));
    fd.set("parse_mode", "HTML");
    fd.set("photo", new Blob([data as BlobPart], { type: mime }), filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: fd });
    if (!res.ok) console.error("Telegram photo failed:", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.error("Telegram photo error:", e);
    return false;
  }
}
