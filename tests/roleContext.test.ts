import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_RANK } from "../src/lib/roles.ts";
import { BRANCHES } from "../src/lib/branchNames.ts";
import {
  ROLE_CONTEXT_COOKIE, ROLE_CONTEXT_COOKIE_MAX_AGE,
  contextKey, primaryContext, alternateContext, grantedContexts,
  selectContext, resolveRoleContext, applyRoleContext, activeContextOf,
} from "../src/lib/roleContext.ts";

// THE COOKIE IS A SELECTOR, NOT A CLAIM.
//
// Everything below exists to pin that one sentence. The feature lets one login
// hold two granted role+branch pairs and a cookie choose between them, which is
// a permission decision driven by a value the browser can edit — so the tests
// that matter are not the happy path but the forged, stale and half-granted
// ones. Each of those must land on the PRIMARY pair: the job the login held
// before any of this existed.
//
// resolveRoleContext falls back silently and selectContext answers null, and
// both are the same function underneath — the switcher refuses where the
// resolver falls back. That shared root is why a forgery cannot be accepted by
// one and rejected by the other.

const ROLE_NAMES = Object.keys(ROLE_RANK);
const BRANCH_NAMES = [...BRANCHES];

const LM   = { role: "LINE_MANAGER", branch: "SHOP_FLOOR" };
const FAB  = { role: "INCHARGE",     branch: "FABRICATION" };

/** The person this feature was built for: Line Manager, also fab supervisor. */
const both = { ...LM, altRole: FAB.role, altBranch: FAB.branch };
/** Everybody else. */
const single = { ...LM, altRole: null, altBranch: null };

const keyLM  = contextKey(LM.role, LM.branch);
const keyFAB = contextKey(FAB.role, FAB.branch);

test("context: a pair's key is the only thing a cookie is compared against", () => {
  assert.equal(keyLM, "LINE_MANAGER:SHOP_FLOOR");
  assert.notEqual(keyLM, keyFAB);
  assert.equal(contextKey(null, undefined), ":");
  // THE INVARIANT THIS FORMAT DEPENDS ON, stated as a failing-if-forgotten
  // test rather than a comment. The key is a plain join, so with ARBITRARY
  // strings two different pairs DO collide:
  assert.equal(contextKey("A:B", "C"), contextKey("A", "B:C"));
  // It is safe only because Role and Branch are Postgres enums and no enum
  // label in this schema contains a colon. Both halves of every key ever
  // compared come from those two columns, so the collision above is
  // unreachable in practice. If a free-text column is ever keyed here, this
  // separator has to change with it.
  for (const label of [...ROLE_NAMES, ...BRANCH_NAMES]) {
    assert.ok(!label.includes(":"), label);
  }
});

test("context: the cookie name and lifetime are pinned", () => {
  assert.equal(ROLE_CONTEXT_COOKIE, "erp_role_context");
  // Matched to the JWT's 8h maxAge: a selector must not outlive the session
  // whose granted pairs it selects between.
  assert.equal(ROLE_CONTEXT_COOKIE_MAX_AGE, 8 * 60 * 60);
});

test("context: a login with one job has one context and no alternate", () => {
  assert.equal(alternateContext(single), null);
  assert.deepEqual(grantedContexts(single), [{ ...LM, isAlternate: false }]);
  // One entry is what makes the switcher render nothing at all.
  assert.equal(grantedContexts(single).length, 1);
});

test("context: a login with two jobs offers both, primary first", () => {
  const ctxs = grantedContexts(both);
  assert.equal(ctxs.length, 2);
  assert.deepEqual(ctxs[0], { ...LM, isAlternate: false });
  assert.deepEqual(ctxs[1], { ...FAB, isAlternate: true });
});

test("context: a HALF-FILLED grant is not a grant", () => {
  // A role without a branch would have to borrow the other half from the
  // primary — inventing a pair the admin never granted.
  assert.equal(alternateContext({ ...LM, altRole: "INCHARGE", altBranch: null }), null);
  assert.equal(alternateContext({ ...LM, altRole: null, altBranch: "FABRICATION" }), null);
  assert.equal(alternateContext({ ...LM, altRole: "  ", altBranch: "FABRICATION" }), null);
  assert.equal(alternateContext({ ...LM, altRole: "INCHARGE", altBranch: "   " }), null);
});

