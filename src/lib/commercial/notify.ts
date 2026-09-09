// Outbound notices from the Commercial module. ONE function per event, all of
// them off by default: the owner has not decided the channel ("maybe telegram
// and mail together or just telegram — we'll see", 2026-09-05), and wants
// shortages to land on the Production Planning page BEFORE anyone is messaged.
// So today every notice is recorded on the request row (notifiedAt/notifiedVia)
// and sent only where settings.notify says so. Turning a channel on is a
// settings change, not a code change.
//
// Telegram goes to the plant's existing MIS group (TELEGRAM_CHAT_ID) via
// lib/telegram.ts, which no-ops without the env keys. Mail uses the sales
// module's nodemailer transport (lib/sales/mailer.ts), which returns
// { sent:false } when unconfigured — never throws.
import { prisma } from "@/lib/prisma";
import { sendTelegram, sendTelegramTo, esc } from "@/lib/telegram";
import { loadSettings } from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface ShortageNotice {
  requestId: string;
  design: string;
  thickness: string;
  qtyRequired: number;
  qtyAvailable: number;
  qtyShort: number;
  orderNumber: string | null;
  customer: string | null;
  raisedBy: string | null;
  /** users.id of the login raising it. Answer 13 wants the mail "from
   *  Santosh's ID": with mailFromCommercialLogin on, sendMail uses this login's
   *  own SMTP row when it has one and the global SMTP otherwise. */
  fromUserId?: string | null;
}

/** Tell whoever the settings say about a stock shortfall. Returns the
 *  channels that actually sent. Always safe to call. */
export async function notifyShortage(n: ShortageNotice): Promise<string[]> {
  const s = await loadSettings();
  const sent: string[] = [];
  const text = `<b>Stock short</b> — ${esc(n.design)} ${esc(n.thickness)}\n`
    + `Required ${n.qtyRequired}, available ${n.qtyAvailable}, short <b>${n.qtyShort}</b>\n`
    + (n.orderNumber ? `Order ${esc(n.orderNumber)}${n.customer ? ` · ${esc(n.customer)}` : ""}\n` : "")
    + (n.raisedBy ? `Raised by ${esc(n.raisedBy)}` : "");
  if (s.notify.telegram) {
    // Answer 13: "a telegram message to Varun Mundra privately" — one chat id
    // from the environment, not the plant's MIS group. Falls back to the group
    // only when private is OFF; a missing private id sends nowhere rather than
    // broadcasting a stock shortfall to the whole floor by accident.
    const privateId = (process.env.TELEGRAM_COMMERCIAL_CHAT_ID ?? "").trim();
    try {
      if (s.notify.telegramPrivate) {
        if (privateId && await sendTelegramTo(privateId, text)) sent.push("telegram");
      } else if (await sendTelegram(text)) {
        sent.push("telegram");
      }
    } catch (e) { console.error("[commercial] telegram failed:", (e as Error).message); }
  }
  if (s.notify.mail && s.notify.mailTo.length) {
    try {
      const { sendMail } = await import("@/lib/sales/mailer");
      // sendMail resolves spId → that user's smtp_* row, else the global SMTP env.
      const spId = s.notify.mailFromCommercialLogin && n.fromUserId ? n.fromUserId : "commercial";
      const r = await sendMail({ spId, to: s.notify.mailTo, subject: `Stock short: ${n.design} ${n.thickness} (${n.qtyShort} slabs)`, html: `<pre style="font-family:Arial">${text.replace(/<\/?b>/g, "")}</pre>` });
      if (r.sent) sent.push("mail");
    } catch (e) { console.error("[commercial] mail failed:", (e as Error).message); }
  }
  try {
    await db.commercialProductionRequest.update({ where: { id: n.requestId }, data: { notifiedAt: new Date(), notifiedVia: sent.length ? sent.join("+") : "planning-page" } });
  } catch { /* the request row may already be gone */ }
  return sent;
}
