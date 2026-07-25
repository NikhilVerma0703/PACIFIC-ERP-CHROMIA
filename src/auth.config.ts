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
