// The cookie half of the active role context. lib/roleContext.ts stays pure so
// middleware and node --test can both reach it; everything that needs
// `next/headers` lives here — the same split as lib/fab/processSession.ts and
// lib/fab/processSessionServer.ts.
//
// Nothing in this file decides anything. It reads a string out of a cookie and
// writes a string into one; WHAT that string may select is decided by
// selectContext() in the pure module, from the columns an admin granted.
import { cookies } from "next/headers";
import {
  ROLE_CONTEXT_COOKIE,
  ROLE_CONTEXT_COOKIE_MAX_AGE,
  contextKey,
  type RoleContext,
} from "@/lib/roleContext";

/**
 * The raw selector, or null.
 *
 * Wrapped, because currentUser() calls this on EVERY request: a context where
 * `cookies()` is unavailable must degrade to "no selector", which resolves to
 * the primary — the pair the login held before this feature existed. Failing
 * this read can therefore narrow a session but never widen one.
 */
export async function readRoleContextCookie(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(ROLE_CONTEXT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Select a pair. Callable only from a server action or route handler (Next
 *  refuses cookie writes during render). The VALUE written is a key computed
 *  from a pair the caller has already validated with selectContext. */
export async function setRoleContextCookie(ctx: RoleContext): Promise<void> {
  const store = await cookies();
  store.set(ROLE_CONTEXT_COOKIE, contextKey(ctx.role, ctx.branch), {
    httpOnly: true,
    path: "/",
    maxAge: ROLE_CONTEXT_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}

/**
 * Drop the selector — called on every sign-out, both the main one and the fab
 * one.
 *
 * Not a security control (a selector can only ever name a granted pair), but a
 * predictability one: without it, signing back in would resume in whichever job
 * the last session ended in, while login/actions.ts computes its landing page
 * from the PRIMARY row in the database. Every sign-in therefore starts in the
 * primary job, which is also the job a single-role login has always started in.
 */
export async function clearRoleContextCookie(): Promise<void> {
  try {
    const store = await cookies();
    store.delete(ROLE_CONTEXT_COOKIE);
  } catch {
    /* nothing to clear */
  }
}
