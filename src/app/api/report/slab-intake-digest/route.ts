import { NextResponse } from "next/server";
import { createTransport } from "nodemailer";

import { reportRecipients } from "@/lib/report/dailyReportText";
import { secretEqual } from "@/lib/secretEqual";
import {
  buildIntakeDigest, digestWindow, digestSubject, digestBody,
  type WindowKind,
} from "@/lib/report/slabIntakeDigest";

/**
 * GET /api/report/slab-intake-digest — what the slab-intake form recorded this
 * half of the day, emailed to the person who owns that form.
 *
 * TWO RUNS A DAY, from vercel.json:
 *     { "path": "/api/report/slab-intake-digest", "schedule": "31 12 * * *" }   18:01 IST — the day shift
 *     { "path": "/api/report/slab-intake-digest", "schedule": "31 0 * * *"  }   06:01 IST — the night shift
 * Vercel's scheduler is UTC; 12:31 and 00:31 UTC are 18:01 and 06:01 IST. Which
 * window a run reports is decided by ITS OWN CLOCK, not by which schedule fired
 * it, so a late or retried job still closes the shift it was meant to.
 *
 * GATED LIKE THE DAILY REPORT. Vercel sends `Authorization: Bearer <CRON_SECRET>`;
 * the house pattern in /api/sales/cron/payment-reminders uses `x-cron-secret`.
 * Both are accepted. Without CRON_SECRET set this refuses everything rather than
 * defaulting to open.
 *
 * TESTING, without mailing the owner:
 *     ?window=day|night   force the half rather than letting the clock decide
 *     ?to=a@b.com         send only there
 *     ?dry=1              build it and return the text, send nothing
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_TO = "gibin@thepacific.group";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (secretEqual(req.headers.get("x-cron-secret"), secret)) return true;
  return secretEqual(req.headers.get("authorization"), `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json(
      { error: process.env.CRON_SECRET ? "Unauthorized" : "CRON_SECRET is not configured" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const forced = url.searchParams.get("window");
  if (forced && forced !== "day" && forced !== "night") {
    return NextResponse.json({ error: 'window must be "day" or "night"' }, { status: 400 });
  }
  const dry = url.searchParams.get("dry") === "1";
  const only = reportRecipients(url.searchParams.get("to"));

  const win = digestWindow(Date.now(), (forced as WindowKind | null) ?? undefined);

  let digest;
  try {
    digest = await buildIntakeDigest(win);
  } catch (e) {
    console.error("[report/slab-intake-digest] could not read the intake log", e);
    return NextResponse.json({ error: "Could not read the intake log" }, { status: 500 });
  }

  const base = url.origin.replace(/\/$/, "");
  const { text, html } = digestBody(digest, `${base}/slab-intake`);
  const subject = digestSubject(digest);

  if (dry) return NextResponse.json({ ok: true, dryRun: true, window: win, subject, text });

  // NOTHING ENTERED IS NOT NOTHING TO SAY — but it is not worth an email twice a
  // day either, so it is skipped unless SLAB_INTAKE_DIGEST_SEND_EMPTY is set.
  // The response still reports it, so a cron log shows the job ran and found
  // the shift silent rather than looking like it failed.
  if (!digest.slabs.length && process.env.SLAB_INTAKE_DIGEST_SEND_EMPTY !== "1") {
    return NextResponse.json({ ok: true, sent: false, reason: "nothing was entered in this window", window: win });
  }

  const to = only.length ? only : reportRecipients(process.env.SLAB_INTAKE_DIGEST_EMAILS || DEFAULT_TO);
  if (!to.length) {
    return NextResponse.json({ ok: false, sent: false, reason: "no recipient — set SLAB_INTAKE_DIGEST_EMAILS", window: win });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json({
      ok: false, sent: false,
      reason: "SMTP is not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS",
      window: win, to,
    });
  }

  const port = Number(SMTP_PORT || 587);
  const transport = createTransport({
    host: SMTP_HOST, port, secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    const info = await transport.sendMail({
      from: SMTP_FROM || `"Pacific Surfaces" <${SMTP_USER}>`,
      to, subject, text, html,
      headers: {
        // Machine-generated: no out-of-office replies coming back twice a day.
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    });
    // Nodemailer only rejects when EVERY address fails, so a partial failure has
    // to be read off `rejected` or a silently dropped recipient looks like success.
    const rejected = (info.rejected ?? []).map((r) => (typeof r === "string" ? r : String(r)));
    console.log(`[report/slab-intake-digest] ${win.kind} ${win.from.toISOString()}..${win.to.toISOString()} `
      + `slabs=${digest.slabs.length} to=${to.length}${rejected.length ? ` rejected=${rejected.length}` : ""}`);
    return NextResponse.json({
      ok: true, sent: true, window: win, to, subject,
      slabs: digest.slabs.length, added: digest.addedCount,
      corrected: digest.correctedCount, photos: digest.photoCount,
      ...(rejected.length ? { rejected } : {}),
    });
  } catch (e) {
    console.error("[report/slab-intake-digest] send failed", e);
    return NextResponse.json({ error: "Send failed", detail: (e as Error).message }, { status: 500 });
  }
}
