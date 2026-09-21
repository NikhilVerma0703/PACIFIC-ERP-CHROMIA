// RAISING THE ALARM — the half of the stand-down alert that talks to things.
//
// The decision is next door in alert-rules.ts, which is pure and tested. This
// file only reads the last run, sends the Telegram message and creates the
// Integration_Log__c row. It is deliberately thin: everything here needs a
// database and a network to exercise, so as little as possible lives here.
//
// NOTHING IN THIS FILE MAY THROW. It is called at the exact moment a sync has
// decided it cannot write, and again from the route's catch block when a run
// has already failed. An alert that turns a stand-down into a crash — or a
// failure into a *different* failure, losing the original — is worse than no
// alert. Every call is wrapped, and the return value says what actually
// happened rather than what was attempted.
import { prisma } from "@/lib/prisma";
import { sendTelegram, esc } from "@/lib/telegram";
import { createRecord, readConfig } from "./client";
import {
  planStandDownAlert, integrationLogRecord, standDownTelegram,
  type PriorRun,
} from "./alert-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface AlertOutcome {
  /** Whether a Telegram message was sent, and when — the timestamp is stored
   *  in this run's summary so the NEXT run can apply the hourly rule. */
  telegramAt: string | null;
  /** The Id Salesforce gave the log row, or null if none was written (either
   *  because the event already had one, or because the create failed). */
  logId: string | null;
  /** Why nothing was written, when that is not obvious. Surfaced on the admin
   *  page rather than swallowed — a silent alerting system is the thing this
   *  whole file exists to prevent. */
  note: string | null;
}

const NOTHING: AlertOutcome = { telegramAt: null, logId: null, note: null };

/**
 * WHAT THE PREVIOUS RUN LEFT BEHIND.
 *
 * `recordRun` writes `summary.stoodDown` into sf_sync_run.error, so a prior
 * stand-down is simply a non-null error on the most recent finished run. The
 * alert timestamp is carried in the summary JSON under `alert.telegramAt`.
 *
 * DRY RUNS ARE EXCLUDED. A dry run cannot stand down (the guards are asked
 * after the `opts.dry` return), so it has no bearing on whether an event is
 * open — but it DOES write an sf_sync_run row, and letting it count as "the
 * previous run" would make every real stand-down after a dry run look new.
 */
async function priorRun(): Promise<PriorRun> {
  try {
    const rows: Array<{ error: string | null; telegram_at: string | null }> =
      await db.$queryRawUnsafe(
        `SELECT error, summary->'alert'->>'telegramAt' AS telegram_at
           FROM sf_sync_run
          WHERE finished_at IS NOT NULL AND dry = FALSE
          ORDER BY started_at DESC
          LIMIT 1`,
      );
    const r = rows[0];
    if (!r) return { stoodDown: false, lastTelegramAt: null };
    const at = r.telegram_at ? new Date(r.telegram_at) : null;
    return {
      stoodDown: !!r.error,
      lastTelegramAt: at && !Number.isNaN(at.getTime()) ? at : null,
    };
  } catch {
    // A database we cannot read is not a reason to stay quiet. Treating it as
    // "no previous run" makes this run look like a new event, which alerts —
    // erring towards one extra message rather than towards silence.
    return { stoodDown: false, lastTelegramAt: null };
  }
}

/**
 * Announce a stand-down, on both channels, subject to the rules next door.
 *
 * Returns what it did so the caller can store it in the run summary. Call this
 * BEFORE recordRun, and put the result under `alert` in the summary.
 */
export async function alertStandDown(
  message: string,
  payload: unknown,
  now: Date = new Date(),
): Promise<AlertOutcome> {
  const plan = planStandDownAlert(await priorRun(), now);
  if (!plan.telegram && !plan.log) return NOTHING;

  // The log row goes FIRST, so the Telegram message can say truthfully whether
  // Salesforce was told. Getting this order wrong would mean either claiming an
  // alert we had not raised, or saying nothing about it at all.
  let logId: string | null = null;
  let note: string | null = null;
  if (plan.log) {
    const r = await writeIntegrationLog("Retry", message, payload);
    logId = r.id;
    note = r.note;
  }

  let telegramAt: string | null = null;
  if (plan.telegram) {
    const text = standDownTelegram({
      // esc, because this sentence carries live figures interpolated from the
      // Salesforce limit headers and the message is sent as HTML.
      message: esc(message),
      newEvent: plan.newEvent,
      logged: logId !== null,
    });
    const sent = await sendTelegram(text).catch(() => false);
    if (sent) telegramAt = now.toISOString();
    else note = [note, "Telegram was not sent (no bot token, or the send failed)."].filter(Boolean).join(" ");
  }

  return { telegramAt, logId, note };
}

/**
 * A run that ERRORED OUT, as against one that stood down.
 *
 * Status__c "Failed", per REPLY-9: a stand-down retries by itself, a crash does
 * not, and the administrator's alert reacts to both. There is no event grouping
 * here on purpose — a run that throws is rare and each one is worth a row.
 */
export async function alertRunFailed(err: unknown, payload?: unknown): Promise<AlertOutcome> {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const r = await writeIntegrationLog("Failed", `Stock sync failed: ${message}`, payload);
  const sent = await sendTelegram(
    `🛑 <b>Salesforce stock sync failed</b>\n\n${esc(message)}\n\n` +
    (r.id
      ? "An <code>Integration_Log__c</code> row was written, so Salesforce has been alerted too."
      : "<b>The Integration_Log__c row could NOT be written</b> — this message is the only warning."),
  ).catch(() => false);
  return { telegramAt: sent ? new Date().toISOString() : null, logId: r.id, note: r.note };
}

/** The one Salesforce write this module makes. Never throws. */
async function writeIntegrationLog(
  status: "Retry" | "Failed",
  message: string,
  payload: unknown,
): Promise<{ id: string | null; note: string | null }> {
  const cfg = readConfig();
  if (!cfg) return { id: null, note: "Salesforce is not configured, so no log row was written." };
  try {
    const res = await createRecord(cfg, "Integration_Log__c", integrationLogRecord({ status, message, payload }));
    if (res.success && res.id) return { id: res.id, note: null };
    const why = (res.errors ?? []).map((e) => e.message).join("; ");
    return { id: null, note: `Integration_Log__c was refused: ${why.slice(0, 200)}` };
  } catch (e) {
    // Including — and especially — when the org is out of API calls entirely.
    // That is the one case where the alert cannot get through, and the Telegram
    // message beside it is then the only warning anybody gets. It says so.
    return { id: null, note: `Integration_Log__c failed: ${(e as Error).message.slice(0, 200)}` };
  }
}
