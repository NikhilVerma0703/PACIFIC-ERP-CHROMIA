import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Alias-free relative imports with explicit extensions: `node --test` resolves
// neither the `@/` alias nor next-auth. Both modules below are import-free for
// exactly that reason, and because middleware.ts and auth.config.ts are edge
// code — see the heads of lib/routeCaps.ts and lib/inventory/accessRules.ts.
import { fgViewMayVisit } from "../src/lib/routeCaps.ts";
import { hasFgView } from "../src/lib/inventory/accessRules.ts";
// authConfig itself IS importable here — it is edge-safe and imports nothing at
// runtime but the two pure modules above — so the role caps and the token
// callbacks are exercised for real rather than paraphrased. The same trick
// tests/fabAccessLoop.test.ts plays on the same object.
import { authConfig } from "../src/auth.config.ts";

// THE REQUEST PATH OF THE FINISHED-GOODS VIEW GRANT.
//
// The owner, 2026-09-14: "Please add finished good's visibility for
// chromia@thepacific.group, gibin@thepacific.group (full visibility but no edit
// options)". The rule that reads the grant lives in
// lib/inventory/accessRules.ts and is tested by tests/inventoryViewerAccess.test.ts;
// scripts/0083-fg-view-grant.sql is the argument for making it a per-login
// boolean. This file covers the half that happens BEFORE any route gate runs,
// and which nothing else would catch:
//
//   THE SESSION HAS TO CARRY THE FLAG. Both edge gates are Prisma-free, so a
//   grant that never reaches the token is a grant no gate can see. Every rule
//   downstream would then answer "no", correctly, forever, and the symptom
//   would be a feature that simply does nothing.
//
//   AND THE DOOR HAS TO AGREE WITH THE GATES. chromia@ sits on the CHROMIA
//   branch and gibin@ on FABRICATION; three separate rules in middleware.ts
//   refuse them finished goods, and auth.config.ts's authorized() runs FIRST
//   and can replace middleware wholesale. An API opened while its page stays
//   refused is the failure lib/commercial/access-rules.ts records; here it
//   would be invisible, because the person just sees the module missing.
//
// middleware.ts cannot be imported — it calls NextAuth() at module scope, which
// needs the edge runtime — so its half is read out of the source, the way
// tests/fabCutterAccess.test.ts reads the fab-OPERATOR allowlist and
// tests/publicAssets.test.ts reads the matcher. Reading the real file is the
// point: a copy of the rule in this test would be the second copy that
// lib/routeCaps.ts exists to abolish.

const src = (rel: string) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const MIDDLEWARE = src("src/middleware.ts");
const AUTH = src("src/auth.ts");
const AUTH_CONFIG = src("src/auth.config.ts");

// The two people the grant was made for, as their sessions carry them.
const chromiaViewer = { role: "LINE_MANAGER", branch: "CHROMIA", fgView: true };
const gibinViewer = { role: "LINE_MANAGER", branch: "FABRICATION", fgView: true };
// The same two logins as they were the day before the grant — every assertion
// about what the grant ADDS is worth nothing without one of these beside it.
const chromiaBefore = { role: "LINE_MANAGER", branch: "CHROMIA" };

// ---------------------------------------------------------------------------
// WHERE THE GRANT REACHES — two prefixes and one endpoint, and the whole of it
// ---------------------------------------------------------------------------

test("the grant opens finished goods: the page, the slab detail and the module's own API", () => {
  for (const p of [
    "/inventory",
    "/inventory/",
    "/inventory/slab/144320",
    "/api/inventory",
    "/api/inventory/summary",
    "/api/inventory/slab/144320",
    "/api/inventory/filters",
  ]) {
    assert.equal(fgViewMayVisit(p), true, `${p} must be reachable by a viewer`);
  }
});

