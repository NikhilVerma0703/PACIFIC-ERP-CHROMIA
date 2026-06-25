import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe middleware (Prisma-free config). IMPORTANT: with the auth(fn)
// wrapper form, Auth.js does NOT auto-redirect — ALL gating is explicit here.
const { auth } = NextAuth(authConfig);

const CANONICAL_HOST = "erp.pacific-surfaces.com";
const STATIC_FILE = /\.(png|jpg|jpeg|svg|webp|ico|webmanifest|txt|xml)$/;

export default auth((req) => {
  const { nextUrl } = req;

  // 1) canonical domain: every *.vercel.app URL -> the ERP subdomain
  const host = req.headers.get("host") ?? "";
  if (host.endsWith(".vercel.app")) {
    const url = nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return Response.redirect(url, 308);
  }

  // 2) public paths: login, auth endpoints, cron sync (has its own secret), static assets
  const p = nextUrl.pathname;
  const isPublic =
    p === "/login" ||
    p.startsWith("/api/auth") ||
    p.startsWith("/api/sync") ||
    p.startsWith("/api/fab/slabs") ||
    STATIC_FILE.test(p);
  if (isPublic) return;

  // 3) everything else requires a session
  if (!req.auth?.user) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("callbackUrl", nextUrl.href);
    return Response.redirect(login);
  }

  // 4) capped roles
  const role = (req.auth.user as { role?: string }).role;

  // Fabrication module routing — return early so fab users bypass OPERATOR/STORE checks
  const fabRole = (req.auth?.user as any)?.fabRole;
  if (fabRole) {
    const isFabApi = p.startsWith("/api/fab") || p.startsWith("/api/auth");
    if (isFabApi) return;

    // FAB_ADMIN: full access — treated like regular ADMIN (can use main ERP + fab)
    if (fabRole === "FAB_ADMIN") return;

    if (fabRole === "FAB_EMPLOYEE") {
      const machineType = req.cookies.get("fab_machine_type")?.value;
      const MACHINE_URLS: Record<string, string> = {
        CUTTING:      "/fab/cutting",
        POLISHING:    "/fab/polishing",
        SINK_CUTTING: "/fab/sink-cutting",
        FABRICATION:  "/fab/fabrication",
        PACKAGING:    "/fab/packaging",
      };
      if (!machineType) {
        if (p !== "/fab/session") return Response.redirect(new URL("/fab/session", nextUrl));
        return;
      }
      const allowedUrl = MACHINE_URLS[machineType];
      const ok = p === allowedUrl || p === "/fab/session";
      if (!ok) return Response.redirect(new URL(allowedUrl ?? "/fab/session", nextUrl));
      return;
    }

    // FAB_MANAGER / FAB_SUPERVISOR: allow /fab/* and the main-app /cutting (Samples)
    const fabHome = fabRole === "FAB_MANAGER" ? "/fab/projects" : "/fab/supervisor";
    const ok = p.startsWith("/fab") || p === "/cutting" || p.startsWith("/api") || STATIC_FILE.test(p);
    if (!ok) return Response.redirect(new URL(fabHome, nextUrl));
    return;
  }
  if (role === "STORE") {
    const ok = p === "/live" || p.startsWith("/store") || p.startsWith("/api");
    if (!ok) return Response.redirect(new URL("/live", nextUrl));
  }
  if (role === "OPERATOR") {
    // operators only use their station's entry forms — nothing else
    const ok = p.startsWith("/entry") || p === "/live" || p.startsWith("/tables") || p.startsWith("/api");
    if (!ok) return Response.redirect(new URL("/entry", nextUrl));
  }
});

export const config = {
  // known-good matcher (path-to-regexp): skip Next internals only;
  // static files are excluded by code above (more reliable than matcher regex)
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
