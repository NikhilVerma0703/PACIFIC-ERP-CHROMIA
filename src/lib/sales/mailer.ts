// Sales mailer — SOFT-FAIL BY DESIGN. Until SMTP is configured (either the
// per-salesperson users.smtp_* columns — optional scripts/0021 — or the global
// SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM env vars) sendMail() logs
// a warning and returns { sent: false } instead of throwing, so PI sends,
// dispatch mails, reminders etc. never break the business flow around them.
// getSpTransport() DOES throw a descriptive error — /api/sales/me/test-smtp
// relies on that to tell the user exactly what's missing.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";

/** Lazy-require so the module loads (and sendMail soft-fails with a clear
 * reason) even before `npm install` has put nodemailer on the server. */
function createTransport(options: any): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport(options);
}

export interface MailResult {
  sent: boolean;
  reason?: string;
}

type SpTransport = { transport: any; from: string };

/** users.smtp_* via raw SQL: the columns are OPTIONAL (scripts/0021, applied by
 * the user) and deliberately not in the Prisma model — a missing column must
 * degrade to "not configured", never crash. */
async function userSmtpRow(spId: string): Promise<{
  name: string | null;
  email: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
}> {
  let name: string | null = null;
  let email: string | null = null;
  try {
    const base: any[] = await (prisma as any).$queryRaw`
      SELECT name, email FROM users WHERE id = ${spId}`;
    name = base[0]?.name ?? null;
    email = base[0]?.email ?? null;
  } catch {
    /* ignore */
  }
  try {
    const rows: any[] = await (prisma as any).$queryRaw`
      SELECT smtp_host, smtp_port, smtp_user, smtp_pass FROM users WHERE id = ${spId}`;
    const r = rows[0] ?? {};
    return {
      name,
      email,
      smtpHost: r.smtp_host ?? null,
      smtpPort: r.smtp_port == null ? null : Number(r.smtp_port),
      smtpUser: r.smtp_user ?? null,
      smtpPass: r.smtp_pass ?? null,
    };
  } catch {
    // smtp_* columns not provisioned yet (scripts/0021 not applied)
    return { name, email, smtpHost: null, smtpPort: null, smtpUser: null, smtpPass: null };
  }
}

/** Transport for a salesperson: their own SMTP settings when present, else the
 * global SMTP_* env, else THROWS "SMTP not configured…" (callers that must not
 * break go through sendMail, which catches). */
export async function getSpTransport(spId: string): Promise<SpTransport> {
  const u = await userSmtpRow(spId);
  if (u.smtpHost && u.smtpUser && u.smtpPass) {
    const port = u.smtpPort ?? 587;
    return {
      transport: createTransport({
        host: u.smtpHost,
        port,
        secure: port === 465,
        auth: { user: u.smtpUser, pass: u.smtpPass },
      }),
      from: `"${u.name ?? "Pacific Group"}" <${u.smtpUser}>`,
    };
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const port = Number(SMTP_PORT || 587);
    return {
      transport: createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      }),
      from: SMTP_FROM || `"${u.name ?? "Pacific Group"}" <${SMTP_USER}>`,
    };
  }
  throw new Error(
    `SMTP not configured for user ${spId} — set the user's SMTP in Sales → Settings (needs scripts/0021) or the SMTP_HOST/SMTP_USER/SMTP_PASS env vars`,
  );
}

/** Send an email on behalf of a salesperson. NEVER throws: when SMTP is not
 * configured (or the send fails) it logs and returns { sent: false }. */
export async function sendMail(opts: {
  spId: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}): Promise<MailResult> {
  try {
    const { transport, from } = await getSpTransport(opts.spId);
    await transport.sendMail({
      from,
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      cc: opts.cc ? (Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc) : undefined,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments,
    });
    return { sent: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    console.warn(`[sales/mailer] mail "${opts.subject}" NOT sent: ${reason}`);
    return { sent: false, reason };
  }
}