test("context: an alternate equal to the primary is not a second job", () => {
  const same = { ...LM, altRole: LM.role, altBranch: LM.branch };
  assert.equal(alternateContext(same), null);
  // Otherwise the switcher would offer a control that does nothing.
  assert.equal(grantedContexts(same).length, 1);
});

test("context: no cookie resolves to the primary", () => {
  for (const v of [null, undefined, ""]) {
    assert.deepEqual(resolveRoleContext(both, v), { ...LM, isAlternate: false });
  }
});

test("context: the cookie selects each granted pair", () => {
  assert.deepEqual(resolveRoleContext(both, keyLM),  { ...LM,  isAlternate: false });
  assert.deepEqual(resolveRoleContext(both, keyFAB), { ...FAB, isAlternate: true });
});

test("context: A FORGED COOKIE falls back to the primary", () => {
  const forged = [
    contextKey("ADMIN", "OFFICE"),          // a role the login does not hold
    contextKey("ADMIN", "SHOP_FLOOR"),      // right branch, escalated role
    contextKey("LINE_MANAGER", "OFFICE"),   // right role, wrong department
    "ADMIN", "ADMIN:", ":OFFICE", ":", "::",
    keyFAB + ":ADMIN",                      // a granted key with a tail
    keyFAB.toLowerCase(),                   // case must not be forgiven
    ` ${keyFAB}`, `${keyFAB} `,             // nor whitespace
  ];
  for (const want of forged) {
    assert.deepEqual(resolveRoleContext(both, want), { ...LM, isAlternate: false }, want);
    assert.equal(selectContext(both, want), null, want);
  }
});

test("context: A REVOKED alternate cannot be reached by its old cookie", () => {
  // The admin cleared the second job; the browser still holds the selector.
  assert.equal(selectContext(single, keyFAB), null);
  assert.deepEqual(resolveRoleContext(single, keyFAB), { ...LM, isAlternate: false });
});

test("context: a login with NO alternate ignores every cookie value", () => {
  for (const want of [keyLM, keyFAB, "ADMIN:OFFICE", "nonsense"]) {
    assert.equal(resolveRoleContext(single, want).isAlternate, false);
    assert.equal(resolveRoleContext(single, want).role, LM.role);
  }
});

test("context: no value travels OUT of the cookie into the resolved pair", () => {
  // The returned pair is rebuilt from the user's own columns, so a cookie can
  // never introduce a role or a branch that is not already on the row. Proven
  // by exhaustion: whatever the cookie says, the answer is one of the granted.
  const granted = grantedContexts(both).map((c) => contextKey(c.role, c.branch));
  const probes = ["ADMIN:OFFICE", keyFAB, keyLM, "", "x", "FINANCE:OFFICE", "::::"];
  for (const want of probes) {
    const got = resolveRoleContext(both, want);
    assert.ok(granted.includes(contextKey(got.role, got.branch)), want);
  }
});

test("context: a null or absent user resolves to an empty primary, never a throw", () => {
  for (const u of [null, undefined, {}]) {
    const got = resolveRoleContext(u as never, keyFAB);
    assert.deepEqual(got, { role: "", branch: "", isAlternate: false });
  }
  assert.equal(selectContext(null, keyFAB), null);
  assert.equal(alternateContext(undefined), null);
});

test("overlay: a single-job login is not merely unchanged, it is untouched", () => {
  // Identity, not a copy — the strongest form of "this feature cannot affect
  // anybody who does not hold two jobs".
  const ctx = primaryContext(single);
  assert.equal(applyRoleContext(single, ctx), single);
  assert.equal(activeContextOf(single, keyFAB), single);
});

