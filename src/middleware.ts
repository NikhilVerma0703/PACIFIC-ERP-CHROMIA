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

  // 2) public paths: login, auth endpoints, cron endpoints (each has its own secret), static assets
  const p = nextUrl.pathname;
  const isPublic =
    p === "/login" ||
    p.startsWith("/api/auth") ||
    p.startsWith("/api/telegram/report") ||   // cron-only: gated by CRON_SECRET inside
    p.startsWith("/api/telegram/webhook") ||  // Telegram-only: gated by webhook secret inside
    p.startsWith("/api/sales/cron") ||        // cron-only: gated by CRON_SECRET inside
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

  // ---- Department separation by branch. Admins (role ADMIN) span every dept. ----
  const branch = (req.auth.user as { branch?: string }).branch;
  const isAdmin = role === "ADMIN";
  const fabPath = p.startsWith("/fab") || p === "/cutting";

  // ---- Robo module: only the dedicated shop-floor ROBO role (and admins, who
  // span every dept) may use the robo forms and APIs. This must run BEFORE the
  // branch blocks below — their generic `/api` allowances would otherwise let
  // other departments reach Robo data. The ROBO role itself is capped to this
  // module further down. ----
  if (p.startsWith("/robo") || p.startsWith("/api/robo")) {
    if (!isAdmin && role !== "ROBO") {
      return p.startsWith("/api")
        ? new Response("Forbidden", { status: 403 })
        : Response.redirect(new URL("/", nextUrl));
    }
  }

  // ---- Shift scoreboard: ADMIN only. It ranks named individuals and drives an
  // incentive payout, so it must not be visible to the people it scores. ----
  if (p.startsWith("/scoreboard")) {
    if (!isAdmin) return Response.redirect(new URL("/", nextUrl));
  }

  // ---- Bill automation (finance engine): Office Finance/Accounts and admins
  // only. Runs before the branch blocks below for the same reason as the robo
  // gate — their generic `/api` allowances must not leak it, and Commercial's
  // `/office` allowance must not include it. ----
  if (p.startsWith("/office/finance") || p.startsWith("/api/office/finance")) {
    const finOk = isAdmin || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS"));
    if (!finOk) {
      return p.startsWith("/api")
        ? new Response("Forbidden", { status: 403 })
        : Response.redirect(new URL("/", nextUrl));
    }
  }

  // ---- Batch costing: ADMIN only. It prices the plant's whole cost base -
  // manpower, electricity, supplier rates - which is exactly the information
  // a rate negotiation or a payroll grievance would love to have. Same
  // ordering rule as finance: before the branch blocks, so Commercial's
  // `/office` allowance cannot leak it. ----
  if (p.startsWith("/office/costing") || p.startsWith("/api/office/costing")) {
    if (!isAdmin) {
      return p.startsWith("/api")
        ? new Response("Forbidden", { status: 403 })
        : Response.redirect(new URL("/", nextUrl));
    }
  }

  if (!isAdmin && branch === "FABRICATION") {
    // Fabrication staff: fab pages + Overview + API only — never production pages.
    if (p.startsWith("/api")) return;
    if (role === "OPERATOR") {
      // fab EMPLOYEE — ONE operator login works every machine and every project.
      //
      // This used to read the fab_machine_type cookie and allow exactly one queue
      // URL: no cookie meant a forced trip to /fab/session, and the machine picked
      // there became the only page reachable until the operator went back and
      // switched. With a single operator covering the whole line that is a lock
      // with nothing on the other side of it, so all five station queues are open.
      // A machine session is still available at /fab/session — it is what stamps
      // machineId onto the work — but it is no longer a gate.
      //
      // Planning screens (/fab/projects, /fab/supervisor, /fab/ceo) stay closed:
      // this list is opt-IN, so a fab page added later is not reachable by default.
      const QUEUE_PAGES = [
        "/fab/cutting", "/fab/polishing", "/fab/sink-cutting",
        "/fab/fabrication", "/fab/packaging",
      ];
      const ok = QUEUE_PAGES.includes(p) || p === "/fab/session";
      if (!ok) return Response.redirect(new URL("/fab/cutting", nextUrl));
      return;
    }
    // fab MANAGER (LINE_MANAGER) / SUPERVISOR (INCHARGE): any fab page + Overview
    const fabHome = role === "LINE_MANAGER" ? "/fab/projects" : "/fab/supervisor";
    const ok = fabPath || p === "/" || STATIC_FILE.test(p);
    if (!ok) return Response.redirect(new URL(fabHome, nextUrl));
    return;
  }
  if (!isAdmin && fabPath) {
    // Production / Office staff never see fabrication.
    return Response.redirect(new URL("/", nextUrl));
  }
  if (!isAdmin && branch === "INTERNATIONAL_SALES") {
    // International Sales staff: sales pages + API only — never production/office pages.
    if (p.startsWith("/api")) return;
    const ok = p.startsWith("/sales") || p.startsWith("/admin/users") || STATIC_FILE.test(p); // Users&Roles reachable; its own gate keeps it SALES_ADMIN-only
    if (!ok) return Response.redirect(new URL("/sales", nextUrl));
    return;
  }
  if (!isAdmin && p.startsWith("/sales")) {
    // Staff from every other department never see International Sales.
    return Response.redirect(new URL("/", nextUrl));
  }
  // Admins who signed in via the International Sales card land on the SALES
  // dashboard — their nav is sales-focused; "/" is the production overview.
  if (isAdmin && branch === "INTERNATIONAL_SALES" && p === "/") {
    return Response.redirect(new URL("/sales", nextUrl));
  }
  if (!isAdmin && branch !== "OFFICE" && p.startsWith("/inventory")) {
    // Finished-goods inventory is an Office (Commercial) module — shop floor never sees it.
    return Response.redirect(new URL("/", nextUrl));
  }

  if (role === "STORE") {
    // /tables is allowed but capped to RM tables (canSeeModel -> STORE_MODELS).
    const ok = p === "/live" || p.startsWith("/store") || p.startsWith("/tables") || p.startsWith("/consumables") || p.startsWith("/api");
    if (!ok) return Response.redirect(new URL("/live", nextUrl));
  }
  if (role === "OPERATOR") {
    // operators only use their station's entry forms — nothing else
    const ok = p.startsWith("/entry") || p === "/live" || p.startsWith("/tables") || p.startsWith("/api");
    if (!ok) return Response.redirect(new URL("/entry", nextUrl));
  }
  if (role === "COMMERCIAL") {
    // Commercial: finished-goods slabs, plus READ-ONLY production lookups from the
    // Office branch's Shop Floor tab (slab, and the Office-side batch view). Live
    // Status, Tables and the Production Report stay blocked — /report is gated here,
    // not merely unlinked from the Shop Floor card grid.
    //
    // The /batch subtree is blocked for the same reason and by the same rule.
    // /batch renders MixerSection (silo numbers, bag and invoice numbers, suppliers,
    // grades, per-cycle grit/filler/resin kg) and /batch/slabs renders
    // StationParamLog (every machine setting per station plus the mid-batch change
    // timeline) and MixerCycleFlags. None of that was ever gated on role, because
    // the pages grew that detail after the route was granted. Gating it
    // block-by-block would be opt-OUT — the next block added leaks until someone
    // remembers — so Commercial gets /office/batch-lookup instead, which projects an
    // explicit allowlist and is already covered by under("/office").
    //
    // Middleware is NOT the boundary for what IS granted: server actions POST to
    // those same routes, so the actions gate themselves on canRectify()
    // (rank >= INCHARGE), which COMMERCIAL (rank 1) fails. One exception worth
    // knowing: pendingRmAllocation (rmHealActions.ts) carries no gate and returns a
    // count to any signed-in caller — blocking the route is what keeps it away from
    // Commercial, so do not treat the action gates as complete on their own.
    // under() is exact-or-subpath so a future /reports or /batches cannot be opened
    // by accident; note the /api clause above is a bare prefix and is not.
    const under = (base: string) => p === base || p.startsWith(base + "/");
    const ok = p.startsWith("/api") || under("/inventory")
      || under("/office") || under("/slab");
    if (!ok) return Response.redirect(new URL("/inventory", nextUrl));
  }
  if (role === "SALES") {
    // Sales: the finished-goods stock summary only.
    const ok = p.startsWith("/inventory") || p.startsWith("/api");
    if (!ok) return Response.redirect(new URL("/inventory", nextUrl));
  }
  if (role === "MAINTENANCE") {
    // maintenance manager: Overview, the Downtime report and the Maintenance Log
    // (may also POST the downtime response and the delay reclassification, both
    // server actions on /mis).
    //
    // /maintenance was missing from this list, so the one page written FOR this
    // role was the one page it could not open — the Nav entry existed and the
    // page's own gates (canRaiseMaintenance, canRespondDowntime) both admit
    // MAINTENANCE, but middleware redirected to "/" before either could run.
    // That is why the role appeared to have no maintenance log at all.
    //
    // under() is exact-or-subpath, borrowed from the Commercial block above:
    // a bare startsWith("/maintenance") would also hand this capped role
    // a future /maintenance-costs or /maintenance-admin, which is opt-OUT
    // security — the safer form costs one helper.
    const under = (base: string) => p === base || p.startsWith(base + "/");
    const ok = p === "/" || under("/mis") || under("/maintenance") || p.startsWith("/api");
    if (!ok) return Response.redirect(new URL("/", nextUrl));
  }
  if (role === "ROBO") {
    // Robo line operator: the robo entry form and ITS APIs — nothing else.
    //
    // The second clause used to read `p.startsWith("/api")`, which said
    // "nothing else" and meant the opposite: it handed a shop-floor tablet
    // every API in the ERP — /api/sales, /api/admin, /api/office and the rest.
    // The gate further up only stops OTHER roles reaching /api/robo; nothing
    // confined ROBO to it. Narrowed to /api/robo, which is the whole surface
    // the robo pages actually call (verified: no shared component or robo page
    // fetches a non-robo endpoint). /api/auth is unaffected — it returns as
    // public long before this block.
    //
    // This matters directly to the slab DELETE: a capped role is the layer
    // that contains a mis-scoped destructive endpoint, and it can only do that
    // if the cap is real.
    const ok = p.startsWith("/robo") || p.startsWith("/api/robo");
    if (!ok) {
      // 403 rather than a redirect for API paths: a fetch that follows a 302
      // to an HTML page fails as a confusing parse error instead of a refusal.
      return p.startsWith("/api")
        ? new Response("Forbidden", { status: 403 })
        : Response.redirect(new URL("/robo", nextUrl));
    }
  }
});

export const config = {
  // known-good matcher (path-to-regexp): skip Next internals only;
  // static files are excluded by code above (more reliable than matcher regex)
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