test("AND THE SLAB PHOTOS, which are the one part of the panel that is not under /api/inventory", () => {
  // The detail panel draws a Photos strip of <img src="/api/photo?id=...">, one
  // tile per row, and Lightbox opens the same URL. The rows come from
  // /api/inventory/slab, which is on inventoryReadGate and hands them to a
  // viewer — so a fence that stops at the two module prefixes does not hide the
  // strip, it draws it broken: 403 on every tile and a lightbox that opens on a
  // blank frame. chromia@ is refused at the edge by her branch cap, which is a
  // narrow allowlist with a terminal return; gibin@ reaches the route and is
  // refused there. Both halves have to be open for the pictures to appear, and
  // this is the edge half.
  assert.equal(fgViewMayVisit("/api/photo"), true);
  assert.equal(fgViewMayVisit("/api/photo?id=ckv1a2b3c4d5"), true, "the tiles always carry an id");
  // Exact, like maintenanceMayVisit's clause for the same path: there is no
  // /api/photo/<something> to reach, and a bare prefix would grant an
  // /api/photo-export added later without anybody deciding to.
  for (const p of ["/api/photos", "/api/photo-export", "/api/photo/raw"]) {
    assert.equal(fgViewMayVisit(p), false, `${p} must not inherit the grant from its spelling`);
  }
});

test("AND NOTHING ELSE — the owner granted one module, not a branch's worth of them", () => {
  for (const p of [
    "/", "/live", "/mis", "/tables", "/tables/FinishedSlab",
    "/chromia", "/api/chromia", "/fab", "/fab/cutting",
    "/office", "/office/commercial", "/office/costing", "/api/office/finance",
    "/slab-intake", "/scoreboard", "/sales", "/api/admin/users",
    // The production timeline — /slab, the page the finished-goods detail
    // panel draws a button to. Outside the fence, and unlike /api/photo it
    // stays outside: that endpoint belongs to the panel and its route can
    // still scope a viewer to FinishedSlab, while /slab is another module's
    // page that cannot narrow itself for a viewer at all — its `basic`
    // stripping, which is what keeps machine settings and RM composition off
    // the copy Commercial reads, is keyed on isCommercialRole. A LINE_MANAGER
    // viewer admitted here would see MORE of that page than the role the
    // module actually shares it with, out of a grant whose words were
    // "finished good's visibility".
    //
    // The consequence is answered where it shows rather than left to be
    // found: the button is drawn behind !readOnly in
    // components/inventory/InventoryDashboard.tsx, because a control that
    // redirects somebody off the module they were just granted is worse than
    // no control. tests/inventoryDashboardView.test.ts pins that end of it.
    "/slab",
    // /api/photo is NOT in this list any more — see the test above. It was,
    // and the note here argued that opening a shared endpoint at the fence was
    // a wider decision than the one the owner asked for. It is a wider
    // decision, and it is still the right one: the narrower reading refused a
    // granted login the far/near shots that every other inventory login sees on
    // the same slab, which is not "full visibility". The width it opens is
    // closed where it can actually be closed — inside the route, which alone
    // knows the model behind the id.
    // /api/mis/export is the other endpoint maintenanceMayVisit names beside
    // the photo one, and it is NOT part of this grant: the photo path is here
    // because the slab panel renders it, and that is the whole test for adding
    // one.
    "/api/mis/export", "/api/sampling", "/api/store",
  ]) {
    assert.equal(fgViewMayVisit(p), false, `${p} is not part of the finished-goods grant`);
  }
});

test("exact-or-subpath, so a name that merely starts the same way is a new decision", () => {
  // The near-miss samplingMayVisit and the Store Incharge's /office/batch-verify
  // clause are both anchored against. A bare prefix would open all four of these
  // the day somebody adds one.
  for (const p of ["/inventory-admin", "/inventoryx", "/api/inventory-export", "/api/inventoryreport"]) {
    assert.equal(fgViewMayVisit(p), false, `${p} must not inherit the grant from its spelling`);
  }
});

test("a query string cannot change the answer", () => {
  assert.equal(fgViewMayVisit("/inventory?status=IN_STOCK"), true);
  assert.equal(fgViewMayVisit("/api/inventory/summary?design=CARRARA"), true);
  assert.equal(fgViewMayVisit("/mis?from=2026-09-01"), false);
});

// ---------------------------------------------------------------------------
// THE TOKEN — carried, never derived, and absent is never a grant
// ---------------------------------------------------------------------------

