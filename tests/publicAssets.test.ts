import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { isPublicAsset } from "../src/lib/routeCaps.ts";

// What is served WITHOUT a session. It used to be "anything ending in
// .png/.jpg/.svg/.ico/.webmanifest/.txt/.xml" — an extension test, applied in
// three places, including the middleware MATCHER. A matcher-excluded request
// runs no middleware and no authorized() callback at all, so
// /api/robo/shifts/55.png, /tables/Press.png or /silo/5.png reached their
// handlers with no login whatsoever; only the handlers' own misses on "55.png"
// kept that inert. The rule is now an exact allowlist of the files in public/,
// and these tests hold the in-code check and the matcher string to ONE list.

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const MIDDLEWARE = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");

/** The matcher, compiled the way path-to-regexp compiles `/((?!X).*)`: the
 *  negative lookahead sits right after the leading slash. */
function matcherRegex(): RegExp {
  const lit = /matcher:\s*\[\s*("(?:[^"\\]|\\.)*")\s*\]/.exec(MIDDLEWARE);
  assert.ok(lit, "middleware.ts must declare a single string matcher");
  const pattern = JSON.parse(lit[1]) as string;
  const inner = /^\/\(\(\?!(.*)\)\.\*\)$/.exec(pattern);
  assert.ok(inner, `matcher must keep the /((?!...).*) shape, got ${pattern}`);
  return new RegExp(`^/(?!${inner[1]}).*$`);
}

test("every file that actually sits in public/ is served without a session, by both gates", () => {
  const files = readdirSync(PUBLIC_DIR).filter((f) => !f.startsWith("."));
  assert.ok(files.length > 0, "public/ should not be empty");
  const runsMiddleware = matcherRegex();
  for (const f of files) {
    const p = `/${f}`;
    assert.equal(isPublicAsset(p), true, `${p} is in public/ and must be public in code`);
    assert.equal(runsMiddleware.test(p), false, `${p} is in public/ and must be excluded by the matcher`);
  }
});

test("Next's own build output and the favicon browsers ask for unprompted stay public", () => {
  const runsMiddleware = matcherRegex();
  for (const p of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico"]) {
    assert.equal(isPublicAsset(p), true, `${p} should be public`);
    assert.equal(runsMiddleware.test(p), false, `${p} should be excluded by the matcher`);
  }
});

test("a static-looking suffix on an application path no longer skips either gate", () => {
  const runsMiddleware = matcherRegex();
  for (const p of [
    "/api/robo/shifts/55.png", "/api/robo/production.png", "/tables/Press.png", "/silo/5.png",
    "/sales/orders/abc.jpg", "/office/costing.svg", "/api/photo.ico", "/api/mis/export.xml",
    "/robots.txt", "/sitemap.xml", "/x.png", "/icon-192.png/anything", "/logo.png",
    "/icon.png", "/manifest.webmanifest/x",
  ]) {
    assert.equal(isPublicAsset(p), false, `${p} must need a session in code`);
    assert.equal(runsMiddleware.test(p), true, `${p} must run the middleware`);
  }
});

test("the two lists agree on every path either of them mentions", () => {
  // The matcher is a string literal Next reads at build time; it cannot call
  // isPublicAsset. So the agreement is checked here instead of relied on.
  const runsMiddleware = matcherRegex();
  const sample = [
    ...readdirSync(PUBLIC_DIR).map((f) => `/${f}`),
    "/favicon.ico", "/_next/static/a", "/_next/image", "/", "/login", "/api/auth/session",
    "/api/robo/shifts/55.png", "/tables/Press.png", "/icon-192.png/x", "/logo-white.png/x",
    "/icon-.png", "/logo-.png", "/icon-512-maskable.png", "/apple-touch-icon-120x120.png",
  ];
  for (const p of sample) {
    assert.equal(isPublicAsset(p), !runsMiddleware.test(p), `code and matcher disagree on ${p}`);
  }
});

test("the middleware no longer carries an extension-based public rule", () => {
  // The shape that leaked: a bare `\.(png|jpg|...)$` test, anywhere in the file.
  assert.doesNotMatch(MIDDLEWARE, /\\\.\(png\|jpg/, "middleware.ts must not test static-ness by extension");
  assert.match(MIDDLEWARE, /isPublicAsset\(/, "middleware.ts must use the shared allowlist");
});

test("auth.config.ts no longer carries an extension-based public rule either", () => {
  // The THIRD copy of the old rule lived here, in the gate that runs FIRST —
  // and a Response returned from authorized() replaces middleware wholesale,
  // so a stale rule in this file is one refactor away from being load-bearing.
  // The review that pinned middleware.ts alone let this copy survive a commit
  // whose message said all three were gone.
  const AUTH_CONFIG = readFileSync(new URL("../src/auth.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(AUTH_CONFIG, /\\\.\(png\|jpg/, "auth.config.ts must not test static-ness by extension");
  assert.match(AUTH_CONFIG, /isPublicAsset\(/, "auth.config.ts must use the shared allowlist");
});
