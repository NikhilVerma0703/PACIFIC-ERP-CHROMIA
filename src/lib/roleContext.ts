// The ACTIVE ROLE CONTEXT — which of the (at most two) role+branch pairs an
// admin granted a login is the one this request runs as.
//
// WHY THIS FILE EXISTS
// One person does two jobs: Line Manager on the production line and
// Fabrication Supervisor. That was two email accounts and two logins. It is now
// one login holding two GRANTED PAIRS — users.role/users.branch (the primary,
// exactly as before) and users.alt_role/users.alt_branch (the second job, NULL
// for everybody who has only one). A cookie says which pair is live.
//
// THE SAFETY PROPERTY, and the whole reason this is a separate module:
//
//   THE COOKIE IS A SELECTOR, NOT A CLAIM.
//
// Nothing here ever reads a role or a branch OUT of the cookie. The cookie's
// value is compared, by string equality, against keys computed from the pairs
// the ADMIN granted; the pair that is returned is built from the user's own
// columns. A forged cookie, a stale one, or one left over after an admin
// revoked the second job therefore cannot name a role the login does not hold —
// it simply matches nothing, and matching nothing falls back to the primary.
// A login with no alternate resolves to its primary whatever the cookie says.
//
// ONE RULE, TWO ENTRY POINTS. selectContext() is the only place that decides
// whether a requested pair is granted. The switcher calls it and REFUSES when
// it answers null; the resolver calls it and FALLS BACK TO THE PRIMARY when it
// answers null. They cannot drift, because there is nothing to drift from —
// the same reason lib/routeCaps.ts holds the caps for both gates.
//
// NO IMPORTS AT ALL, deliberately, and for three separate reasons:
//   * middleware.ts and auth.config.ts import it, so it is EDGE CODE: no
//     Prisma, no `next/headers`, no server-only module may ever appear here
//     (the rule lib/routeCaps.ts states at its head, for the same reason).
//   * `node --test` can import it, so the resolution is unit-tested against the
//     real function rather than a copy — see tests/roleContext.test.ts.
//   * it holds no enum list, so it is not a second copy of Role or Branch. The
//     values it compares come from the database columns an admin wrote.
//
// The cookie/session plumbing lives in lib/roleContextServer.ts (next/headers)
// exactly as lib/fab/processSession.ts splits from processSessionServer.ts.

/** httpOnly, path "/", sameSite lax — the same shape as the fab machine-session
 *  cookies in lib/fab/processSessionServer.ts. */
export const ROLE_CONTEXT_COOKIE = "erp_role_context";

/** Matched to the JWT's own maxAge (auth.config.ts: 8 hours), so a selector
 *  cannot outlive the session whose granted pairs it selects between. */
export const ROLE_CONTEXT_COOKIE_MAX_AGE = 8 * 60 * 60;

/** What an admin granted a login: its own role+branch, and optionally a second
 *  pair. Structurally satisfied by the session user, the JWT and a users row
 *  alike, which is why all three gates can ask the same question. */
export interface GrantedContexts {
  role?: string | null;
  branch?: string | null;
  altRole?: string | null;
  altBranch?: string | null;
}

export interface RoleContext {
  role: string;
  branch: string;
  /** True ONLY for the alternate pair. Every caller that changes behaviour
   *  keys off this, so a single-job login is untouched by this whole feature —
   *  not "treated the same", literally not touched: see applyRoleContext. */
  isAlternate: boolean;
}

/**
 * The identity of a pair, and the only thing a cookie is ever compared against.
 *
 * Role and Branch are Postgres enums, so neither can contain the separator and
 * two different pairs cannot collide on one key.
 */
export function contextKey(role?: string | null, branch?: string | null): string {
  return `${String(role ?? "")}:${String(branch ?? "")}`;
}

/** The login's own role and branch — what every gate read before this feature
 *  and still reads when no alternate is active. */
export function primaryContext(user: GrantedContexts | null | undefined): RoleContext {
  return {
    role: String(user?.role ?? ""),
    branch: String(user?.branch ?? ""),
    isAlternate: false,
  };
}

