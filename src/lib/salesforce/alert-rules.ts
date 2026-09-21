// WHEN A STAND-DOWN IS WORTH TELLING SOMEBODY ABOUT — the decision, alone.
//
// Pacific's Salesforce administrator asked for two alerts on a stand-down
// (REPLY-9, 19 September 2026), and both are rate-limited in ways that need
// memory of earlier runs:
//
//   Telegram   "on the first stand-down, then at most once an hour"
//   Salesforce "one Integration_Log__c row per stand-down EVENT
//               (not per run, not per record)"
//
// The sync runs every ten minutes. An org that is out of API allowance stays
// out of it for hours, so the naive reading — alert whenever stoodDown is set —
// is 6 Telegram messages an hour and 144 log rows a day, all saying the same
// sentence. That is not an alert, it is a reason to mute the group.
//
// SO THE UNIT IS THE EVENT, NOT THE RUN. An event BEGINS on the first run that
// stands down after a run that did not, and ENDS on the first run that writes
// normally again. Everything below is that one idea.
//
// AND THERE IS A SECOND REASON THE LOG ROW IS PER EVENT. Creating it costs one
// Salesforce API call — spent at the exact moment we have decided we have too
// few API calls left to write anything. One call per event is affordable and
// honest; one per run would mean the alert about running out of calls is itself
// burning them, 144 times a day. The administrator's spec and the constraint
// happen to agree, which is usually the sign of a rule worth keeping.
//
// PURE, AND THEREFORE ACTUALLY TESTED. This file reads no database, sends no
// message and imports nothing. `alert.ts` beside it does the talking. The
// codebase's own standard, from lib/costing/batchRates.ts: "a rule that can
// only be checked by opening a screen is a rule nobody checks."

/** At most one Telegram message per hour while a stand-down persists. */
export const TELEGRAM_REPEAT_MS = 60 * 60 * 1000;

/** What the previous run tells us, read out of sf_sync_run. All three may be
 *  absent — the very first run ever has no predecessor, and a fresh event has
 *  no earlier alert. */
export interface PriorRun {
  /** Was the run immediately before this one ALSO stood down? False when the
   *  last run wrote normally, when it failed for another reason, or when there
   *  was no previous run at all. */
  stoodDown: boolean;
  /** When we last sent a Telegram message about the CURRENT event, if we have.
   *  Null starts the hour afresh, which is right: a new event alerts at once. */
  lastTelegramAt: Date | null;
}

export interface AlertPlan {
  /** Send the Telegram message now. */
  telegram: boolean;
  /** Create the Integration_Log__c row now. */
  log: boolean;
  /** True when this run OPENED the event, as against continuing one. Carried
   *  so the message can say which it is — "the sync has stood down" reads very
   *  differently from "the sync is still stood down", and an operator who gets
   *  the second one an hour later should not think it is a new fault. */
  newEvent: boolean;
}

/**
 * What to do about a run that has just stood down.
 *
 * The log row follows the event exactly. The Telegram message follows the
 * event OR the hour, whichever comes first — so a stand-down that persists all
 * afternoon produces one log row and one message an hour, and a stand-down
 * that clears and returns produces a fresh pair of both.
 */
export function planStandDownAlert(prior: PriorRun, now: Date): AlertPlan {
  const newEvent = !prior.stoodDown;
  if (newEvent) return { telegram: true, log: true, newEvent: true };

  // Same event, still running. The log row already exists; only the hourly
  // reminder is left to decide.
  //
  // A MISSING TIMESTAMP MEANS SEND, not skip. We are inside an event (the
  // previous run stood down) and yet no Telegram is recorded for it — either
  // the send failed, or the row that would have remembered it was not written.
  // Both are cases where nobody has been told, and the failure mode of sending
  // twice is far cheaper than the failure mode of an outage nobody hears about.
  const due = prior.lastTelegramAt == null
    || now.getTime() - prior.lastTelegramAt.getTime() >= TELEGRAM_REPEAT_MS;
  return { telegram: due, log: false, newEvent: false };
}

/**
 * The Integration_Log__c record, exactly as the administrator specified it.
 *
 * The field values are quoted from REPLY-9 and are NOT to be tidied. In
 * particular `Touchpoint__c` is "T3 - Inventory lookup" with a HYPHEN — the
 * picklist in the org uses hyphens, an en-dash is a different string, and a
 * bad picklist value fails the whole create. ADMIN-HANDOFF.md §4.7 says the
 * same thing about the T8 value, for the same reason.
 *
 * `status` is the one field that varies: "Retry" for a stand-down, because the
 * next run genuinely will try again, and "Failed" for a run that errored out
 * and will not resume by itself. Their alert reacts to both.
 */
export function integrationLogRecord(opts: {
  status: "Retry" | "Failed";
  message: string;
  payload?: unknown;
}): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    Direction__c: "Inbound",
    Status__c: opts.status,
    Touchpoint__c: "T3 - Inventory lookup",
    Object_Type__c: "ERP_Stock__c",
    // Long text fields have a hard cap in Salesforce and a create that exceeds
    // it is rejected outright — so the alert about a failure would itself fail.
    Error_Message__c: String(opts.message ?? "").slice(0, 255),
  };
  // "the run summary JSON, IF IT'S SMALL" — their words. A summary that does
  // not fit is dropped rather than truncated: half a JSON document is not
  // JSON, and a field holding `{"wrote":{"stockRows":0,"fa` is worse than an
  // empty one, because it looks like data.
  if (opts.payload !== undefined) {
    const json = safeJson(opts.payload);
    if (json && json.length <= PAYLOAD_MAX) rec.Payload__c = json;
  }
  return rec;
}

/** Salesforce's Long Text Area default. Anything at or under this is "small". */
export const PAYLOAD_MAX = 32_000;

function safeJson(v: unknown): string | null {
  try { return JSON.stringify(v); } catch { return null; }
}

/** The Telegram text. HTML parse mode — see lib/telegram.ts — so the caller
 *  escapes anything that came from outside. The sentence the administrator
 *  asked us to send IS `message`; this only frames it. */
export function standDownTelegram(opts: {
  message: string;
  newEvent: boolean;
  logged: boolean;
}): string {
  const head = opts.newEvent
    ? "⚠️ <b>Salesforce stock sync has stood down</b>"
    : "⚠️ <b>Salesforce stock sync is still stood down</b>";
  const tail = opts.newEvent
    ? (opts.logged
        // Said explicitly because it is the administrator's own tripwire: a
        // Retry row on their side pages them within the minute. If we could
        // not write it, whoever reads this message is the only one who knows.
        ? "\n\nAn <code>Integration_Log__c</code> row was written, so Salesforce has been alerted too."
        : "\n\n<b>The Integration_Log__c row could NOT be written</b>, so Salesforce has not been alerted — this message is the only warning.")
    : "\n\nThis is the hourly reminder; Salesforce was told when it started.";
  return `${head}\n\n${opts.message}\n\nStock in Salesforce is unchanged. The next run will send it.${tail}`;
}
