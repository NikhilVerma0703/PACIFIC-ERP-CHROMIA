import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { storeMayVisit, operatorMayVisit, maintenanceMayVisit, samplingMayVisit, fgViewMayVisit, homeFor, isPublicAsset, isCronRoute } from "./lib/routeCaps.ts";
import { isCommercialRole } from "./lib/roles.ts";
// The sampling module's audience, imported rather than restated here. It is a
// pure module (its only import is lib/roles.ts, which imports nothing), so it
// is edge-safe — and it has to be imported rather than copied because the same
// rule decides what the ROUTE does with the request: this file may only say yes
// or no to a path, and "the fabrication supervisor may add stock but may not
// view the inventory" is not a statement about a path.
import { maySeeSamplingModule } from "./lib/sampling/actions.ts";
// The active role context — which of the (at most two) role+branch pairs an
// admin granted this login is the one the request is running as. Pure and
// import-free like routeCaps, because this file and auth.config.ts are edge
// code; see the safety note at block 4 below.
import { ROLE_CONTEXT_COOKIE, activeContextOf, type GrantedContexts } from "./lib/roleContext.ts";
// The slab-intake audience, imported rather than restated for the same reason
// as maySeeSamplingModule above: pure and import-free, so it is edge-safe, and
// the SAME rule the page gate runs — the carve-out below and the gate cannot
// drift apart.
import { canUseSlabIntake } from "./lib/inventory/intakeAccess.ts";
// The Commercial module's audience — pure and import-free like the two above,
// so it is edge-safe, and the SAME rule the route gate runs (lib/commercial/
// access.ts imports it). This block is what keeps the uncapped office roles
// (FINANCE, ACCOUNTS) and the shop-floor INCHARGE/LINE_MANAGER out of
// /office/commercial: middleware caps work by exception, and without an
// explicit block a path nobody named is a path everybody reaches.
import { maySeeCommercialModule } from "./lib/commercial/access-rules.ts";
// The finished-goods VIEW GRANT (users.fg_view) — pure and import-free like the
// four above, so it is edge-safe, and the SAME function the route gates read
// (lib/inventory/access.ts imports and re-exports it). Imported rather than
// written out here as `user.fgView === true`, because a door and a gate that
// each decide for themselves what the flag means are two rules, and two rules
// drift. WHERE the grant reaches is the other half of the question and lives
// with the other caps, in lib/routeCaps.ts.
import { hasFgView } from "./lib/inventory/accessRules.ts";

// Edge-safe middleware (Prisma-free config). IMPORTANT: with the auth(fn)
// wrapper form, Auth.js does NOT auto-redirect — ALL gating is explicit here.
const { auth } = NextAuth(authConfig);

const CANONICAL_HOST = "erp.pacific-surfaces.com";
// What is served without a session lives in lib/routeCaps (isPublicAsset), an
// exact allowlist of the files in public/. The extension regex that used to
// sit here said "anything ending in .png" and thereby let /api/robo/x.png or
// /tables/Press.png past both gates; see the note on isPublicAsset.

/**
 * Refuse a page, and SAY SO.
 *
 * Every cap used to bounce silently to a home page. That is the worst answer to
 * a click: the page does not appear, no reason is given, and the address bar
 * quietly says something else - which reads as a broken link, so people click
 * again and then ask whether the ERP is down. /no-access names the path that
 * was refused and offers a way back.
 *
 * API paths keep answering 403. A fetch that follows a 302 to an HTML page gets
 * a parse error instead of a status - the failure that hid a dropped table for
 * half a day earlier this week.
 */
function denied(p: string, nextUrl: URL, role: string, branch: string): Response {
  if (p.startsWith("/api")) return new Response("Forbidden", { status: 403 });

  // "/" IS NOT A DENIAL - it is where sign-in sends everybody.
  //
  // src/app/login/actions.ts starts every login at "/" and only overrides it
  // for two cases, so a capped role whose allowlist excludes "/" reaches this
  // function on the FIRST page after signing in. Answering that with the
  // refusal page means a store incharge, an operator, a Chromia tablet or a
  // sales login signs in and lands on "You do not have access to that page" -
  // a lockout, from a change whose whole purpose was to stop silent bouncing.
  //
  // Asking for "/" is not a deliberate navigation to a forbidden page; it is
  // the default. So it keeps the old behaviour and routes to the role home.
  // The admin-on-International-Sales rule further down was always written this
  // way for the same reason.
  if (p === "/") return Response.redirect(new URL(homeFor(role, branch), nextUrl));

  const url = new URL("/no-access", nextUrl);
  url.searchParams.set("from", p);
  return Response.redirect(url);
}

