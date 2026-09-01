import { test } from "node:test";
import assert from "node:assert/strict";
import { reportRecipients, longDate, reportBody } from "../src/lib/report/dailyReportText.ts";

// The scheduled report replaces an email somebody was sending by hand, so the
// parts a person reads are pinned: get the date wrong and yesterday's numbers
// go out under the wrong day's name.

test("the recipient list is editable without a deploy, and tolerates how people type", () => {
  assert.deepEqual(
    reportRecipients("a@x.com, b@x.com;c@x.com ,  d@x.com "),
    ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
  );
  // Anything without an @ is not an address. A stray word must not become a
  // recipient the send then fails on.
  assert.deepEqual(reportRecipients("a@x.com, , nonsense, b@x.com"), ["a@x.com", "b@x.com"]);
});

test("an unset list is empty, not a crash", () => {
  // sendDailyReport turns this into a skip with a sentence, rather than throwing
  // in a cron every morning until somebody reads the logs.
  for (const v of [undefined, null, "", "   ", ","]) {
    assert.deepEqual(reportRecipients(v), []);
  }
});

test("the date reads the way the email has always read it", () => {
  assert.equal(longDate("2026-08-21"), "August 21, 2026");
  assert.equal(longDate("2026-01-01"), "January 1, 2026");
  assert.equal(longDate("2026-12-31"), "December 31, 2026");
});

test("the date is NOT re-interpreted in a timezone", () => {
  // The day was already decided upstream - it is the report's own day. Passing
  // it through a Date and a locale can move it by one across midnight, which
  // would put yesterday's figures under the day before's name. Built from the
  // ISO parts for exactly that reason.
  assert.equal(longDate("2026-08-01"), "August 1, 2026");
  assert.equal(longDate("2026-03-01"), "March 1, 2026");
  // Malformed input falls back to itself rather than inventing a date.
  assert.equal(longDate("not-a-date"), "not-a-date");
});

test("the body says what the hand-sent one said", () => {
  const sender = { name: "Abdullah Ashraf", title: "Senior Product Manager, Pacific Surfaces", email: "production@pacific-surfaces.com" };
  const { text, html } = reportBody("2026-08-21", sender);
  for (const part of [
    "Dear Team,",
    "I am writing to share the latest Pacific-ERP daily report for August 21, 2026.",
    "Please let me know if you have any questions.",
    "Best regards,",
    "Abdullah Ashraf",
  ]) {
    assert.ok(text.includes(part), `plain text must contain: ${part}`);
  }
  assert.ok(html.includes("August 21, 2026"));
  assert.ok(html.includes("Senior Product Manager"));
});

test("a sender name with markup cannot break the HTML body", () => {
  // The name and title come from environment variables, which is not a hostile
  // source - but they are interpolated into HTML, and escaping them costs
  // nothing next to finding out the hard way.
  const { html } = reportBody("2026-08-21", {
    name: "<script>alert(1)</script>", title: "a & b", email: "x@y.com",
  });
  assert.ok(!html.includes("<script>"), "the tag must not survive into the body");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("a &amp; b"));
});

test("?to= can only name somebody who is already a recipient", () => {
  // The rule the route enforces, pinned here because the helper it uses is the
  // testable half. CRON_SECRET is shared with the Telegram and sales crons and
  // is meant to be pasted into cron-job.org — holding it used to buy a message
  // into the company's own chat. An unchecked ?to= would have turned it into a
  // way to mail the full production PDF to any address on earth, from the
  // company's own mailbox, logged only as "to=1".
  const allowed = reportRecipients("ramana@pacific-surfaces.com, varun@pacific-surfaces.com");
  const permitted = (t: string) => allowed.some((a) => a.toLowerCase() === t.toLowerCase());

  assert.equal(permitted("varun@pacific-surfaces.com"), true);
  // Case is not a way around it.
  assert.equal(permitted("Varun@Pacific-Surfaces.com"), true);
  assert.equal(permitted("attacker@example.com"), false);
  // Nor is a lookalike that merely contains a permitted address.
  assert.equal(permitted("varun@pacific-surfaces.com.evil.com"), false);
  assert.equal(permitted("x+varun@pacific-surfaces.com"), false);
});

test("with no list configured, no override is permitted either", () => {
  // Fail closed: an unset DAILY_REPORT_EMAILS must not become "anyone".
  const allowed = reportRecipients(undefined);
  assert.deepEqual(allowed, []);
  assert.equal(allowed.some((a) => a === "anyone@example.com"), false);
});

// The recipient list is typed into a hosting dashboard by a person. The split
// used to be commas and semicolons only, so three addresses on three LINES —
// the obvious thing to do in a multi-line box — came back as one entry that
// contained "@", passed the filter, and went to the mail server as a single
// malformed recipient. Nobody would have received the report and the log would
// have said one recipient.

test("ADDRESSES ON SEPARATE LINES ARE THREE ADDRESSES, NOT ONE BLOB", () => {
  assert.deepEqual(
    reportRecipients("ramana@pacific-surfaces.com\nvarun@pacific-surfaces.com\ngibin@thepacific.group"),
    ["ramana@pacific-surfaces.com", "varun@pacific-surfaces.com", "gibin@thepacific.group"],
  );
});

test("spaces, tabs, trailing newlines and mixed separators all work", () => {
  assert.deepEqual(reportRecipients("a@x.com b@x.com"), ["a@x.com", "b@x.com"]);
  assert.deepEqual(reportRecipients("a@x.com,\n  b@x.com ;\tc@x.com\r\n"), ["a@x.com", "b@x.com", "c@x.com"]);
  assert.deepEqual(reportRecipients("\n\n a@x.com \n\n"), ["a@x.com"]);
});

test("something that is not an address is dropped rather than posted to the mail server", () => {
  // Each of these used to pass the old "contains @" filter.
  assert.deepEqual(reportRecipients("a@x.com, @x.com, b@, c@x, <d@x.com>, e@x.com"),
    ["a@x.com", "e@x.com"]);
});

test("a real-world list is unchanged by the stricter shape check", () => {
  assert.deepEqual(
    reportRecipients("ramana@pacific-surfaces.com, varun@pacific-surfaces.com, gibin@thepacific.group, a.b-c_d@sub.example.co.in"),
    ["ramana@pacific-surfaces.com", "varun@pacific-surfaces.com", "gibin@thepacific.group", "a.b-c_d@sub.example.co.in"],
  );
});
