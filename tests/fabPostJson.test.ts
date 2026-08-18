import { test } from "node:test";
import assert from "node:assert/strict";
import { isJsonBody } from "../src/lib/fab/postJson.ts";

// middleware.ts:36-40 redirects EVERY unauthenticated request to /login,
// including /api/*. fetch follows redirects by default, so a fab screen with an
// expired session (maxAge 8h — an overnight tab) gets 200 + the login page's
// HTML back from a POST that never reached the route. postJson used to see
// res.ok === true and a null body, and the Planning Board painted
// "released — 0 piece(s) created" over work that never happened.

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

test("an HTML body on a 200 is not a JSON reply", () => {
  // This is the expired-session redirect, exactly as the browser sees it.
  assert.equal(isJsonBody(res(200, { "content-type": "text/html; charset=utf-8" })), false);
});

test("a JSON reply is recognised with or without charset", () => {
  assert.equal(isJsonBody(res(200, { "content-type": "application/json" })), true);
  assert.equal(isJsonBody(res(200, { "content-type": "application/json; charset=utf-8" })), true);
});

test("an empty 204 stays valid — it has no body to be wrong about", () => {
  // The delete/clear paths reply 204. Treating "not JSON" as a failure here
  // would break every one of them.
  assert.equal(isJsonBody(res(204)), true);
  assert.equal(isJsonBody(res(205)), true);
});

test("no content-type at all is left to the JSON parse, not rejected here", () => {
  assert.equal(isJsonBody(res(200)), true);
});

test("plain text is not JSON", () => {
  assert.equal(isJsonBody(res(200, { "content-type": "text/plain" })), false);
});
