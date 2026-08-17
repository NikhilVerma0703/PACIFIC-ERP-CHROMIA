import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretResponse } from "../src/lib/readJson.ts";

// The case that sent me here: a costing screen showing
// "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
// because it parsed the body before checking the status. The real error was a
// crashed or timed-out route, and the message said nothing about it.

test("an empty body reports the status instead of a parser error", () => {
  const r = interpretResponse(500, false, "");
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.data, null);
  assert.match(r.error!, /answered with nothing/);
  assert.match(r.error!, /HTTP 500/);
  // The whole point: the reader learns it was the server, not their browser.
  assert.match(r.error!, /on the server/);
  assert.doesNotMatch(r.error!, /JSON/i);
});

test("a timeout says it timed out", () => {
  // 504 and 500 are different problems with different fixes — retry versus
  // report — and a status code alone does not tell most people which.
  for (const s of [504, 408]) {
    assert.match(interpretResponse(s, false, "").error!, /took too long/);
  }
  assert.match(interpretResponse(503, false, "").error!, /not answering/);
});

test("an empty body with a 200 is still a failure", () => {
  // The subtle one. `ok` is true, so the old code went straight to r.json()
  // and threw. There is nothing to show, so it is an error however green the
  // status looks.
  const r = interpretResponse(200, true, "");
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.ok(r.error);
});

test("an HTML body is named as a page, not as a parse failure", () => {
  // A JSON endpoint answering with HTML is nearly always a sign-in redirect or
  // a platform error page. "Unexpected token '<'" tells nobody that.
  const r = interpretResponse(200, true, "<!DOCTYPE html><html><body>Sign in</body></html>");
  assert.equal(r.ok, false);
  assert.match(r.error!, /web page instead of data/);
  assert.match(r.error!, /sign in again/i);
});

test("a route's own message beats the status code", () => {
  const r = interpretResponse(400, false, JSON.stringify({ error: "Bad batch key." }));
  assert.equal(r.error, "Bad batch key.");
  assert.equal(r.status, 400);
  // The parsed body still comes through, so a caller can read the rest of it.
  assert.deepEqual(r.data, { error: "Bad batch key." });
});

test("a failure with no message of its own falls back to the status", () => {
  const r = interpretResponse(403, false, JSON.stringify({ detail: "nope" }));
  assert.match(r.error!, /HTTP 403/);
  assert.match(r.error!, /signed out/);
  // A blank `error` field is not a message.
  assert.match(interpretResponse(500, false, JSON.stringify({ error: "  " })).error!, /HTTP 500/);
});

test("malformed JSON is reported as unreadable, with the status", () => {
  const r = interpretResponse(200, true, '{"batches": [');
  assert.equal(r.ok, false);
  assert.match(r.error!, /could not be read/);
  assert.match(r.error!, /HTTP 200/);
});

test("a good response comes through untouched", () => {
  const r = interpretResponse<{ batches: number[] }>(200, true, '{"batches":[1,2,3]}');
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.deepEqual(r.data, { batches: [1, 2, 3] });
});

test("a falsy but valid JSON body is not mistaken for an empty one", () => {
  // `0`, `false` and `null` are real answers. Treating them as "nothing" would
  // turn a legitimate response into an error.
  assert.deepEqual(interpretResponse(200, true, "0").data, 0);
  assert.equal(interpretResponse(200, true, "0").ok, true);
  assert.equal(interpretResponse(200, true, "false").ok, true);
  assert.equal(interpretResponse(200, true, "null").ok, true);
  assert.equal(interpretResponse(200, true, "[]").ok, true);
});

test("whitespace is not a body", () => {
  assert.equal(interpretResponse(200, true, "   \n  ").ok, false);
});
