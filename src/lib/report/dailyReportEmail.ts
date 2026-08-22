import "server-only";

import { createTransport } from "nodemailer";

import { reportBody, reportRecipients } from "@/lib/report/dailyReportText";

// Yesterday's production report, emailed to the team each morning.
//
// This automates an email somebody was sending by hand, so it keeps the shape
// of that email - the greeting, the sentence naming the date, the sign-off -
// because the recipients already know what it looks like and a sudden change
// of format reads as a different, less trustworthy message.
//
// WHAT IT DOES NOT DO IS PRETEND TO BE TYPED. Auto-Submitted and
// X-Auto-Response-Suppress are set, which is what tells other mail systems
// this is machine-generated: it stops holiday auto-replies bouncing back every
// morning and stops anything that reads headers taking it for a personal note.
// The body reads like the original; the envelope is honest.

export interface SendResult {
  ok: boolean;
  /** Why nothing was sent, in words. Null when it was. */
  skipped: string | null;
  to: string[];
  date: string;
  bytes: number;
  messageId?: string;
}

/**
 * Send one day's report.
 *
 * SOFT-FAILS on configuration, the same way the sales mailer does: a missing
 * recipient list or missing SMTP returns ok:false with a sentence saying which,
 * rather than throwing. A cron that 500s every morning until somebody reads the
 * logs is worse than one that says plainly what it is waiting for.
 *
 * THROWS on a genuine send failure, because that IS an error and the caller
 * should surface it rather than report success.
 */
export async function sendDailyReport(opts: {
  date: string;
  pdf: Buffer;
  fileName: string;
  /** Overrides the env list. Used by the manual trigger to send a test to one
   *  address without emailing the whole team. */
  to?: string[];
}): Promise<SendResult> {
  const to = opts.to?.length ? opts.to : reportRecipients(process.env.DAILY_REPORT_EMAILS);
  const base = { to, date: opts.date, bytes: opts.pdf.length };

  if (!to.length) {
    return { ok: false, skipped: "DAILY_REPORT_EMAILS is not set, so there is nobody to send to.", ...base };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return { ok: false, skipped: "SMTP is not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS.", ...base };
  }

  const sender = {
    name: process.env.DAILY_REPORT_FROM_NAME || "Pacific Surfaces",
    title: process.env.DAILY_REPORT_FROM_TITLE || "Pacific Surfaces",
    email: SMTP_FROM?.match(/<([^>]+)>/)?.[1] ?? SMTP_FROM ?? SMTP_USER,
  };
  const { text, html } = reportBody(opts.date, sender);

  const port = Number(SMTP_PORT || 587);
  const transport = createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const info = await transport.sendMail({
    from: SMTP_FROM || `"${sender.name}" <${SMTP_USER}>`,
    to,
    subject: "Yesterday's Daily ERP Report",
    text,
    html,
    attachments: [{ filename: opts.fileName, content: opts.pdf, contentType: "application/pdf" }],
    headers: {
      // Machine-generated. Stops out-of-office replies coming back every
      // morning, and tells anything that reads headers what this is.
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
    },
  });

  // NODEMAILER ONLY REJECTS WHEN EVERY RECIPIENT FAILS. One bad address among
  // six resolves happily with that address in `rejected`, so reporting plain
  // success here would hide a person who silently stopped receiving the report.
  const rejected = (info.rejected ?? []).map((r) => (typeof r === "string" ? r : String(r)));
  if (rejected.length) {
    return {
      ...base,
      ok: true,
      skipped: `sent, but ${rejected.length} address(es) were rejected: ${rejected.join(", ")}`,
      messageId: info.messageId,
    };
  }
  return { ok: true, skipped: null, ...base, messageId: info.messageId };
}
