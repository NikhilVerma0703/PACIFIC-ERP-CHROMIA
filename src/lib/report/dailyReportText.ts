// The parts of the daily report email that are just text.
//
// NO IMPORTS, deliberately - the same reason lib/roles.ts and lib/costing/
// gritAssign.ts have none. `node --test` resolves neither the "@/" alias nor
// "server-only", and a rule that can only be checked by sending a real email
// to a real team every morning is a rule nobody checks.
//
// The sending itself lives in dailyReportEmail.ts, which needs a server.
/** Who gets it. A comma or semicolon separated list, so it can be changed in
 *  the hosting dashboard without a deploy — the same convention as
 *  WEIGHTS_VERIFIER_EMAILS. */
export function reportRecipients(raw: string | undefined | null): string[] {
  return String(raw ?? "")
    // WHITESPACE IS A SEPARATOR TOO. This split was /[,;]/, and the value is
    // typed into a Vercel environment-variable box by a person — where the
    // natural thing to do with three addresses is put one on each line, or to
    // paste them separated by spaces. The old split returned the whole blob as
    // a SINGLE entry, it contained "@" so it passed the filter, and nodemailer
    // was handed one malformed address instead of three good ones. An address
    // cannot contain unquoted whitespace, so splitting on it loses nothing.
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    // And the shape is checked rather than just looking for an "@", so a blob
    // that survives some future edit is DROPPED and shows up as a short
    // recipient count in the log, instead of being posted to the mail server
    // as a recipient and bouncing where nobody reads it.
    .filter((s) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s));
}

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
 * The date as the email says it: "August 21, 2026".
 *
 * Built from the ISO parts rather than toLocaleDateString with a timezone,
 * because the date has already been decided upstream (the report's own day) and
 * re-interpreting it in a locale can move it by one across midnight — which
 * would put yesterday's numbers under the day before's name.
 */
export function longDate(iso: string): string {
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The body, as the team already receives it. */
export function reportBody(iso: string, sender: { name: string; title: string; email: string }): {
  text: string;
  html: string;
} {
  const when = longDate(iso);
  const text = [
    "Dear Team,",
    "",
    `I am writing to share the latest Pacific-ERP daily report for ${when}.`,
    "",
    "Please let me know if you have any questions.",
    "Best regards,",
    sender.name,
    "",
    "--",
    `${sender.name} | ${sender.title}`,
    sender.email,
  ].join("\n");

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202124;line-height:1.5">`,
    `<p>Dear Team,</p>`,
    `<p>I am writing to share the latest Pacific-ERP daily report for ${esc(when)}.</p>`,
    `<p>Please let me know if you have any questions.<br>Best regards,<br>${esc(sender.name)}</p>`,
    `<p style="color:#5f6368">--</p>`,
    `<p style="margin:0"><b>${esc(sender.name)}</b><br>`,
    `<span style="color:#5f6368">${esc(sender.title)}</span><br>`,
    `<a href="mailto:${esc(sender.email)}">${esc(sender.email)}</a></p>`,
    `</div>`,
  ].join("");

  return { text, html };
}