/** The real jwt callback, on a fresh sign-in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mint = (user: unknown): any => authConfig.callbacks.jwt({ token: {} as any, user: user as any });
/** The real session callback, on whatever token is handed to it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionFrom = (token: unknown): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authConfig.callbacks.session({ session: { user: {} } as any, token: token as any });

test("THE FLAG RIDES IN THE JWT AND REACHES THE SESSION — without it no gate can see the grant", () => {
  const token = mint({ id: "u1", role: "LINE_MANAGER", branch: "CHROMIA", fgView: true });
  assert.equal(token.fgView, true, "the claim must be minted at sign-in");
  assert.equal(sessionFrom(token).user.fgView, true, "middleware builds req.auth from THIS session callback");
  // And the gates read it off that session user, from the same function the
  // route gates use. This is the join: session -> hasFgView -> every decision.
  assert.equal(hasFgView(sessionFrom(token).user), true);
});

test("A LOGIN WITHOUT THE GRANT CARRIES false, not undefined — and so does an old token", () => {
  const plain = mint({ id: "u2", role: "LINE_MANAGER", branch: "CHROMIA" });
  assert.equal(plain.fgView, false, "no column, no claim, no grant");
  assert.equal(sessionFrom(plain).user.fgView, false);
  // A token minted before this claim existed — every session that was live on
  // the day it shipped. It has no fgView at all, and must read as no grant
  // rather than as "unknown, allow": the same direction the column's DEFAULT
  // false and hasFgView's `=== true` both take.
  const old = { uid: "u3", role: "LINE_MANAGER", branch: "CHROMIA", sv: 1 };
  assert.equal(sessionFrom(old).user.fgView, false);
  assert.equal(hasFgView(sessionFrom(old).user), false);
});

test("truthy is not true — a 1 or a \"true\" out of some other store is not a grant", () => {
  for (const value of [1, "true", "yes", {}, [], "1"]) {
    const token = mint({ id: "u4", role: "LINE_MANAGER", branch: "CHROMIA", fgView: value });
    assert.equal(token.fgView, false, `${JSON.stringify(value)} must not mint a grant`);
    assert.equal(sessionFrom(token).user.fgView, false);
  }
});

test("the claim is added alongside the others, and takes nothing away", () => {
  const token = mint({ id: "u5", role: "ACCOUNTS", branch: "OFFICE", altRole: "STORE", altBranch: "SHOP_FLOOR", sv: 7 });
  assert.equal(token.uid, "u5");
  assert.equal(token.role, "ACCOUNTS");
  assert.equal(token.branch, "OFFICE");
  assert.equal(token.altRole, "STORE");
  assert.equal(token.altBranch, "SHOP_FLOOR");
  assert.equal(token.sv, 7, "sessionVersion still rides, and is still what revokes a session");
  const user = sessionFrom(token).user;
  assert.equal(user.role, "ACCOUNTS");
  assert.equal(user.altBranch, "SHOP_FLOOR");
  assert.equal(user.sv, 7);
});

test("EVERY READER OF THE FLAG TESTS `=== true`, in both files that mint the token", () => {
  // Stated as a property of the sources rather than of one value, because the
  // failure is a `?? false` or a bare truthiness test added later by somebody
  // tidying up — which would turn any non-empty string in the column into
  // finished-goods access.
  const ASSIGNS = /^\s*(?:token\.fgView|session\.user\.fgView|fgView)\s*[:=][^=]/;
  for (const [name, source] of [["src/auth.ts", AUTH], ["src/auth.config.ts", AUTH_CONFIG]] as const) {
    const lines = source.split("\n").filter((l) => ASSIGNS.test(l));
    assert.ok(lines.length >= 2, `${name} must both read the column and put it on the token`);
    for (const line of lines) {
      assert.match(line.trim(), /=== true/, `${name}: ${line.trim()}`);
    }
  }
  // BOTH jwt callbacks set it, on purpose: auth.ts's replaces auth.config.ts's
  // for the main auth() instance, while middleware.ts uses NextAuth(authConfig)
  // and therefore the one in auth.config.ts. A claim set in only one of them is
  // a claim that exists on the server and not at the edge, or the reverse.
  assert.match(AUTH, /token\.fgView/, "auth.ts's jwt callback must set the claim");
  assert.match(AUTH_CONFIG, /token\.fgView/, "auth.config.ts's jwt callback must set the claim");
  assert.match(AUTH_CONFIG, /session\.user\.fgView/, "the session callback middleware reads must copy it");
});

// ---------------------------------------------------------------------------
// THE GATE THAT RUNS FIRST — authorized()
// ---------------------------------------------------------------------------

/**
 * The real callback's decision, in the shape tests/fabAccessLoop.test.ts uses:
 *   null       -> allowed through, middleware.ts gets to decide
 *   "/path"    -> authorized() answered with a Response, REPLACING middleware
 *   "(denied)" -> returned false (signed out)
 */
