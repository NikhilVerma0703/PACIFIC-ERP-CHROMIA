import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

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
      // one branch value later. Goes when scripts/0045-migrate-chromia-branch-users.sql
      // has moved the last of them onto role CHROMIA.
      if (branch === "CHROMIA") return true;

      const role = (auth?.user as { role?: string } | undefined)?.role;
      if (role === "STORE") {
        const p = nextUrl.pathname;
        const ok = p === "/live" || p.startsWith("/store") || p.startsWith("/api");
        if (!ok) return Response.redirect(new URL("/live", nextUrl));
      }
      if (role === "OPERATOR") {
        const p = nextUrl.pathname;
        const ok = p.startsWith("/entry") || p === "/live" || p.startsWith("/tables") || p.startsWith("/api");
        if (!ok) return Response.redirect(new URL("/entry", nextUrl));
      }
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