export default auth((req) => {
  const { nextUrl } = req;
  const p = nextUrl.pathname;

  // 0) THE SCHEDULER'S OWN ROUTES, ahead of EVERYTHING below - including the
  //    canonical-host redirect, which is why this block is here and not in the
  //    public-paths list where it started.
  //
  //    Vercel triggers a cron against the project's *.vercel.app production
  //    URL, not against the custom domain. Step 1 saw that host and answered
  //    308 Permanent Redirect; a cron invocation does not follow redirects, so
  //    the job ended there, at the edge, having executed nothing. Measured on
  //    production: "GET /api/telegram/report 308 [edge-middleware]" at 08:40,
  //    15:40, 16:40, 17:40, 18:40 and 19:41 UTC, hour after hour, with no
  //    serverless line behind any of them. The hourly Telegram report had been
  //    dead since the schedule moved here from GitHub Actions.
  //
  //    IT CANNOT BE CAUGHT BY HAND, which is why it lasted. Every manual test
  //    goes to erp.pacific-surfaces.com, which does not end in .vercel.app and
  //    so never enters the branch below: curl says 401, the route is reached,
  //    everything looks correct, and the scheduler is taking a different path
  //    through this function than the tester is. Verify a cron by reading the
  //    runtime log at the scheduled minute, never by curling the domain.
  //
  //    Nothing is opened. Each of these refuses a request that does not carry
  //    its own secret; skipping the redirect only lets it be asked.
  if (isCronRoute(p)) return;

  // 1) canonical domain: every *.vercel.app URL -> the ERP subdomain
  const host = req.headers.get("host") ?? "";
  if (host.endsWith(".vercel.app")) {
    const url = nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return Response.redirect(url, 308);
  }

  // 2) public paths: login, auth endpoints, static assets. The cron routes are
  //    NOT here - they are handled at 0, above the redirect.
  const isPublic =
    p === "/login" ||
    // The refusal page itself. It sits here, above every cap: a cap that
    // redirected to a page its own rule then refused would loop the browser.
    p === "/no-access" ||
    p.startsWith("/api/auth") ||
    isPublicAsset(p);
  if (isPublic) return;

  // 3) everything else requires a session
  if (!req.auth?.user) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("callbackUrl", nextUrl.href);
    return Response.redirect(login);
  }

  // 4) capped roles
  //
  // ---- THE ACTIVE ROLE CONTEXT ---------------------------------------------
  // One person can hold two jobs (Line Manager on the line, Fabrication
  // Supervisor next door). Both granted pairs ride in the JWT
  // (role/branch and altRole/altBranch); a cookie says which is live. Every
  // block below still reads exactly two locals, `role` and `branch` — they are
  // now the ACTIVE pair rather than the issued one, and nothing else in this
  // file changes.
  //
  // activeContextOf() is the same pure function auth.config.ts's authorized()
  // callback and lib/rbac.ts's currentUser() call, given the same JWT and the
  // same cookie. All three therefore give the same answer by construction: a
  // gate that disagreed with currentUser() about who somebody is would be the
  // failure lib/routeCaps.ts exists to end, one layer up.
  //
  // THE COOKIE CANNOT WIDEN ANYTHING. It is compared, as a string, against keys
  // computed from the two pairs the ADMIN granted; the pair returned is built
  // from the JWT's own values. A forged selector, one left from a session whose
  // second job has since been revoked, or any cookie at all on a login with no
  // alternate, matches nothing and falls back to the primary — the pair that
  // login held before the switcher existed. Nothing is read OUT of the cookie.
  const activeUser = activeContextOf(req.auth.user as GrantedContexts, req.cookies.get(ROLE_CONTEXT_COOKIE)?.value);
  const role = (activeUser as { role?: string }).role;

  // ---- Department separation by branch. Admins (role ADMIN) span every dept. ----
  const branch = (activeUser as { branch?: string }).branch;
  const isAdmin = role === "ADMIN";
  const fabPath = p.startsWith("/fab") || p === "/cutting";

  // ---- Robo module: only the dedicated shop-floor ROBO role (and admins, who
  // span every dept) may use the robo forms and APIs. This must run BEFORE the
  // branch blocks below — their generic `/api` allowances would otherwise let
  // other departments reach Robo data. The ROBO role itself is capped to this
  // module further down. ----
  if (p.startsWith("/robo") || p.startsWith("/api/robo")) {
    if (!isAdmin && role !== "ROBO") {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Chromia module: the same shape as the robo gate directly above, for
  // the same reasons. Only the dedicated shop-floor CHROMIA role (and admins,
  // who span every dept) may use the Chromia screens and APIs, and this must
  // run BEFORE the branch blocks below — their generic `/api` allowances would
  // otherwise let other departments reach Chromia data. The CHROMIA role itself
  // is capped to this module further down. Tier differences inside the module
  // are NOT decided here: middleware only knows the path prefix, so the layout
  // and every /api/chromia route gate themselves with chromiaGate()
  // (lib/chromia/access.ts).
  //
  // `branch === "CHROMIA"` is a transitional allowance for logins created by
  // the retired department-style integration, so they keep working until
  // scripts/0046-migrate-chromia-branch-users.sql moves them to the role. The
  // cap below contains them meanwhile. Remove both clauses after that runs. ----
  if (p.startsWith("/chromia") || p.startsWith("/api/chromia")) {
    if (!isAdmin && role !== "CHROMIA" && branch !== "CHROMIA") {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Sampling module: the same shape as the robo and chromia gates above,
  // and here for the same ordering reason — it must run BEFORE the branch
  // blocks below, whose generic `/api` allowances would otherwise hand every
  // department the sample inventory and the dispatch board.
  //
  // ITS AUDIENCE IS NOT THE SAME, and that is the one line worth reading. Robo
  // and Chromia admit their own role and admins, full stop. Sampling also
  // admits the FABRICATION SUPERVISOR, because a usable offcut from a
  // cut-to-size job becomes sample stock the moment it comes off the saw and he
  // is the man who knows it exists. He may ADD STOCK AND NOTHING ELSE — not the
  // inventory, not a dispatch. (He reaches the API only: the /sampling PAGES
  // are refused to him a few blocks down by his own FABRICATION branch cap,
  // which is the correct answer — the screens are not his.)
  //
  // So this is the COARSE gate, the same split this file already makes on
  // /office/batch-verify: matching a path prefix cannot tell an intake POST
  // from an inventory GET, so it cannot say "add but not view". WHICH action a
  // caller may perform is decided in the route itself by samplingGate(action)
  // (lib/sampling/access.ts). Both call lib/sampling/actions.ts, so the door
  // and the route cannot drift apart — the failure lib/routeCaps.ts exists to
  // end, one module later.
  //
  // Role SAMPLING itself is capped to this module further down, with ROBO. It
  // is a ROLE, not a branch: no Branch value was added for it, and none should
  // be — Chromia's retirement as a department is why.
  if (p.startsWith("/sampling") || p.startsWith("/api/sampling")) {
    if (!maySeeSamplingModule({ role, branch })) {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Shift scoreboard: ADMIN only. It ranks named individuals and drives an
  // incentive payout, so it must not be visible to the people it scores. ----
  if (p.startsWith("/scoreboard")) {
    if (!isAdmin) return denied(p, nextUrl, role ?? "", branch ?? "");
  }

  // ---- Maintenance log: the Maintenance Manager, Line Manager and admins. ----
  //
  // An EXPLICIT gate, because the per-role caps further down work by exception:
  // a role with no cap of its own falls through and reaches everything, which is
  // how INCHARGE — and FINANCE/ACCOUNTS, who share its rank — were reading this
  // page. The owner's rule is "manager and above, not incharge", so it has to be
  // stated here rather than left to the absence of a rule.
  //
  // MAINTENANCE is named separately because the capped role sits at rank 1, below
  // every rank test: it is the page's whole audience and would otherwise be the
  // one role excluded by a rank comparison.
  //
  // Nothing is hidden by this that its audience cannot otherwise see — the same
  // downtime incidents are on /mis, which INCHARGE still reaches. What goes away
  // is the INBOX: the queue exists to tell maintenance what is theirs to answer,
  // and everyone who can see it treats it as their own list.
  if (p.startsWith("/maintenance")) {
    const ok = isAdmin || role === "MAINTENANCE" || role === "LINE_MANAGER";
    if (!ok) return denied(p, nextUrl, role ?? "", branch ?? "");
  }

  // ---- Bill automation (finance engine): Office Finance/Accounts and admins
  // only. Runs before the branch blocks below for the same reason as the robo
  // gate — their generic `/api` allowances must not leak it, and Commercial's
  // `/office` allowance must not include it. ----
  if (p.startsWith("/office/finance") || p.startsWith("/api/office/finance")) {
    const finOk = isAdmin || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS"));
    if (!finOk) {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Commercial module: enquiries, internal sales orders, stock holds,
  // production requests, proforma invoices, packing lists, the dispatch check,
  // invoices and delivery challans. Role.COMMERCIAL, Role.COMMERCIAL_MANAGER and
  // admins reach all of it;
  // the dispatch team (STORE / LINE_MANAGER until it has a role of its own)
  // reaches ONLY the dispatch-check paths, exact-or-subpath. Before the branch
  // blocks for the same reason as the finance block: Commercial's own `/office`
  // allowance would otherwise be the only thing deciding, and it says nothing
  // about FINANCE, ACCOUNTS, INCHARGE or LINE_MANAGER, who are uncapped and
  // would fall straight through. This is the coarse gate; WHICH ACTION a
  // request is allowed is decided in the route by commercialGate(action). ----
  if (p.startsWith("/office/commercial") || p.startsWith("/api/office/commercial")) {
    if (!maySeeCommercialModule({ role, branch }, p)) {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Per-batch material rates: the ONE costing-admin surface the two batch
  // verifiers reach (owner, 2026-08-19). They enter the supplier splits, the
  // prices and the doses for a batch themselves now — on their own page,
  // /office/batch-verify, which renders the same materials panel the admin has
  // — so the API that panel talks to must admit them. Carved out HERE because
  // the path sits under the /api/office/costing prefix the next block closes
  // to ADMIN, and the carve-out is the API path ONLY: the /office/costing PAGE
  // — the computed sheet, manpower, electricity, the whole cost base — stays
  // admin-only below.
  //
  // Same coarse set as batch-verify (ADMIN | STORE | LINE_MANAGER), because
  // the verifiers are the same two people: the store incharge by role, the
  // named production verifier by email. The email check needs the session and
  // an env var, so it lives in the route (isBatchVerifier); this gate only
  // keeps the door shut to everyone who could never qualify. ----
  const batchRatesApi = p.startsWith("/api/office/costing-admin/batch-rates");
  if (batchRatesApi) {
    const ok = isAdmin || role === "STORE" || role === "LINE_MANAGER";
    if (!ok) return new Response("Forbidden", { status: 403 });
  }

  // ---- Batch costing: ADMIN only. It prices the plant's whole cost base -
  // manpower, electricity, supplier rates - which is exactly the information
  // a rate negotiation or a payroll grievance would love to have. Same
  // ordering rule as finance: before the branch blocks, so Commercial's
  // `/office` allowance cannot leak it. ----
  if (!batchRatesApi && (p.startsWith("/office/costing") || p.startsWith("/api/office/costing"))) {
    if (!isAdmin) {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Batch verification: the two sign-offs either side of the costing
  // sheet. A named production manager confirms the weights the mixer recorded;
  // the store incharge confirms the prices they are costed at. Deliberately a
  // SEPARATE path from /office/costing above, which stays admin-only: widening
  // that gate to admit two more roles would put the whole cost base - manpower,
  // electricity, supplier rates, the computed sheet - behind a door that was
  // opened to let somebody check a resin weight.
  //
  // This is the coarse gate. WHICH HALF a caller sees is decided in the route
  // itself from the session, because a middleware that can only say yes or no
  // to a path cannot say "weights but not prices". ----
  if (p.startsWith("/office/batch-verify") || p.startsWith("/api/office/batch-verify")) {
    const verifyOk = isAdmin || role === "STORE" || role === "LINE_MANAGER";
    if (!verifyOk) {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }

  // ---- Slab intake: the three named intake people (SLAB_INTAKE_EMAILS) and
  // admins. AN ADMISSION, NOT A REFUSAL — and it must sit ABOVE the branch
  // caps directly below, which is the whole reason it exists here at all: two
  // of the three sign in on capped branches (the Chromia manager's login is
  // capped to /chromia, the fabrication manager's to /fab), so without this
  // early `return` their own caps would bounce them off the one screen that
  // was built for them before its gate ever ran. The token carries email and
  // role; the rule is the same pure function the page gate runs, on the same
  // env var. Everyone ELSE falls through unchanged to the existing rules —
  // whoever those admit reaches the page, and the page's own slabIntakeGate()
  // refuses them there (a UI condition is not an authorisation; nor is a
  // path rule). Server actions POST to the page's own path, so admitting the
  // path admits the form's saves too — no /api carve-out to keep in step.
  if (p === "/slab-intake" || p.startsWith("/slab-intake/")) {
    const email = (req.auth.user as { email?: string | null }).email;
    if (canUseSlabIntake(role, email, process.env.SLAB_INTAKE_EMAILS)) return;
  }

  // ---- Finished goods, for a login carrying the VIEW GRANT. ANOTHER
  // ADMISSION, NOT A REFUSAL, and it sits here for precisely the reason the
  // slab-intake carve-out directly above does: it has to run BEFORE the branch
  // caps, because the two people it was granted to sign in on capped branches.
  //
  // The owner, 2026-09-14: "Please add finished good's visibility for
  // chromia@thepacific.group, gibin@thepacific.group (full visibility but no
  // edit options)". Both are LINE_MANAGER off the OFFICE branch — chromia@ on
  // CHROMIA, gibin@ on FABRICATION — and THREE separate rules below refuse them
  // the module today: the CHROMIA block's narrow allowlist (the Chromia screens
  // and their APIs, then a terminal `return`), the FABRICATION block, which
  // passes /api straight through but names no page outside /fab, and the
  // `branch !== "OFFICE" && /inventory` refusal further down. One admission
  // above all three answers all three at once. Widening any of them in place
  // would have been the wrong shape of answer — it would hand a whole branch,
  // and everybody put on it afterwards, something that was granted to one
  // login; and the CHROMIA allowlist in particular is narrow on purpose.
  //
  // TWO PREFIXES AND ONE ENDPOINT, AND NOTHING ELSE. fgViewMayVisit
  // (lib/routeCaps) names them: /inventory and /api/inventory exact-or-subpath,
  // plus the exact path /api/photo, which is where the slab detail panel loads
  // a slab's far/near shots from and is the one URL in that panel that does not
  // live under /api/inventory. auth.config.ts's authorized() admits the same
  // three from the same function, which matters more than it looks: that
  // callback runs FIRST and a Response it returns replaces this whole file, so
  // a viewer admitted only here could still be bounced by the gate standing in
  // front of it.
  //
  // AND PASSING THIS DOOR GRANTS NOTHING BEYOND IT. Middleware matches a path;
  // it cannot tell a slab lookup from a slab edit, because both are POSTs under
  // /api/inventory, and it cannot tell a slab photo from a downtime photo,
  // because /api/photo carries an id and not a model. What a viewer may DO is
  // decided inside the route, by inventoryReadGate() (which admits the flag)
  // against inventoryGate() (which refuses it, and guards every write), and in
  // /api/photo by a check scoped to the model "FinishedSlab". The fence and the
  // gates cannot drift apart about who holds the grant: both ask hasFgView.
  if (hasFgView(activeUser) && fgViewMayVisit(p)) return;

  if (role === "CHROMIA" || (!isAdmin && branch === "CHROMIA")) {
    // Chromia line tablet: the Chromia screens and THEIR APIs — nothing else.
    // Deliberately the narrow allowlist form the ROBO cap at the foot of this
    // file documents, not the generic `p.startsWith("/api")` the branch blocks
    // use: the module carries its own dashboard, records, reports and import,
    // so there is nothing outside /chromia a Chromia login needs. /api/auth is
    // unaffected — it returns as public above.
    //
    // It sits HERE, with the branch caps and above them, for two reasons: the
    // terminal `return` makes the cap final (a block appended below must not
    // silently also apply to a tablet), and a CHROMIA-branch login of any role
    // must be capped before its own role cap redirects it somewhere this block
    // would only redirect it back from.
    //
    // The branch arm is TRANSITIONAL: it keeps a login left on the retired
    // CHROMIA department working inside the module until
    // scripts/0046-migrate-chromia-branch-users.sql moves it onto the role.
    // Remove it, the escape in auth.config.ts, the branch arm in Nav.tsx and
    // the one in lib/chromia/tier.ts together, once that has run.
    const ok = p.startsWith("/chromia") || p.startsWith("/api/chromia") || isPublicAsset(p);
    if (!ok) {
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
    return;
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
      //
      // ...AND THAT IS WHY /fab/supervisor/slabs IS NAMED HERE, as ONE EXACT
      // PATH and not as a "/fab/supervisor" prefix.
      //
      // The cutter does his own slab allocation now (the owner: "we have slab
      // allocation page made for supervisor, that need to be included to the
      // cutter as well"). Five gates were widened from SUPERVISOR to EMPLOYEE
      // for it — the board, slab-assignment, approve-slab, whoami — and both
      // the queue nav ("Pick a slab & cut") and the "Waiting for a slab" panel
      // on /fab/cutting were given links to the board. Nobody added the PAGE.
      // An opt-in list refuses what it does not name, so every one of those
      // buttons redirected the operator to /no-access and not one of the five
      // widened gates was reachable from the UI: the whole feature shipped to
      // production dead. A widened API gate is not access — the page has to be
      // opened here too, and the two must be changed together.
      //
      // EXACT, because the rest of /fab/supervisor is emphatically not his:
      // /fab/supervisor (the planning board), /fab/supervisor/people (names,
      // attendance) and /fab/supervisor/samples stay refused, and so does a
      // /fab/supervisor/slabs/<something> added later. `p` is a pathname with
      // no query string, so the panel's ?projectId=... link matches this entry.
      // The board itself knows an operator is at it (/api/fab/whoami) and
      // leaves out the step that is not his; that is a UI courtesy, and the
      // real refusal stays on /api/fab/supervisor/finished-edges.
      const QUEUE_PAGES = [
        "/fab/cutting", "/fab/polishing", "/fab/sink-cutting",
        "/fab/fabrication", "/fab/packaging", "/fab/downtime",
        "/fab/supervisor/slabs",
      ];
      const ok = QUEUE_PAGES.includes(p) || p === "/fab/session";
      if (!ok) return denied(p, nextUrl, role ?? "", branch ?? "");
      return;
    }
    // fab MANAGER (LINE_MANAGER) / SUPERVISOR (INCHARGE): any fab page + Overview.
    // Where each of them LANDS now lives in homeFor(), which denied() calls.
    const ok = fabPath || p === "/" || isPublicAsset(p);
    if (!ok) return denied(p, nextUrl, role ?? "", branch ?? "");
    return;
  }
  if (!isAdmin && fabPath) {
    // Production / Office staff never see fabrication.
    return denied(p, nextUrl, role ?? "", branch ?? "");
  }
  if (!isAdmin && branch === "INTERNATIONAL_SALES") {
    // International Sales staff: sales pages + API only — never production/office pages.
    if (p.startsWith("/api")) return;
    const ok = p.startsWith("/sales") || p.startsWith("/admin/users") || isPublicAsset(p); // Users&Roles reachable; its own gate keeps it SALES_ADMIN-only
    if (!ok) return denied(p, nextUrl, role ?? "", branch ?? "");
    return;
  }
  if (!isAdmin && p.startsWith("/sales")) {
    // Staff from every other department never see International Sales.
    return denied(p, nextUrl, role ?? "", branch ?? "");
  }
  // Admins who signed in via the International Sales card land on the SALES
  // dashboard — their nav is sales-focused; "/" is the production overview.
  if (isAdmin && branch === "INTERNATIONAL_SALES" && p === "/") {
    return Response.redirect(new URL("/sales", nextUrl));
  }
  if (!isAdmin && branch !== "OFFICE" && p.startsWith("/inventory")) {
    // Finished-goods inventory is an Office (Commercial) module — shop floor never sees it.
    return denied(p, nextUrl, role ?? "", branch ?? "");
  }

  // Both caps come from lib/routeCaps, which auth.config.ts imports too. They
  // were written out separately once and drifted: middleware granted the Store
  // Incharge /tables, /consumables and /office/batch-verify while auth.config
  // still allowed only /live, /store and /api — and auth.config runs first, so
  // the stricter, staler list silently won and three granted screens bounced.
  if (role === "STORE" && !storeMayVisit(p)) return denied(p, nextUrl, role ?? "", branch ?? "");
  if (role === "OPERATOR" && !operatorMayVisit(p)) return denied(p, nextUrl, role ?? "", branch ?? "");

  if (isCommercialRole(role)) {
    // Commercial (and its manager): finished-goods slabs, plus READ-ONLY production lookups from the
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
    // (rank >= INCHARGE), which COMMERCIAL (rank 1) fails. pendingRmAllocation
    // (rmHealActions.ts) was the one exception — it returned a count to any
    // signed-in caller and only this route block kept it from Commercial; it now
    // carries the same canRectify() gate as its siblings and answers 0 otherwise.
    // under() is exact-or-subpath so a future /reports or /batches cannot be opened
    // by accident; note the /api clause above is a bare prefix and is not.
    const under = (base: string) => p === base || p.startsWith(base + "/");
    const ok = p.startsWith("/api") || under("/inventory")
      || under("/office") || under("/slab");
    if (!ok) return denied(p, nextUrl, role ?? "", branch ?? "");
  }
  if (role === "SALES") {
    // Sales: the finished-goods stock summary only.
    const ok = p.startsWith("/inventory") || p.startsWith("/api");
    if (!ok) return denied(p, nextUrl, role ?? "", branch ?? "");
  }
  if (role === "MAINTENANCE") {
    // The cap itself lives in lib/routeCaps beside the Store and Operator ones,
    // so it can be unit-tested and cannot drift from a second copy - which is
    // the failure that file was created to end. See maintenanceMayVisit for what
    // is granted and, more importantly, what is deliberately not.
    if (!maintenanceMayVisit(p)) return denied(p, nextUrl, role ?? "", branch ?? "");
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
      return denied(p, nextUrl, role ?? "", branch ?? "");
    }
  }
  if (role === "SAMPLING") {
    // Sampling Incharge: the sampling module and ITS APIs — nothing else. The
    // narrow form the ROBO comment directly above argues for, written that way
    // from the start rather than after a tablet had been handed every API in
    // the ERP.
    //
    // A ROLE block, so it sits here rather than up with the Chromia one: a
    // branch that has its own block returns before this line is reached and
    // that login belongs to the branch. homeFor() mirrors the same ordering.
    //
    // The cap itself lives in lib/routeCaps beside the Store, Operator and
    // Maintenance ones, so it is unit-tested and cannot drift from a second
    // copy written out here — the failure that file was created to end.
    if (!samplingMayVisit(p)) return denied(p, nextUrl, role ?? "", branch ?? "");
  }
});

export const config = {
  // Skip Next internals AND the real static files in public/ - the SAME exact
  // list isPublicAsset (lib/routeCaps) treats as public, so excluding them here
  // changes no decision: it only stops paying an edge invocation to reach a
  // check that always answers "public". Production logs showed ~20,000 icon and
  // manifest requests in 48 hours, every one of them running this middleware
  // for nothing. The in-code isPublicAsset check STAYS, deliberately: if this
  // matcher ever misses a static path, the code still excludes it, so the two
  // can only fail safe.
  //
  // It used to exclude `.*\\.(?:png|jpg|...)$` - ANY path ending in a static
  // extension - and an excluded path runs neither this middleware nor the
  // authorized() callback. /api/robo/shifts/55.png, /tables/Press.png, /silo/5.png
  // therefore reached their handlers with no session at all; only the handlers'
  // own misses on "55.png" kept it inert. Each file is now named, anchored at
  // both ends (the `$` inside the lookahead, as before - the two _next prefixes
  // are the only open-ended ones), with its dot DOUBLE-ESCAPED (\\.) because
  // this is a JS string: a single \. collapses to a bare dot that matches any
  // character. A file added to public/ later goes here AND in PUBLIC_ASSET
  // (routeCaps.ts) - the test in tests/publicAssets.test.ts holds the two to the
  // same list. This is a string literal because Next reads it at build time; it
  // cannot call the function.
  matcher: ["/((?!_next/static|_next/image|(?:favicon\\.ico|apple-touch-icon\\.png|icon-[\\w-]+\\.png|logo-[\\w-]+\\.png|manifest\\.webmanifest)$).*)"],
};
