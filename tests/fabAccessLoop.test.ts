import { test } from "node:test";
import assert from "node:assert/strict";
import { authConfig } from "../src/auth.config.ts";

// Fabrication routing is decided in TWO files that never see each other:
//
//   src/auth.config.ts  authorized()  — role caps, runs FIRST
//   src/middleware.ts                 — branch allowlist, runs SECOND
//
// and "second" is conditional. Auth.js only calls the user middleware when
// authorized() returns a boolean; if it returns a Response, next-auth takes
// `response = authorized` and never evaluates the middleware branch
// (node_modules/next-auth/lib/index.js). So a redirect from authorized() does
// not merely precede middleware.ts — it REPLACES it.
//
// That is how the fab operator login broke. authorized() capped role OPERATOR
// to /entry knowing nothing about branches; middleware.ts bounces a FABRICATION
// operator off /entry back to /fab/cutting. Neither page was reachable, the two
// redirects closed a cycle, and signing in ended at ERR_TOO_MANY_REDIRECTS.
// Commit 7301da7 removed the `if (fabRole) return true` escape that had been
// preventing it, and nothing replaced it until this test's subject did.
//
// The invariant below is what keeps the cycle impossible: authorized() must
// never redirect a FABRICATION user, because middleware.ts owns their routing
// completely. These tests need no database and no server — authorized() is
// edge-safe and imports nothing at runtime.

type SessionUser = { role?: string; branch?: string };

/**
 * Calls the real callback and reports its decision:
 *   null        -> allowed through (middleware.ts gets to run)
 *   "/path"     -> authorized() redirected here, replacing middleware.ts
 *   "(denied)"  -> returned false; middleware.ts still runs and sends to /login
 */
function redirectFor(user: SessionUser | null, path: string): string | null {
  const nextUrl = new URL(path, "https://erp.pacific-surfaces.com");
  const result = authConfig.callbacks.authorized({
    auth: user ? { user } : null,
    request: { nextUrl },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (result instanceof Response) {
    const location = result.headers.get("Location");
    return location ? new URL(location).pathname : "(response)";
  }
  return result === false ? "(denied)" : null;
}

const FAB_ROLES = ["OPERATOR", "INCHARGE", "LINE_MANAGER"] as const;

// Every page middleware.ts lets a fab user reach, plus every page it redirects
// them TO. A redirect target that authorized() rejects is a cycle by
// construction, so both sets have to pass.
const FAB_REACHABLE = [
  "/fab/cutting", "/fab/polishing", "/fab/sink-cutting",
  "/fab/fabrication", "/fab/packaging", "/fab/session",
  "/fab/supervisor", "/fab/projects", "/fab/ceo", "/",
];

// Pages a fab user is NOT entitled to. middleware.ts must be the thing that
// turns them away — if authorized() does it first, it does so with the wrong
// destination, which is the whole bug.
const FAB_FORBIDDEN = ["/entry", "/tables", "/live", "/store", "/inventory", "/sales"];

for (const role of FAB_ROLES) {
  test(`FABRICATION ${role}: authorized() defers to middleware on fab pages`, () => {
    for (const path of FAB_REACHABLE) {
      assert.equal(
        redirectFor({ role, branch: "FABRICATION" }, path), null,
        `authorized() redirected a fab ${role} away from ${path}; middleware.ts must decide this`
      );
    }
  });

  test(`FABRICATION ${role}: authorized() does not redirect off non-fab pages either`, () => {
    for (const path of FAB_FORBIDDEN) {
      const to = redirectFor({ role, branch: "FABRICATION" }, path);
      assert.equal(
        to, null,
        `authorized() sent a fab ${role} from ${path} to ${to}. middleware.ts sends fab users ` +
        `to /fab/cutting, which this callback must then allow — a redirect here reopens the loop.`
      );
    }
  });
}

test("no fab role can be bounced between the two gates", () => {
  // Direct statement of loop-freedom: whatever middleware.ts picks as a fab
  // user's home, authorized() has to let them land on it.
  const middlewareHomes = ["/fab/cutting", "/fab/projects", "/fab/supervisor"];
  for (const role of FAB_ROLES) {
    for (const home of middlewareHomes) {
      assert.equal(redirectFor({ role, branch: "FABRICATION" }, home), null,
        `middleware.ts redirects a fab ${role} to ${home}, but authorized() refuses it`);
    }
  }
});

// The fab escape must not have widened the Shop Floor caps it sits in front of.
test("SHOP_FLOOR OPERATOR is still capped to /entry", () => {
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/fab/cutting"), "/entry");
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/office"), "/entry");
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/entry"), null);
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/api/fab/slabs"), null);
});

test("STORE is still capped to /live", () => {
  assert.equal(redirectFor({ role: "STORE", branch: "SHOP_FLOOR" }, "/office"), "/live");
  assert.equal(redirectFor({ role: "STORE", branch: "SHOP_FLOOR" }, "/store/rm"), null);
});

test("a capped role with no branch is unaffected", () => {
  // branch is nullable on User, so the fab check must not swallow undefined.
  assert.equal(redirectFor({ role: "OPERATOR" }, "/office"), "/entry");
});

test("login and static assets stay public, signed out or in", () => {
  assert.equal(redirectFor(null, "/login"), null);
  assert.equal(redirectFor(null, "/api/auth/session"), null);
  assert.equal(redirectFor(null, "/logo.png"), null);
  // Signed out anywhere else is a plain false, NOT a Response — middleware.ts
  // still runs and issues the login redirect itself so it can attach a
  // callbackUrl. Returning a redirect here would throw that away.
  assert.equal(redirectFor(null, "/fab/cutting"), "(denied)");
});