function decide(user: unknown, path: string): string | null {
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

test("the two granted logins are still handed to middleware, exactly as before", () => {
  // Neither is a capped role, so the branch escapes above the caps already
  // covered them; this pins that the new line changed nothing for them. The fab
  // and Chromia escapes exist to stop the redirect loop tests/fabAccessLoop.test.ts
  // documents, and a viewer must not be the exception that reopens it.
  for (const who of [chromiaViewer, gibinViewer, chromiaBefore]) {
    for (const p of ["/inventory", "/api/inventory", "/", "/chromia", "/fab/cutting"]) {
      assert.equal(decide(who, p), null, `${who.branch} at ${p}: middleware owns this decision`);
    }
  }
});

test("A CAPPED LOGIN CARRYING THE FLAG IS ADMITTED TO FINISHED GOODS, AND TO NOTHING ELSE", () => {
  // No such login exists today — the grant was made to two line managers — and
  // that is precisely why it is pinned. The day somebody hands the flag to a
  // store incharge or an operator, this gate must not refuse the page while the
  // route gates answer its API: that disagreement is the failure recorded in
  // lib/commercial/access-rules.ts, and here it would be silent.
  const operatorViewer = { role: "OPERATOR", branch: "SHOP_FLOOR", fgView: true };
  const operatorPlain = { role: "OPERATOR", branch: "SHOP_FLOOR" };
  assert.equal(decide(operatorViewer, "/inventory"), null, "the viewer reaches the page");
  assert.equal(decide(operatorViewer, "/inventory/slab/144320"), null);
  assert.equal(decide(operatorPlain, "/inventory"), "/no-access", "and only the flag opens it");

  // The cap is otherwise untouched: an operator with the grant is still an
  // operator everywhere else.
  for (const p of ["/mis", "/office", "/chromia", "/sales", "/slab-intake"]) {
    assert.equal(decide(operatorViewer, p), "/no-access", `${p} is outside the grant`);
  }
  // ...and still lands where an operator lands.
  assert.equal(decide(operatorViewer, "/"), "/entry");
});

test("both edge gates ask the same two questions, out of the same two modules", () => {
  // One rule, two gates — the discipline lib/routeCaps.ts was created to
  // enforce. A gate that answered this question from its own copy of the rule
  // is how the Store Incharge lost three granted screens.
  for (const [name, source] of [["src/middleware.ts", MIDDLEWARE], ["src/auth.config.ts", AUTH_CONFIG]] as const) {
    assert.match(source, /fgViewMayVisit/, `${name} must ask lib/routeCaps where the grant reaches`);
    assert.match(source, /hasFgView/, `${name} must ask lib/inventory/accessRules who holds it`);
    assert.match(source, /from "\.\/lib\/inventory\/accessRules\.ts"/, `${name} must import the rule, not restate it`);
  }
});

// ---------------------------------------------------------------------------
// MIDDLEWARE — read out of the file, because it cannot be imported
// ---------------------------------------------------------------------------

/** Where a named rule sits in middleware.ts, asserted to exist as it is quoted. */
function lineOf(fragment: string, why: string): number {
  const at = MIDDLEWARE.indexOf(fragment);
  assert.notEqual(at, -1, `${why} — middleware.ts no longer contains: ${fragment}`);
  return at;
}

test("THE CARVE-OUT IS AN ADMISSION, AND IT SITS ABOVE ALL THREE REFUSALS", () => {
  // The whole reason it exists where it does. Below any one of these three it
  // would be dead code for the login it was written for, and the failure would
  // look exactly like the grant not having been made.
  const carveOut = lineOf(
    "if (hasFgView(activeUser) && fgViewMayVisit(p)) return;",
    "the finished-goods admission"
  );
  const chromiaBlock = lineOf(
    'if (role === "CHROMIA" || (!isAdmin && branch === "CHROMIA")) {',
    "the Chromia branch cap"
  );
  const fabBlock = lineOf(
    'if (!isAdmin && branch === "FABRICATION") {',
    "the Fabrication branch cap"
  );
  const officeOnly = lineOf(
    'if (!isAdmin && branch !== "OFFICE" && p.startsWith("/inventory")) {',
    "the office-only refusal on /inventory"
  );

  assert.ok(carveOut < chromiaBlock, "chromia@ is capped to /chromia by a block with a terminal return");
  assert.ok(carveOut < fabBlock, "gibin@'s branch block lists no page outside /fab");
  assert.ok(carveOut < officeOnly, "and this one refuses /inventory to every branch but OFFICE");
});

test("AND NEITHER BRANCH BLOCK WAS WIDENED TO GET THERE", () => {
  // The alternative shape — relaxing the two caps in place — would have handed
  // a whole branch, and everybody put on it afterwards, what was granted to one
  // login. Both allowlists are therefore pinned verbatim: the Chromia tablet's
  // narrow one, and the fab manager's.
  assert.ok(
    MIDDLEWARE.includes('const ok = p.startsWith("/chromia") || p.startsWith("/api/chromia") || isPublicAsset(p);'),
    "the Chromia cap must still be the Chromia screens and their APIs, nothing more"
  );
  assert.ok(
    MIDDLEWARE.includes('const ok = fabPath || p === "/" || isPublicAsset(p);'),
    "the fab manager's cap must still be the fab pages and Overview"
  );
  // And the office-only refusal still refuses: the carve-out returns before it
  // for a viewer, and changes nothing for anybody else on a non-OFFICE branch.
  assert.ok(
    MIDDLEWARE.includes('// Finished-goods inventory is an Office (Commercial) module — shop floor never sees it.'),
    "the office-only rule must survive, for every login that does not hold the grant"
  );
});

test("the admission is keyed on the ACTIVE pair's user object, like every rule around it", () => {
  // `activeUser`, not `req.auth.user`: a login holding two jobs is judged by
  // the pair it is running as everywhere else in this file, and the flag rides
  // on the same object through applyRoleContext. Reading the raw session user
  // here would be the one rule in the file that answers a different question.
  assert.match(MIDDLEWARE, /hasFgView\(activeUser\)/);
});

// ---------------------------------------------------------------------------
// THE ROOM BEHIND THAT DOOR — /api/photo, which cannot be imported either
// ---------------------------------------------------------------------------
//
// Opening /api/photo at the fence only gets a viewer as far as the handler, and
// the handler has its own audience test. It asked that test with a pair of
// strings — hasInventoryAccess(role, branch) — which is @deprecated precisely
// because a pair of strings cannot carry users.fg_view, so the fence and the
// route each refused one of the two granted logins and between them refused
// both. The route pulls in Prisma and next-auth and so is read out of the
// source, the way middleware.ts is above.

const PHOTO_ROUTE = src("src/app/api/photo/route.ts");

test("THE PHOTO ROUTE ASKS THE OBJECT FORM — a role and a branch cannot carry the grant", () => {
  assert.match(
    PHOTO_ROUTE,
    /r\.model === "FinishedSlab" && hasInventoryAccess\(me\)/,
    "the inventory audience for a slab photo must be decided from the whole user"
  );
  // Stated from the other end as well, because the failure is not an absent
  // call but a present one of the wrong shape: the deprecated overload compiles,
  // type-checks, and answers the pre-grant rule in silence.
  assert.doesNotMatch(
    PHOTO_ROUTE,
    /hasInventoryAccess\(\s*role/,
    "the two-string form answers the rule as it stood before 2026-09-14 and refuses a viewer"
  );
});

test("AND IT CARRIES FINISHED GOODS AND NOT THE REST", () => {
  // The fence matches a path and /api/photo carries an id, not a model, so the
  // admission necessarily opens the endpoint for every model in the ERP and the
  // scoping has to happen in the route. Both halves are pinned: the grant is
  // answered only for the one model the slab panel renders, and the Chromia cap
  // that used to refuse this endpoint on the fence's behalf is restated here,
  // in the form middleware states it, so a Chromia login cannot pull downtime
  // or QC evidence by id through a door opened for finished goods.
  assert.match(
    PHOTO_ROUTE,
    /if \(role === "CHROMIA" \|\| branch === "CHROMIA"\) return Response\.json\(\{ error: "Not authorized" \}, \{ status: 403 \}\);/,
    "the Chromia tablet must be refused every model this route serves except the one answered above"
  );
  assert.match(
    MIDDLEWARE,
    /if \(role === "CHROMIA" \|\| \(!isAdmin && branch === "CHROMIA"\)\) \{/,
    "and it must still be the cap the route is restating"
  );
});