/**
 * The second job, or null when there isn't one.
 *
 * Null in three cases, all of which mean "this login has one job":
 *   * neither column set — the overwhelming majority of users;
 *   * only ONE of the two set. A half-filled grant is not a grant: a role
 *     without a branch (or the reverse) would have to borrow the other half
 *     from the primary, which is inventing a pair the admin did not grant;
 *   * the alternate is the SAME pair as the primary. Nothing to switch to, so
 *     offering a switcher would be a control that does nothing.
 */
export function alternateContext(user: GrantedContexts | null | undefined): RoleContext | null {
  const role = String(user?.altRole ?? "").trim();
  const branch = String(user?.altBranch ?? "").trim();
  if (!role || !branch) return null;
  const primary = primaryContext(user);
  if (role === primary.role && branch === primary.branch) return null;
  return { role, branch, isAlternate: true };
}

/**
 * Every pair this login may run as, primary first.
 *
 * One entry for almost everybody; two for the few who hold a second job. The
 * switcher renders nothing at all when this has one entry — no empty picker,
 * no stray chrome.
 *
 * PASS THE GRANTED USER (rbac.grantedUser), NOT currentUser(). currentUser()
 * has already had the active pair overlaid onto role/branch, so asking it what
 * was granted would describe the pair you are standing in as the primary. That
 * mis-call is safe — the alternate then equals the primary and this returns a
 * single entry, so the switcher disappears rather than offering something
 * wrong — but it is still the wrong question.
 */
export function grantedContexts(user: GrantedContexts | null | undefined): RoleContext[] {
  const alt = alternateContext(user);
  return alt ? [primaryContext(user), alt] : [primaryContext(user)];
}

/**
 * THE VALIDATOR. Which granted pair does `want` name — or null if it names
 * nothing this login holds.
 *
 * Null is the answer for a forged key, for a key that was granted once and has
 * since been revoked, and for anything at all when the login has no alternate.
 * The returned pair is built from the USER's columns; `want` only ever
 * participates in an equality test, so no value can travel out of the caller's
 * string and into a permission.
 */
export function selectContext(
  user: GrantedContexts | null | undefined,
  want: string | null | undefined,
): RoleContext | null {
  if (typeof want !== "string" || !want) return null;
  for (const ctx of grantedContexts(user)) {
    if (contextKey(ctx.role, ctx.branch) === want) return ctx;
  }
  return null;
}

/**
 * THE RESOLVER. The pair this request runs as, given the cookie.
 *
 * Falls back to the primary silently — a stale or forged selector is not an
 * error the person clicking can do anything about, and the fallback is always
 * the pair they held before any of this existed.
 */
export function resolveRoleContext(
  user: GrantedContexts | null | undefined,
  cookieValue: string | null | undefined,
): RoleContext {
  return selectContext(user, cookieValue) ?? primaryContext(user);
}

/**
 * THE OVERLAY — the one place a resolved context is written onto a user.
 *
 * Returns the SAME OBJECT, untouched, unless the alternate is active. That is
 * deliberate and is the strongest form of "a user with either column NULL
 * behaves exactly as today": there is no re-coercion of role, no defaulting of
 * a null branch, no new object identity — for a single-job login this function
 * is the identity function.
 *
 * IDEMPOTENT. Applying it to an already-overlaid user is a no-op: the copy
 * carries the alternate columns, so its alternate now equals its primary,
 * alternateContext() answers null, and the pair is returned unchanged.
 */
export function applyRoleContext<T extends GrantedContexts>(user: T, ctx: RoleContext): T {
  if (!ctx.isAlternate) return user;
  // `as unknown as T`, not `any`: the session user types role as the Prisma
  // Role enum while a granted pair is carried here as a plain string (this
  // module holds no enum list, on purpose — see the header). The value written
  // came out of the user's OWN altRole column, so it is a Role; TypeScript
  // cannot see that through the generic.
  return { ...user, role: ctx.role, branch: ctx.branch } as unknown as T;
}

/** applyRoleContext ∘ resolveRoleContext — what a gate holding a session user
 *  and a cookie value wants, in one call. */
export function activeContextOf<T extends GrantedContexts>(
  user: T,
  cookieValue: string | null | undefined,
): T {
  return applyRoleContext(user, resolveRoleContext(user, cookieValue));
}
