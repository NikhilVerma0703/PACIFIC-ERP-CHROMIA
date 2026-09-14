import type { NextAuthConfig, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { storeMayVisit, operatorMayVisit, fgViewMayVisit, isPublicAsset, isCronRoute, STORE_HOME, OPERATOR_HOME } from "./lib/routeCaps.ts";
// The active role context. Pure and import-free, exactly like routeCaps above —
// it must be, because this file is edge-safe and Prisma-free.
import { ROLE_CONTEXT_COOKIE, activeContextOf, type GrantedContexts } from "./lib/roleContext.ts";
// The finished-goods view grant (users.fg_view), from the same import-free
// module middleware.ts and every inventory route gate read it from.
import { hasFgView } from "./lib/inventory/accessRules.ts";
import type { Role } from "@prisma/client";

/**
 * Refuse a page and say which one - the same answer middleware.ts gives.
 *
 * Both gates have to agree, because either can be the one that stops a
 * request: this callback runs first and a Response returned here replaces
 * middleware entirely. If only one of them showed the refusal page, whether a
 * user got an explanation or a silent bounce would depend on which gate caught
 * them - which is precisely the kind of difference nobody can reproduce.
 */
function refuse(p: string, nextUrl: URL, home: string): Response {
  // "/" is not a denial - it is where sign-in sends everybody
  // (src/app/login/actions.ts starts every login there). A capped role whose
  // allowlist excludes "/" therefore hits this on its FIRST page after
  // signing in, and answering that with the refusal page is a lockout. Same
  // rule as middleware.ts denied().
  if (p === "/") return Response.redirect(new URL(home, nextUrl));
  const url = new URL("/no-access", nextUrl);
  url.searchParams.set("from", p);
  return Response.redirect(url);
}

// Edge-safe Auth.js config — NO Prisma, NO bcrypt imports here.
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60, updateAge: 30 * 60 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    // TYPED EXPLICITLY, and `satisfies NextAuthConfig` at the foot of this
    // object is not enough to do it: next-auth's own callback signatures do not
    // reach these parameters, so all three destructures were implicitly `any`
    // and `next build` refused the file under noImplicitAny. Type-only — every
    // body below is untouched.
    authorized({ auth, request }: { auth: Session | null; request: NextRequest }) {
      const { nextUrl } = request;
      const isLoggedIn = !!auth?.user;
      const isPublic =
        nextUrl.pathname === "/login" ||
        // Must be public here as well as in middleware: this callback runs
        // FIRST and its Response replaces middleware wholesale, so a capped
        // role refused there would be bounced off the refusal page here.
        nextUrl.pathname === "/no-access" ||
        nextUrl.pathname.startsWith("/api/auth") ||
        // The scheduled reports, from the SAME list middleware reads
        // (lib/routeCaps). Named here as well as there because this callback
        // runs first and a Response it returns replaces every rule over there.
        // None of them is open: each refuses anything without its own secret,
        // and refuses everything when that secret is unset.
        isCronRoute(nextUrl.pathname) ||
        // The SAME allowlist middleware uses — not a copy. The old rule here
        // was "anything ending in .png/.svg/…", which marked /tables/Press.png
        // and /api/mis/export.xml "public" in the gate that runs FIRST; it was
        // the last survivor of the three copies routeCaps.ts replaced, inert
        // only while middleware re-checked behind it. Sharing the function is
        // what keeps the two gates incapable of disagreeing.
        isPublicAsset(nextUrl.pathname);
      if (isPublic) return true;
      if (!isLoggedIn) return false;

      // Fabrication staff are routed ENTIRELY by middleware.ts (the branch
      // allowlist). They must escape before the role caps below, because those
      // caps are Shop Floor rules that know nothing about branches — and this
      // callback outranks middleware.ts rather than running alongside it.
      //
      // Auth.js only reaches the user middleware when `authorized` returns a
      // boolean: node_modules/next-auth/lib/index.js takes `if (authorized
      // instanceof Response) { response = authorized }` and never evaluates the
      // `else if (userMiddlewareOrRoute)` branch. So a Response returned here
      // silently replaces every rule in middleware.ts for that request.
      //
      // Without this, a FABRICATION OPERATOR asking for /fab/cutting was capped
      // to /entry by the role check below, and middleware — had it run — bounces
      // /entry straight back to /fab/cutting. Two gates in two files, each
      // redirecting to the other's forbidden page: a closed loop that ends in
      // ERR_TOO_MANY_REDIRECTS the moment the operator signs in. 7301da7 dropped
      // the `if (fabRole) return true` that used to prevent exactly this when it
      // folded fabRole into branch+role, and never replaced it.
      //
      // Gate on BRANCH, not role: fab LINE_MANAGER and INCHARGE work today only
      // because their roles happen to be absent from the caps below, so a future
      // capped role in Fabrication would reopen the same loop.
      //
      // ---- THE ACTIVE ROLE CONTEXT ----------------------------------------
      // Judge the request by the pair it is RUNNING AS, not the pair it was
      // issued with. A login that holds two jobs carries both in its JWT
      // (altRole/altBranch); the cookie says which is live, and
      // activeContextOf() overlays it — the SAME pure function currentUser()
      // uses, with the same inputs, so this gate, middleware.ts and every
      // server render answer "who is this" identically. A gate that disagreed
      // with currentUser() about who somebody is, is precisely the failure
      // lib/routeCaps.ts was written to end.
      //
      // The cookie cannot widen anything: it is compared against keys built
      // from the two granted pairs and falls back to the primary when it
      // matches neither, so a forged, stale or revoked selector lands the user
      // exactly where they were before the switcher existed. Nothing here is
      // read OUT of the cookie.
      //
      // `request.cookies` is a NextRequest cookie jar — no `next/headers`, no
      // Prisma, so this file stays edge-safe. Optional-chained because the
      // fallback (no selector -> the primary) is the safe direction.
      const sessionUser = (auth?.user ?? {}) as GrantedContexts;
      const activeUser = activeContextOf(sessionUser, request.cookies?.get?.(ROLE_CONTEXT_COOKIE)?.value);
      const branch = (activeUser as { branch?: string }).branch;
      if (branch === "FABRICATION") return true;
      // TRANSITIONAL: the retired Chromia department. A CHROMIA-branch login
      // capped to /entry by the role check below would be bounced back to
      // /chromia by middleware — the exact FABRICATION loop described above,
      // one branch value later. Goes when scripts/0046-migrate-chromia-branch-users.sql
      // has moved the last of them onto role CHROMIA.
      if (branch === "CHROMIA") return true;

      // The caps live in lib/routeCaps so this file and middleware.ts cannot
      // disagree about them again. They did: this gate allowed the Store
      // Incharge only /live, /store and /api while middleware also granted
      // /tables, /consumables and /office/batch-verify — and this one runs
      // first, so those three screens bounced to /live.
      const role = (activeUser as { role?: string }).role;
      // Their OWN home, not homeFor(role, branch). This gate caps by ROLE and
      // refuses anything outside that role's allowlist - including the branch home
      // homeFor would name. Sending a STORE login on the Office branch to /office
      // means THIS gate refuses it on the next hop, which is a worse answer than
      // the one it replaced. A role and a branch whose caps do not intersect has
      // nowhere to land at all; that is a configuration to reject in Users &
      // Roles, not something a landing page can paper over.
      const p = nextUrl.pathname;
      // THE FINISHED-GOODS VIEW GRANT, admitted here as well as in
      // middleware.ts and out of the same two functions (hasFgView, and
      // fgViewMayVisit for the paths it reaches: /inventory, /api/inventory and
      // the /api/photo endpoint the slab detail panel loads its shots from).
      //
      // It changes no decision today, and is here anyway. Both logins the owner
      // named on 2026-09-14 are LINE_MANAGER, a role with no cap below, so both
      // already fall through to `return true` and leave the routing to
      // middleware. The day the flag is put on a CAPPED login — a store
      // incharge, an operator — this gate would refuse the page while the route
      // gates cheerfully answered its API, which is the page-refused-while-the-
      // API-is-open failure lib/commercial/access-rules.ts records. It costs one
      // line to be unable to have that argument with middleware.
      //
      // An ADMISSION, exactly like the FABRICATION and CHROMIA escapes above:
      // it opens a door and decides nothing about what is behind it. Whether a
      // viewer may change anything is settled in the route, by inventoryGate()
      // refusing them.
      if (hasFgView(activeUser) && fgViewMayVisit(p)) return true;
      if (role === "STORE" && !storeMayVisit(p)) return refuse(p, nextUrl, STORE_HOME);
      if (role === "OPERATOR" && !operatorMayVisit(p)) return refuse(p, nextUrl, OPERATOR_HOME);
      return true;
    },
    jwt({ token, user }: { token: JWT; user?: User | null }) {
      if (user) {
        token.role = (user as { role: Role }).role;
        token.uid = user.id as string;
        token.station = (user as { station?: string | null }).station ?? null;
        token.branch = (user as { branch?: string | null }).branch ?? null;
        token.altRole = (user as { altRole?: string | null }).altRole ?? null;
        token.altBranch = (user as { altBranch?: string | null }).altBranch ?? null;
        // The finished-goods view grant. `=== true` rather than `?? false`, so
        // the claim is a boolean whatever authorize() handed over — and so a
        // token minted before this line existed carries false rather than
        // undefined. A missing grant is not a grant; see hasFgView.
        token.fgView = (user as { fgView?: boolean | null }).fgView === true;
        token.sv = (user as { sv?: number }).sv ?? 1;
      }
      return token;
    },
    session({ session, token }: { session: Session; token: JWT }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as Role;
        session.user.station = (token.station as string | null) ?? null;
        session.user.branch = (token.branch as string | null) ?? null;
        // THE SECOND GRANTED PAIR MUST BE COPIED HERE, not only in auth.ts.
        // middleware.ts builds its `req.auth` from `NextAuth(authConfig)` —
        // THIS session callback, not the one in auth.ts — so a pair that
        // reached the token and stopped here would be invisible to the gate
        // that needs it most, and middleware would judge a switched user by
        // their primary while every server render judged them by the alternate.
        session.user.altRole = (token.altRole as string | null) ?? null;
        session.user.altBranch = (token.altBranch as string | null) ?? null;
        // THE VIEW GRANT MUST BE COPIED HERE TOO, for the reason the paragraph
        // above gives about the second pair, and rather more sharply: the gate
        // that has to admit these two logins THROUGH their branch caps is
        // middleware.ts, and middleware builds its `req.auth` from
        // NextAuth(authConfig) — this callback. A flag that reached the token
        // and stopped there would leave the owner's grant invisible to the one
        // rule standing between chromia@ and the page he was granted.
        //
        // It also reaches every server render this way: currentUser() returns
        // this same session user, so hasFgView() in the route gates and
        // hasFgView() at the edge read one value. `=== true` again — an old
        // token carries no such claim, and no claim is no grant.
        session.user.fgView = token.fgView === true;
        (session.user as { sv?: number }).sv = (token.sv as number | undefined) ?? 1;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
