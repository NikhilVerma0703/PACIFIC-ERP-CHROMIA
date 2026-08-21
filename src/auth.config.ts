import type { NextAuthConfig } from "next-auth";
import { storeMayVisit, operatorMayVisit, STORE_HOME, OPERATOR_HOME } from "./lib/routeCaps.ts";
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
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublic =
        nextUrl.pathname === "/login" ||
        // Must be public here as well as in middleware: this callback runs
        // FIRST and its Response replaces middleware wholesale, so a capped
        // role refused there would be bounced off the refusal page here.
        nextUrl.pathname === "/no-access" ||
        nextUrl.pathname.startsWith("/api/auth") ||
        /\.(png|jpg|jpeg|svg|webp|ico|webmanifest|txt|xml)$/.test(nextUrl.pathname);
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
      const branch = (auth?.user as { branch?: string } | undefined)?.branch;
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
      const role = (auth?.user as { role?: string } | undefined)?.role;
      // Their OWN home, not homeFor(role, branch). This gate caps by ROLE and
      // refuses anything outside that role's allowlist - including the branch home
      // homeFor would name. Sending a STORE login on the Office branch to /office
      // means THIS gate refuses it on the next hop, which is a worse answer than
      // the one it replaced. A role and a branch whose caps do not intersect has
      // nowhere to land at all; that is a configuration to reject in Users &
      // Roles, not something a landing page can paper over.
      const p = nextUrl.pathname;
      if (role === "STORE" && !storeMayVisit(p)) return refuse(p, nextUrl, STORE_HOME);
      if (role === "OPERATOR" && !operatorMayVisit(p)) return refuse(p, nextUrl, OPERATOR_HOME);
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: Role }).role;
        token.uid = user.id as string;
        token.station = (user as { station?: string | null }).station ?? null;
        token.branch = (user as { branch?: string | null }).branch ?? null;
        token.sv = (user as { sv?: number }).sv ?? 1;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as Role;
        session.user.station = (token.station as string | null) ?? null;
        session.user.branch = (token.branch as string | null) ?? null;
        (session.user as { sv?: number }).sv = (token.sv as number | undefined) ?? 1;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
