// THE CLIENT'S PURE HALF — config reading and the error type.
//
// THIS FILE EXISTS BECAUSE THE MODULE COULD NOT BE LOADED AT ALL. client.ts
// declared SfError with constructor parameter properties (`readonly status:
// number` in the signature), which is the one piece of TypeScript that node's
// --experimental-strip-types cannot erase — and that flag is how `npm test`
// runs. So every test importing client.ts died on import, which in practice
// meant no test imported it and the file had zero coverage. Nothing failed;
// the ceiling was silent. The same went for the extensionless "./limits"
// specifier, which node's ESM resolver will not guess at.
//
// The first test below therefore guards the import itself. If either mistake
// comes back, this file stops loading and the suite says so.
//
// Pure: nothing here opens a socket. getToken/soql/compositePatch are the I/O
// half and are not exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readConfig, missingConfig, SfError, SF_API_VERSION, forgetToken, limitsSeen,
} from "../src/lib/salesforce/client.ts";

const FULL = {
  SF_LOGIN_URL: "https://computing-saas-1373.my.salesforce.com",
  SF_CLIENT_ID: "3MVG9abc",
  SF_CLIENT_SECRET: "secret-value",
} as unknown as NodeJS.ProcessEnv;

test("the module loads under the test runner at all — the regression this file exists for", () => {
  assert.equal(typeof readConfig, "function");
  assert.equal(typeof missingConfig, "function");
  assert.equal(SF_API_VERSION, "v62.0");
});

test("SfError keeps name, status and body when built without parameter properties", () => {
  const e = new SfError("token refused", 401, "{\"error\":\"invalid_client\"}");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "SfError");
  assert.equal(e.message, "token refused");
  assert.equal(e.status, 401);
  assert.equal(e.body, "{\"error\":\"invalid_client\"}");
});

test("a body is optional, and stays undefined rather than becoming \"undefined\"", () => {
  const e = new SfError("no body", 500);
  assert.equal(e.status, 500);
  assert.equal(e.body, undefined);
});

test("all three present resolves, and the trailing slash is trimmed off the login URL", () => {
  const cfg = readConfig({ ...FULL, SF_LOGIN_URL: "https://x.my.salesforce.com///" } as NodeJS.ProcessEnv);
  assert.ok(cfg);
  assert.equal(cfg.loginUrl, "https://x.my.salesforce.com");
  assert.equal(cfg.clientId, "3MVG9abc");
});

test("ANY ONE MISSING MEANS null — a half-configured org is not configured", () => {
  for (const k of ["SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const) {
    const env = { ...FULL, [k]: "" } as unknown as NodeJS.ProcessEnv;
    assert.equal(readConfig(env), null, `${k} empty should refuse`);
  }
});

test("WHITESPACE IS NOT A VALUE — a pasted-over blank must not authenticate", () => {
  const env = { ...FULL, SF_CLIENT_SECRET: "   " } as unknown as NodeJS.ProcessEnv;
  assert.equal(readConfig(env), null);
  assert.deepEqual(missingConfig(env), ["SF_CLIENT_SECRET"]);
});

test("missingConfig names exactly what is absent, in a fixed order, and never a value", () => {
  assert.deepEqual(missingConfig({} as NodeJS.ProcessEnv),
    ["SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"]);
  assert.deepEqual(missingConfig(FULL), []);
  const partial = { SF_LOGIN_URL: "https://x.my.salesforce.com" } as unknown as NodeJS.ProcessEnv;
  const named = missingConfig(partial);
  assert.deepEqual(named, ["SF_CLIENT_ID", "SF_CLIENT_SECRET"]);
  // the refusal is operator-readable and leaks nothing
  assert.ok(!named.join(",").includes("secret-value"));
});

test("values are trimmed, so a newline pasted with a key does not travel into the POST", () => {
  const cfg = readConfig({
    SF_LOGIN_URL: "  https://x.my.salesforce.com  ",
    SF_CLIENT_ID: "\tabc\n",
    SF_CLIENT_SECRET: " def ",
  } as unknown as NodeJS.ProcessEnv);
  assert.ok(cfg);
  assert.equal(cfg.clientId, "abc");
  assert.equal(cfg.clientSecret, "def");
});

test("limitsSeen starts empty and forgetToken is safe to call before any token exists", () => {
  forgetToken();
  const seen = limitsSeen();
  assert.ok("used" in seen && "total" in seen);
});
