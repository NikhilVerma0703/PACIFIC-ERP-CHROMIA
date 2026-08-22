import { NextResponse } from "next/server";

import { sendDailyReport } from "@/lib/report/dailyReportEmail";
import { reportRecipients } from "@/lib/report/dailyReportText";

/**
 * GET /api/report/daily-email — yesterday's production report, emailed out.
 *
 * PARKED, 2026-08-22. The vercel.json cron entry that drove this has been
 * removed at the owner's request, so nothing calls this on a schedule and no
 * email goes out. Everything else is intact and tested; re-enabling is one
 * entry back in vercel.json:
 *
 *     { "path": "/api/report/daily-email", "schedule": "30 3 * * *" }
 *
 * It stays reachable by hand with the secret, which is how it should be
 * tested before the schedule goes back on.
 *
 * When it ran, it ran at 03:30 UTC, which is 09:00 IST. Vercel's
 * scheduler sends `Authorization: Bearer <CRON_SECRET>`; the house pattern in
 * /api/sales/cron/payment-reminders uses `x-cron-secret`. BOTH are accepted, so
 * the same URL works from the platform scheduler and from cron-job.org or curl.
 *
 * ?date=YYYY-MM-DD overrides the day, and ?to=a@b.com sends only to that
 * address — together they are how you test this without emailing the team.
 *
 * NOT PUBLIC. Without CRON_SECRET set this refuses everything rather than
 * defaulting to open: an endpoint that mails a production report to a list is
 * not one to leave reachable by accident.
 */
export const dynamic = "force-dynamic";
// A day of MIS, polishing and QC is a lot of queries, and pdfmake then lays out
// two A4 pages. The default 10s is not enough.
export const maxDuration = 120;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json(
      { error: process.env.CRON_SECRET ? "Unauthorized" : "CRON_SECRET is not configured" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);

  // A MALFORMED DATE IS AN ERROR, NOT A SHRUG. Falling back to yesterday
  // meant a typo in ?date= mailed yesterday's report to the whole team under
  // a heading nobody would question - the caller asked for a specific day and
  // got a different one, silently.
  const asked = url.searchParams.get("date")?.trim();
  if (asked && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  // ?to= MAY ONLY NAME SOMEBODY WHO IS ALREADY A RECIPIENT.
  //
  // It exists so a test can go to one address instead of the whole team. But
  // CRON_SECRET is shared with the Telegram and sales crons, lives in a GitHub
  // Actions secret, and this file tells you to paste it into cron-job.org.
  // Holding it used to buy a Telegram message into the company's own chat;
  // an unchecked ?to= would turn it into a way to mail the full production
  // PDF - output, targets, downtime, QC - to any address on earth, from the
  // company's own mailbox, with nothing in the logs to tell it apart from a
  // legitimate test. Intersecting with the configured list keeps the useful
  // half and removes the exfiltration.
  const to = url.searchParams.get("to")?.trim();
  if (to) {
    const allowed = reportRecipients(process.env.DAILY_REPORT_EMAILS);
    if (!allowed.some((a) => a.toLowerCase() === to.toLowerCase())) {
      return NextResponse.json(
        { error: "?to= must be one of the addresses already in DAILY_REPORT_EMAILS" },
        { status: 400 },
      );
    }
  }

  try {
    // Imported here, not at module scope. The generator is an .mjs script that
    // opens its own PrismaClient and reads fonts off disk at import time; doing
    // that on every cold start of an unrelated route would be wasteful, and a
    // font problem would break the module rather than this one request.
    const { buildDailyReportPdf, yesterdayUTC, FONT_TIER } =
      await import("../../../../../scripts/make-daily-report-pdf.mjs");

    const day: string = asked ?? yesterdayUTC();
    const built = await buildDailyReportPdf(day);

    // A plant that did not run is not an error. Saying so and sending nothing
    // is the right answer — a Sunday should not produce a stack trace, and it
    // should not produce an empty report either.
    if (!built) {
      return NextResponse.json({ ok: true, sent: false, date: day, reason: "No MIS rows for that day." });
    }

    const res = await sendDailyReport({
      date: day,
      pdf: built.pdf,
      fileName: built.fileName,
      to: to ? [to] : undefined,
    });

    // Logged whichever way it went: this runs unattended, so the log is the
    // only place anybody can find out what happened.
    console.log(
      `[report/daily-email] ${day} ${res.ok ? "sent" : "skipped"} ` +
      `to=${res.to.length} bytes=${res.bytes} font="${FONT_TIER}"` +
      (res.skipped ? ` reason="${res.skipped}"` : ""),
    );

    return NextResponse.json({
      ok: res.ok,
      sent: res.ok,
      date: day,
      to: res.to.length,
      bytes: res.bytes,
      slabs: `${built.summary.made}/${built.summary.target}`,
      fontTier: FONT_TIER,
      ...(res.skipped ? { reason: res.skipped } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[report/daily-email]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
