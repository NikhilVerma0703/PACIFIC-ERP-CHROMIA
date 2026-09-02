import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for the three money screens where a mis-tap or a dropped
// request costs real money: the sales order page, the payments table and the
// Finance bill queue. They read the source rather than call it, in the style of
// photoSlots.test.ts, because these components are client components whose
// handlers cannot be imported without a DOM — and what is being protected is
// not a return value but a RULE that was broken once already on each screen:
//
//   * a mutating handler that never reads r.ok reports a refusal as a success;
//   * a handler that clears its busy flag after the await, not in a finally,
//     freezes its buttons for good on a dropped connection;
//   * an irreversible action (reject a credit note, waive an installment, mail
//     a customer, mark an export imported in Tally) with no confirm is one tap
//     away from being done by accident, with no undo anywhere in the UI.
//
// Each assertion below names the incident it stands for. If a rewrite makes one
// of these strings wrong, re-read the rule before re-writing the test.

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const src = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

const orderPage = src("app", "sales", "orders", "[id]", "page.tsx");
const paymentsPage = src("app", "sales", "payments", "page.tsx");
const financeBills = src("components", "office", "FinanceBills.tsx");

/** The body of each `async function name(` declared at component scope, keyed
 *  by name. Each chunk runs to the start of the next such declaration, which is
 *  enough to see how one handler ends. */
function handlers(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of source.split("\n  async function ").slice(1)) {
    out.set(chunk.slice(0, chunk.indexOf("(")), chunk);
  }
  return out;
}

test("every mutating handler on the sales order page reads the response and frees its buttons", () => {
  const fns = handlers(orderPage);
  for (const name of [
    "loadOrder", "extendDivision", "overrideDivision", "sendReminder",
    "sendEtaReminder", "createCN", "updateCN",
  ]) {
    const body = fns.get(name);
    assert.ok(body, `${name} should still be an async function on this page`);
    assert.match(
      body, /readJson</,
      `${name} must read the response through readJson: a bare r.json() throws on the empty body a crashed or timed-out route returns, and the error the user sees is about a parser`,
    );
    assert.match(
      body, /\} finally \{/,
      `${name} must clear its busy/loading flag in a finally — without it a dropped connection throws past the reset and the page stays stuck on Loading… or greyed out until a reload`,
    );
  }
});

test("the destructive credit-note transitions are confirmed and cannot be double-fired", () => {
  const updateCN = handlers(orderPage).get("updateCN") ?? "";
  assert.match(
    updateCN, /status === "REJECTED" && !confirm\(/,
    "Reject is one-way — there is no un-reject on this screen — so it must be confirmed before the PATCH",
  );
  assert.match(
    updateCN, /setCNStatusBusy\(cnId\)/,
    "the row being patched must be marked busy so a second tap cannot fire the same transition twice",
  );
  assert.match(
    updateCN, /setCNMsg\(res\.error/,
    "a refused transition must say so: it used to reload the list unchanged, which looks exactly like a success that changed nothing",
  );
  assert.match(
    orderPage, /cnMsg && !showCNForm/,
    "cnMsg must render outside the new-credit-note form as well, or an apply/reject failure is written where nobody can see it",
  );
});

test("a waive keeps the note the manager typed when the request fails", () => {
  const override = handlers(orderPage).get("overrideDivision") ?? "";
  assert.match(
    override, /prompt\("Enter a note for this override\/waive:", overrideDrafts\[divisionId\]/,
    "the retry must reopen with the note already typed — a blank box is how the audit trail ends up with a shorter, different reason",
  );
  assert.match(
    override, /!confirm\(/,
    "waiving writes off money that is owed and has no undo here, so it is confirmed with the amount named",
  );
});

test("Send Reminder asks before it mails a customer, and only freezes its own row", () => {
  const remind = handlers(paymentsPage).get("sendReminder") ?? "";
  assert.match(
    remind, /if \(!confirm\(/,
    "this mails the customer immediately and cannot be recalled — one tap in a dense table is not consent",
  );
  assert.match(
    remind, /\} finally \{\s*\n\s*setBusy\(null\);/,
    "a failed reminder must release the busy flag, or the table stays disabled until a reload",
  );
  const button = paymentsPage.slice(
    paymentsPage.indexOf("onClick={() => sendReminder(d.id)}"),
    paymentsPage.indexOf("onClick={() => sendReminder(d.id)}") + 300,
  );
  assert.match(
    button, /disabled=\{rowBusy\}/,
    "busy must be scoped to the row: `!!busy` greyed out Mark Paid on every other row while one reminder was in flight",
  );
});

test("marking a Tally export imported is confirmed — the void route refuses it afterwards", () => {
  const start = financeBills.indexOf("const markImported = async");
  assert.ok(start > 0, "markImported should still be here");
  const body = financeBills.slice(start, financeBills.indexOf("const voidExport", start));
  assert.match(
    body, /window\.confirm\(/,
    "it sits between 'void' and 'XML' in a three-link row and there is no undo: an imported export can no longer be voided",
  );
  assert.match(body, /row\.ref/, "the prompt must name the ref so the wrong row is caught by reading it");
  assert.match(body, /fmtAmt\(row\.total\)/, "…and the money, for the same reason");
});

test("one failed batch poll no longer strands a stack of bills", () => {
  assert.ok(
    !financeBills.includes("} catch { window.clearInterval(t); }"),
    "the poll must not die on its first error — GET /batches/{id} IS the worker, so a stopped poll stops the reading itself",
  );
  assert.match(
    financeBills, /fails >= POLL_MAX_TRIES/,
    "failures must be counted and retried with backoff before giving up",
  );
  assert.match(
    financeBills, /Reading stalled/,
    "when it does give up it must say so and offer Retry, rather than leaving a progress bar that will never move",
  );
  assert.match(
    financeBills, /bills\?status=queued,processing/,
    "queued/processing bills appear in no other list on this page — without this they are invisible, not merely late",
  );
  assert.match(
    financeBills, /Resume reading/,
    "and there must be a way to pick them back up without re-uploading the stack",
  );
});
