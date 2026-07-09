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