test("overlay: the alternate replaces role and branch and nothing else", () => {
  const user = { ...both, id: "u1", email: "a@b.c", salesRole: "RM" };
  const got = activeContextOf(user, keyFAB);
  assert.equal(got.role, FAB.role);
  assert.equal(got.branch, FAB.branch);
  assert.equal(got.id, "u1");
  assert.equal(got.email, "a@b.c");
  assert.equal(got.salesRole, "RM");
  // The grant itself survives, which is what makes the overlay idempotent.
  assert.equal(got.altRole, FAB.role);
  assert.equal(got.altBranch, FAB.branch);
});

test("overlay: applying twice is the same as applying once", () => {
  const once = activeContextOf(both, keyFAB);
  const twice = activeContextOf(once, keyFAB);
  assert.deepEqual(twice, once);
  // And an already-overlaid user reports no alternate, so asking IT for the
  // granted pairs yields one entry — the switcher disappears rather than
  // offering something wrong. (Documented in grantedContexts: pass the granted
  // user, not currentUser().)
  assert.equal(grantedContexts(once).length, 1);
});

// ── AUTHORITY IS THE HIGHEST HAT, NOT THE ONE BEING WORN ───────────────────
//
// canManageTarget() (app/admin/users/actions.ts) and the button-rendering rule
// in UserAdmin.tsx both rank a TARGET account. Ranking it by the primary role
// alone made a second job invisible to the check guarding password resets — the
// escalation pinned below. Neither call site is importable here (one is a
// server action, the other a client component, and both pull the auth chain in
// with them), so what is pinned is the RULE they share, against the same rank
// table they both read.
const rankOfRole = (role?: string | null) => ROLE_RANK[String(role ?? "")] ?? 0;
/** What both call sites now compute. */
const targetRank = (u: { role: string; altRole?: string | null }) =>
  Math.max(rankOfRole(u.role), u.altRole ? rankOfRole(u.altRole) : 0);

test("authority: A SECOND JOB CANNOT HIDE BEHIND A JUNIOR PRIMARY", () => {
  // The exact escalation: an Incharge (2) looking at an Operator (1) who also
  // holds a Line Manager (3) alternate.
  const target = { role: "OPERATOR", altRole: "LINE_MANAGER" };
  const inchargeRank = rankOfRole("INCHARGE");

  // What the old expression said — kept as a live demonstration of the hole, so
  // a revert cannot pass silently.
  assert.ok(rankOfRole(target.role) < inchargeRank, "primary-only ranking permitted the reset");
  // What it says now.
  assert.ok(!(targetRank(target) < inchargeRank), "an Incharge must not manage a Line Manager alternate");
  // And the escalation was real: the alternate outranks the caller.
  assert.ok(rankOfRole(target.altRole) > inchargeRank);
});

test("authority: the rule changes nothing for accounts holding one job", () => {
  // Every single-job account ranks exactly as it did before the fix — the
  // property that makes this safe to ship without re-auditing the whole screen.
  for (const role of Object.keys(ROLE_RANK)) {
    assert.equal(targetRank({ role, altRole: null }), rankOfRole(role), role);
    assert.equal(targetRank({ role }), rankOfRole(role), role);
  }
});

test("authority: an alternate BELOW the primary does not lower the target", () => {
  // max(), not "prefer the alternate" — a Line Manager who also covers an
  // Operator shift is still a Line Manager to anyone trying to manage them.
  assert.equal(targetRank({ role: "LINE_MANAGER", altRole: "OPERATOR" }), rankOfRole("LINE_MANAGER"));
  // An unrecognised label ranks 0 and can never raise anybody.
  assert.equal(targetRank({ role: "OPERATOR", altRole: "NOT_A_ROLE" }), rankOfRole("OPERATOR"));
});

test("overlay: switching back to the primary is reachable from the alternate", () => {
  const inFab = activeContextOf(both, keyFAB);
  assert.equal(inFab.role, FAB.role);
  // The gates resolve from the GRANTED row each request, so the primary key
  // still selects the primary.
  assert.deepEqual(resolveRoleContext(both, keyLM), { ...LM, isAlternate: false });
});
