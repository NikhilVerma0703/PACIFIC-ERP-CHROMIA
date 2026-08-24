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

/**
 * Where a refused page now sends people.
 *
 * Both gates used to bounce a capped role to its own home page, silently. That
 * is what made the fab loop possible in the first place: the destination was
 * itself a page the OTHER gate could refuse, so two refusals could point at
 * each other. /no-access is public in BOTH files, so it is terminal by
 * construction — the loop cannot be rebuilt out of it, whatever caps are added
 * later. The test below pins exactly that.
 */
const REFUSED = "/no-access";

test("the refusal page is terminal in this gate, for every capped role", () => {
  // The property that makes REFUSED safe as a universal destination. If any
  // cap ever swallowed /no-access, a refusal would redirect to a page that
  // redirects — which is the fab loop with a new address.
  for (const role of ["OPERATOR", "STORE", "MAINTENANCE", "ROBO", "SALES", "COMMERCIAL"]) {
    for (const branch of ["SHOP_FLOOR", "OFFICE", "FABRICATION", "CHROMIA", undefined]) {
      assert.equal(redirectFor({ role, branch }, REFUSED), null,
        `authorized() redirected ${role}/${branch} away from the refusal page itself`);
    }
  }
  // And signed out, it is still just a page: middleware sends them to /login.
  assert.equal(redirectFor(null, REFUSED), null);
});

const FAB_ROLES = ["OPERATOR", "INCHARGE", "LINE_MANAGER"] as const;

// Every page middleware.ts lets a fab user reach, plus every page it redirects
// them TO. A redirect target that authorized() rejects is a cycle by
// construction, so both sets have to pass.
const FAB_REACHABLE = [
  "/fab/cutting", "/fab/polishing", "/fab/sink-cutting",
  "/fab/fabrication", "/fab/packaging", "/fab/session",
  "/fab/supervisor", "/fab/supervisor/slabs", "/fab/projects", "/fab/manager", "/fab/ceo", "/",
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
  const middlewareHomes = ["/fab/cutting", "/fab/manager", "/fab/supervisor/slabs"];
  for (const role of FAB_ROLES) {
    for (const home of middlewareHomes) {
      assert.equal(redirectFor({ role, branch: "FABRICATION" }, home), null,
        `middleware.ts redirects a fab ${role} to ${home}, but authorized() refuses it`);
    }
  }
});

// ---- CHROMIA: the same two-gate topology, one branch value later. ----
//
// middleware.ts caps role CHROMIA (and, transitionally, branch CHROMIA) to
// /chromia and redirects them there from anywhere else. authorized() must
// therefore never redirect either shape of Chromia login, or the two gates
// close the same cycle the FABRICATION escape above exists to prevent:
//   authorized(): /chromia -> /entry   (OPERATOR cap, knows nothing of branches)
//   middleware.ts: /entry  -> /chromia (Chromia cap)
// The branch escape lives at src/auth.config.ts (`if (branch === "CHROMIA")`);
// the role works only because CHROMIA is absent from the caps below it — the
// same fragility the fab comment warns about, pinned here for both.

test("CHROMIA branch: authorized() defers to middleware for every capped role", () => {
  // Logins created by the retired department-style integration keep their old
  // role (any role) with branch CHROMIA until 0046 migrates them. The capped
  // roles are the dangerous ones — without the escape they loop on sign-in.
  for (const role of ["OPERATOR", "STORE"]) {
    for (const path of ["/chromia", "/chromia/dashboard", "/chromia/stockyard", "/api/chromia/slabs"]) {
      assert.equal(
        redirectFor({ role, branch: "CHROMIA" }, path), null,
        `authorized() redirected a CHROMIA-branch ${role} away from ${path}; ` +
        `middleware.ts owns Chromia routing — a redirect here reopens the fab loop one branch later`
      );
    }
    // middleware.ts sends a CHROMIA login found anywhere else to /chromia, so
    // authorized() must let them pass through the page it bounces them FROM.
    assert.equal(redirectFor({ role, branch: "CHROMIA" }, "/entry"), null,
      `authorized() must not fight middleware.ts over a CHROMIA-branch ${role} on /entry`);
  }
});

test("role CHROMIA is not swallowed by the Shop Floor role caps", () => {
  // The dedicated role a 0046-migrated user carries. It must reach /chromia
  // (its only home) whatever branch value the login still carries.
  for (const branch of ["SHOP_FLOOR", undefined]) {
    for (const path of ["/chromia", "/chromia/slabs/abc", "/api/chromia/reports"]) {
      assert.equal(redirectFor({ role: "CHROMIA", branch }, path), null,
        `authorized() refused role CHROMIA (branch ${branch}) at ${path}, its middleware home`);
    }
  }
});

test("the CHROMIA escape does not widen access for other branches", () => {
  // A SHOP_FLOOR operator is still capped — the escape keys on branch CHROMIA
  // exactly, and middleware (not this callback) is what turns non-Chromia
  // logins away from /chromia pages.
  //
  // The DESTINATION changed: a refused page now goes to /no-access, which says
  // what happened, instead of silently landing on the role home. What is being
  // pinned here is that they are still refused.
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/chromia"), REFUSED);
  assert.equal(redirectFor({ role: "STORE", branch: "SHOP_FLOOR" }, "/chromia"), REFUSED);
});

// The fab escape must not have widened the Shop Floor caps it sits in front of.
test("SHOP_FLOOR OPERATOR is still capped", () => {
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/fab/cutting"), REFUSED);
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/office"), REFUSED);
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/entry"), null);
  assert.equal(redirectFor({ role: "OPERATOR", branch: "SHOP_FLOOR" }, "/api/fab/slabs"), null);
});

test("STORE is still capped", () => {
  assert.equal(redirectFor({ role: "STORE", branch: "SHOP_FLOOR" }, "/office"), REFUSED);
  assert.equal(redirectFor({ role: "STORE", branch: "SHOP_FLOOR" }, "/store/rm"), null);
});

test("a capped role with no branch is unaffected", () => {
  // branch is nullable on User, so the fab check must not swallow undefined.
  assert.equal(redirectFor({ role: "OPERATOR" }, "/office"), REFUSED);
});

test("login and static assets stay public, signed out or in", () => {
  assert.equal(redirectFor(null, "/login"), null);
  assert.equal(redirectFor(null, "/api/auth/session"), null);
  // A REAL file in public/, per the isPublicAsset allowlist. This line used to
  // say "/logo.png" — no such file — and passed only because auth.config kept
  // the retired any-.png-is-public rule; tests/publicAssets.test.ts pins
  // "/logo.png" as needing a session, and now both gates agree.
  assert.equal(redirectFor(null, "/logo-white.png"), null);
  assert.equal(redirectFor(null, "/logo.png"), "(denied)");
  // Signed out anywhere else is a plain false, NOT a Response — middleware.ts
  // still runs and issues the login redirect itself so it can attach a
  // callbackUrl. Returning a redirect here would throw that away.
  assert.equal(redirectFor(null, "/fab/cutting"), "(denied)");
});
