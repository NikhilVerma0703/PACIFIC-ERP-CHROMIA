"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const I = {
  overview:    "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  batch:       "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  tables:      "M4 5h16v14H4zM4 10h16M10 5v14",
  report:      "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  mis:         "M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5M12 16h.01",
  spanner:     "M14.7 6.3a4 4 0 01-5 5L4 17v3h3l5.7-5.7a4 4 0 015-5l2-2-2.6-2.6-2.4 1.6z",
  entry:       "M12 5v14M5 12h14",
  live:        "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  users:       "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  box:         "M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12",
  factory:     "M2 20h20M4 20V8l5 4V8l5 4V4l6 4v12",
  scissors:    "M6 3a3 3 0 110 6 3 3 0 010-6zm12 12a3 3 0 110 6 3 3 0 010-6zM5.2 5.2l13.6 13.6M18.8 5.2 9.4 14.6",
  samples:     "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  ceo:         "M18 20V10M12 20V4M6 20v-6",
  planning:    "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  manager:     "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8z",
  polishing:   "M12 2a10 10 0 100 20 10 10 0 000-20z",
  sink:        "M5 9V5h14v4M2 9h20v2a5 5 0 01-5 5H7a5 5 0 01-5-5V9z",
  fabrication: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",
  packaging:   "M21 16V8l-9-5-9 5v8l9 5 9-5z",
};

const SHOP_PATHS = ["/", "/live", "/batch", "/slab", "/tables", "/report", "/office", "/silo", "/resin", "/store"];
const FAB_PATHS  = ["/fab/", "/cutting"];

const STORE_TABS = [
  { href: "/live",         label: "Live Status",  icon: I.live   },
  { href: "/store/bag",    label: "Add Bag",       icon: I.entry  },
  { href: "/store/entry",  label: "RM Entry",      icon: I.entry  },
  { href: "/store/resin",  label: "Resin Intake",  icon: I.live   },
  { href: "/store/upload", label: "RM Upload",     icon: I.box    },
  { href: "/store/assign", label: "RM Assignment", icon: I.tables },
  { href: "/tables",       label: "RM Tables",     icon: I.tables },
  { href: "/consumables",  label: "Consumables",   icon: I.box    },
];

// Maintenance Manager. This list is the WHOLE nav for the role — the branch
// below returns early, so the "Lookups & Reports" section (which carries the
// Maintenance Log for everyone else) is never reached. That is why entries have
// to be repeated here: the role that lives in the maintenance log was once the
// only role with no link to it.
//
// EVERY href here must also be allowed by the MAINTENANCE cap in middleware.ts
// AND by that page own gate. A nav row the middleware refuses is now a visible
// trip to /no-access rather than a silent bounce, which is better but still a
// promise the app did not keep.
//
// "exact" on /maintenance: /maintenance/uptime is a nav row of its own, and the
// default prefix rule would light both at once.
const MAINTENANCE_TABS = [
  { href: "/",                   label: "Overview",        icon: I.overview },
  { href: "/mis",                label: "Downtime",        icon: I.mis      },
  { href: "/maintenance",        label: "Maintenance Log", icon: I.spanner, exact: true },
  { href: "/maintenance/uptime", label: "Uptime by Trade", icon: I.live     },
  { href: "/report/ceo",         label: "CEO Report",      icon: I.ceo      },
  { href: "/report",             label: "Production Report", icon: I.report, exact: true },
  { href: "/consumables",        label: "Consumables",     icon: I.box      },
];

/* helpers */
function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* L0 flat link */
function NavLink({ href, icon, label, path, office, exact }: {
  href: string; icon: string; label: string; path: string; office?: boolean;
  // exact: this link's sub-pages are nav items of their own, so the prefix
  // rule would light two rows at once (/report/ceo lit Production Report too).
  // Prefix matching stays the default because most sections WANT it — a
  // drill-down like /batch/slabs has no nav row and should keep Batch Lookup lit.
  exact?: boolean;
}) {
  const active = office && href === "/office"
    ? SHOP_PATHS.some(p => (p === "/" ? path === "/" : path.startsWith(p)))
    : href === "/" || href === "/sales" || exact ? path === href : path.startsWith(href);
  return (
    <Link href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? "bg-brand text-white shadow-sm" : "text-gray-600 hover:bg-white hover:text-brand"
      }`}>
      <NavIcon d={icon} />
      {label}
    </Link>
  );
}

/**
 * A nav section that FOLDS. The admin sidebar had grown to ~38 rows across
 * eight sections, and finding anything meant scrolling past everyone else's
 * department - the owner asked for a better arrangement, and the arrangement
 * that scales is: closed by default, open where you are.
 *
 * THE SECTION CONTAINING THE CURRENT PAGE CAN ALWAYS BE SEEN. It is forced
 * open and its chevron still works for a manual fold, but navigation always
 * lands you somewhere visible - a nav that hides the page you are on reads
 * as broken.
 *
 * Manual choices persist per section in localStorage, so the fold survives
 * navigation and reload. The key is the section label: stable, human, and
 * shared across roles that see the same section.
 *
 * DEFAULT IS OPEN, not closed, for the first paint and for anybody who has
 * never folded anything: the pre-fold sidebar is the one every user already
 * knows, so nothing moves until they choose. localStorage is read in an
 * effect because this is a client component that renders on the server
 * first - reading it during render would make the server and client HTML
 * disagree and React would warn about hydration.
 */
function Section({ label, items, path }: { label: string; items: { href: string; icon: string; label: string; exact?: boolean }[]; path: string }) {
  const holdsCurrent = items.some((t) =>
    t.exact ? path === t.href || path.startsWith(t.href + "?") : path === t.href || path.startsWith(t.href + "/"));
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try { setFolded(localStorage.getItem("nav-fold:" + label) === "1"); } catch { /* private mode */ }
  }, [label]);
  if (!items.length) return null;
  const closed = folded && !holdsCurrent;
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try { localStorage.setItem("nav-fold:" + label, next ? "1" : "0"); } catch { /* private mode */ }
  };
  return (
    <div className="mt-4 first:mt-0">
      <button type="button" onClick={toggle}
        className="mb-1 flex w-full items-center justify-between px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 transition hover:text-gray-600">
        <span>{label}</span>
        <svg className={"h-3 w-3 transition-transform " + (closed ? "-rotate-90" : "")}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!closed && (
        <div className="flex flex-col gap-0.5">
          {items.map(t => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} exact={t.exact} />)}
        </div>
      )}
    </div>
  );
}

/* Main Nav export — flat, access-filtered sections (no dropdowns) */
export function Nav({
  showAdmin = false, branch = "SHOP_FLOOR", role = "", fabTier = "", inventory = false, consumables = false, intlSales = false, salesDuty = "", batchVerify = false,
}: {
  showAdmin?: boolean; branch?: string; role?: string; fabTier?: string; inventory?: boolean; consumables?: boolean; intlSales?: boolean; salesDuty?: string;
  /** This login signs batch verifications (/office/batch-verify): the store
   *  incharge by role, the production verifier by WEIGHTS_VERIFIER_EMAILS.
   *  Computed in Shell — this client component must not read the env var. */
  batchVerify?: boolean;
}) {
  const path    = usePathname();
  const office  = branch === "OFFICE";
  const isAdmin = role === "ADMIN";                                  // admins span every department
  // International Sales context is FOCUSED: whoever is signed into that
  // branch (admins included, via the sales login card) sees only the sales
  // section + Admin — production/fab nav stays in the other branches.
  const isFab   = isAdmin || branch === "FABRICATION";               // fabrication section
  const isProd  = isAdmin || (!office && branch !== "FABRICATION" && branch !== "INTERNATIONAL_SALES");  // production section
  const mgmt    = fabTier === "ADMIN" || fabTier === "MANAGER";
  const supPlus = mgmt || fabTier === "SUPERVISOR";

  // International Sales links, filtered by module duty (fork's SalesGroup, with
  // the production-manager duty retired -> module admins own production orders).
  const spAccess   = salesDuty === "SALESPERSON" || salesDuty === "REPORTING_MANAGER" || salesDuty === "SALES_ADMIN";
  const salesAdmin = salesDuty === "SALES_ADMIN";
  const intlSalesItems = [
    { href: "/sales", icon: I.overview, label: "Dashboard" },
    ...(spAccess ? [
      { href: "/sales/clients", icon: I.users,   label: "Clients" },
      { href: "/sales/pi",      icon: I.report,  label: "Proforma Invoices" },
      { href: "/sales/orders",  icon: I.samples, label: "Orders" },
    ] : [{ href: "/sales/orders", icon: I.tables, label: "All Orders" }]),
    ...(salesDuty === "COMMERCIAL" || salesAdmin ? [{ href: "/sales/stock",    icon: I.box, label: "Stock Checks" }] : []),
    ...(salesDuty === "ACCOUNTS"   || salesAdmin ? [{ href: "/sales/payments", icon: I.ceo, label: "Payments" }] : []),
    ...(salesAdmin ? [{ href: "/sales/production", icon: I.factory,  label: "Production Orders" }] : []),
    ...(spAccess   ? [{ href: "/sales/settings",   icon: I.planning, label: "Settings" }] : []),
  ];

  // Chromia module — the module's own nine screens (lib/chromia/config/navigation.ts),
  // re-rooted under /chromia. Declared once and used twice: as the whole nav for
  // the dedicated CHROMIA tablet role below, and as a Shop Floor section for
  // admins, who reach every department. Icons mirror Robo's where the screen is
  // the same idea, so the two shop-floor modules read as one family.
  // Sampling module — the three screens the Sampling Incharge works from,
  // declared once and used twice, exactly as chromiaItems below is: as the whole
  // nav for the capped SAMPLING role, and as a section for admins, who span
  // every department.
  //
  // WITHOUT THE ROLE ARM THIS LOGIN HAD NO NAV AT ALL. Role.SAMPLING is capped
  // to /sampling + /api/sampling (lib/routeCaps.ts samplingMayVisit), and with
  // no arm of its own it fell through to the shop-floor nav at the foot of this
  // file — Live Status, Data Entry, Tables, the lot — every one of which
  // middleware then refused. A sidebar of links that all lead to /no-access is
  // worse than no sidebar: it reads as a broken ERP rather than as a focused one.
  //
  // "exact" on /sampling: /sampling/add-stock and /sampling/dispatch are nav
  // rows of their own, and the default prefix rule would light Inventory
  // alongside whichever of them is open.
  //
  // NOT the Fabrication Supervisor's, and there is deliberately no arm for him.
  // He may add sample stock and nothing else, he cannot open these PAGES at all
  // (his FABRICATION branch block refuses them), and his control lives on
  // /fab/supervisor/slabs where the slab is. A row here would be a link to a
  // refusal.
  const samplingItems = [
    { href: "/sampling",            icon: I.box,       label: "Inventory", exact: true },
    // ASKING FOR SAMPLES IS NOT ADDING THEM, which is why this is its own row
    // and not a tab inside Add Stock. Add Stock records pieces that ALREADY
    // EXIST — offcuts found on the floor. A request asks the floor to cut pieces
    // that do not exist yet, and the answer arrives days later as stock.
    { href: "/sampling/requests",   icon: I.factory,   label: "Requests" },
    { href: "/sampling/add-stock",  icon: I.entry,     label: "Add Stock" },
    { href: "/sampling/dispatch",   icon: I.packaging, label: "Dispatch" },
  ];

  const chromiaItems = [
    { href: "/chromia/dashboard",              icon: I.overview, label: "Dashboard" },
    { href: "/chromia/operator",               icon: I.factory,  label: "Operator Entry" },
    { href: "/chromia/slabs",                  icon: I.batch,    label: "Slab Records" },
    { href: "/chromia/stockyard",              icon: I.samples,  label: "Stockyard" },
    { href: "/chromia/recalibrations",         icon: I.spanner,  label: "Recalibration" },
    { href: "/chromia/recalibration-tracking", icon: I.live,     label: "Recal. Tracking" },
    { href: "/chromia/reports",                icon: I.ceo,      label: "Summary" },
    { href: "/chromia/downloads",              icon: I.box,      label: "Downloads" },
    { href: "/chromia/import",                 icon: I.entry,    label: "Import" },
  ];

  if (role === "STORE")
    // Batch Sign-off is the ONE office path this role reaches (middleware caps
    // the rest of /office away). It was granted there and linked nowhere — the
    // store incharge could not find the screen built for them.
    // SECTIONS FOR EVERY LOGIN THAT HAS THEM (owner, 2026-08-22), not only the
    // admin: the fold is the sidebar's way of staying short, and a store
    // incharge scrolling nine flat rows needs it as much as an admin with
    // thirty-eight. Grouped the way the admin sidebar groups the same links.
    return (
      <nav className="flex flex-col">
        <Section label="Overview" items={STORE_TABS.filter(t => t.href === "/live")} path={path} />
        <Section label="Raw Material" items={STORE_TABS.filter(t => t.href.startsWith("/store") || t.href === "/tables")} path={path} />
        <Section label="Consumables" items={STORE_TABS.filter(t => t.href === "/consumables")} path={path} />
        {batchVerify && <Section label="Verification" items={[{ href: "/office/batch-verify", icon: I.report, label: "Batch Sign-off" }]} path={path} />}
      </nav>
    );
  if (role === "COMMERCIAL")
    return (
      <nav className="flex flex-col gap-1">
        <NavLink href="/inventory" icon={I.box} label="Finished Goods" path={path} />
        {/* Office-branch Commercial also gets the read-only production lookups. */}
        {office && <NavLink href="/office" icon={I.factory} label="Shop Floor" path={path} office />}
      </nav>
    );
  if (role === "SALES")
    return <nav className="flex flex-col gap-1"><NavLink href="/inventory" icon={I.box} label="Finished Goods" path={path} /></nav>;
  if (role === "MAINTENANCE")
    return (
      <nav className="flex flex-col">
        <Section label="Overview" items={MAINTENANCE_TABS.filter(t => t.href === "/")} path={path} />
        <Section label="Maintenance" items={MAINTENANCE_TABS.filter(t => t.href === "/mis" || t.href.startsWith("/maintenance"))} path={path} />
        <Section label="Reports" items={MAINTENANCE_TABS.filter(t => t.href.startsWith("/report"))} path={path} />
        <Section label="Consumables" items={MAINTENANCE_TABS.filter(t => t.href === "/consumables")} path={path} />
      </nav>
    );
  if (role === "ROBO")
    // robo line operator — the robo module is their whole ERP
    return (
      <nav className="flex flex-col">
        <Section label="Production" items={[
          { href: "/robo", icon: I.factory, label: "Robo Entry", exact: true },
          { href: "/robo/slabs", icon: I.batch, label: "Slab Records" },
        ]} path={path} />
        <Section label="Reports" items={[
          { href: "/robo/reports", icon: I.ceo, label: "Reports" },
          { href: "/robo/downloads", icon: I.box, label: "Downloads" },
        ]} path={path} />
        <Section label="Setup" items={[
          { href: "/robo/import", icon: I.entry, label: "Import" },
          { href: "/robo/masters", icon: I.tables, label: "Master Lists" },
        ]} path={path} />
      </nav>
    );
  if (role === "CHROMIA" || (!isAdmin && branch === "CHROMIA"))
    // chromia line tablet — the chromia module is their whole ERP. The branch
    // arm covers logins left on the retired CHROMIA department, which
    // middleware caps to this module too; it goes with them.
    return (
      <nav className="flex flex-col">
        <Section label="Production" items={chromiaItems.filter(t => ["/chromia/dashboard", "/chromia/operator", "/chromia/slabs", "/chromia/stockyard"].includes(t.href))} path={path} />
        <Section label="Recalibration" items={chromiaItems.filter(t => t.href.startsWith("/chromia/recalibration"))} path={path} />
        <Section label="Reports" items={chromiaItems.filter(t => t.href === "/chromia/reports" || t.href === "/chromia/downloads")} path={path} />
        <Section label="Setup" items={chromiaItems.filter(t => t.href === "/chromia/import")} path={path} />
      </nav>
    );
  if (role === "SAMPLING")
    // sampling incharge — the sampling module is their whole ERP, the same
    // whole-nav takeover ROBO and CHROMIA get directly above. Two sections
    // rather than three flat rows, because that is what the module is: the
    // shelf, and what leaves it.
    return (
      <nav className="flex flex-col">
        <Section label="Stock" items={samplingItems.filter(t => t.href !== "/sampling/dispatch")} path={path} />
        <Section label="Outward" items={samplingItems.filter(t => t.href === "/sampling/dispatch")} path={path} />
      </nav>
    );
  if (role === "OPERATOR" && branch !== "FABRICATION")
    return (
      <nav className="flex flex-col gap-1">
        <NavLink href="/entry"  icon={I.entry}  label="Data Entry"  path={path} />
        <NavLink href="/live"   icon={I.live}   label="Live Status" path={path} />
        <NavLink href="/tables" icon={I.tables} label="My Tables"   path={path} />
      </nav>
    );
  if (office)
    return (
      <nav className="flex flex-col">
        {/* "Shop Floor" keeps its office-aware highlight (it lights for every
            production lookup), so it stays a bare NavLink under its heading. */}
        <div className="mt-4 first:mt-0">
          <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Office</p>
          <div className="flex flex-col gap-0.5">
            <NavLink href="/office" icon={I.factory} label="Shop Floor" path={path} office />
            <NavLink href="/entry"  icon={I.entry}   label="Data Entry" path={path} />
          </div>
        </div>
        <Section label="Finance" items={[
          ...((role === "FINANCE" || role === "ACCOUNTS" || showAdmin) ? [{ href: "/office/finance", icon: I.report, label: "Bill Automation" }] : []),
          // Costing prices the whole cost base — strictly ADMIN, like the scoreboard.
          ...(isAdmin ? [{ href: "/office/costing", icon: I.ceo, label: "Batch Costing" }] : []),
        ]} path={path} />
        {inventory && <Section label="Inventory" items={[{ href: "/inventory", icon: I.box, label: "Finished Goods" }]} path={path} />}
        {showAdmin && <Section label="Admin" items={[{ href: "/admin/users", icon: I.users, label: "Users & Roles" }]} path={path} />}
      </nav>
    );

  const overview = [
    ...(isProd ? [{ href: "/", icon: I.overview, label: "Production Dashboard" }] : []),
    ...(isFab  ? [{ href: "/fab/ceo", icon: I.ceo, label: "Fabrication Dashboard" }] : []),
  ];
  const production = [
    { href: "/live",   icon: I.live,   label: "Live Status" },
    { href: "/entry",  icon: I.entry,  label: "Data Entry" },
    { href: "/tables", icon: I.tables, label: "Tables" },
  ];
  const reports = [
    { href: "/report/ceo", icon: I.ceo, label: "CEO Report" },
    // ONE row for the three lookup pages. /batch, /slab and /report each
    // answered "tell me about X" with their own nav row and no link between
    // them; they now share a tab strip (LookupTabs) so one row reaches all
    // three. The URLs did not move - every cap and bookmark still works.
    { href: "/batch", icon: I.batch, label: "Lookups" },
    { href: "/mis",    icon: I.mis,    label: "Downtime" },
    { href: "/maintenance", icon: I.spanner, label: "Maintenance Log" },
    // Only for the named production verifier (WEIGHTS_VERIFIER_EMAILS) — a
    // shop-floor Line Manager who is not on that list never sees this, exactly
    // as the page itself would bounce them home.
    // NOT for admins any more: sign-off lives inside Batch Costing for them,
    // where the marks were already displayed - two pages sharing a batch
    // picker and the same panels was the duplication the owner pointed at.
    // The named verifiers keep this row: their page deliberately never shows
    // a computed sheet, and the costing page is ADMIN-only.
    ...(batchVerify && !isAdmin ? [{ href: "/office/batch-verify", icon: I.samples, label: "Batch Sign-off" }] : []),
  ];
  const fabrication = [
    ...(mgmt ? [
      { href: "/fab/manager", icon: I.manager, label: "Purchase Orders" },
    ] : []),
    ...(supPlus ? [
      { href: "/fab/supervisor/slabs",     icon: I.planning, label: "Slab & Sink Assignment" },
      { href: "/fab/supervisor/people",    icon: I.users,    label: "People" },
      { href: "/fab/supervisor/downtime",  icon: I.mis,      label: "Fab Downtime" },
      { href: "/fab/supervisor",           icon: I.live,     label: "Cut Queue" },
    ] : []),
    { href: "/fab/cutting",      icon: I.scissors,    label: "Cutting" },
    { href: "/fab/polishing",    icon: I.polishing,   label: "Polishing" },
    { href: "/fab/sink-cutting", icon: I.sink,        label: "Sink Cutting" },
    { href: "/fab/fabrication",  icon: I.fabrication, label: "Fabrication" },
    { href: "/fab/packaging",    icon: I.packaging,   label: "Packaging" },
    { href: "/fab/supervisor/samples", icon: I.samples, label: "Samples" },
  ];
  const admin = [
    ...(showAdmin ? [{ href: "/admin/users", icon: I.users, label: "Users & Roles" }] : []),
    // Scoreboard ranks named people and feeds an incentive payout, so it is
    // ADMIN-only — not showAdmin, which also admits shop-floor incharges.
    ...(isAdmin ? [{ href: "/scoreboard", icon: I.report, label: "Shift Scoreboard" }] : []),
    // Costing prices the plant's whole cost base — same strictness.
    ...(isAdmin ? [{ href: "/office/costing", icon: I.ceo, label: "Batch Costing" }] : []),
  ];

  if (branch === "INTERNATIONAL_SALES") {
    // The sales card is a clean workspace: ONLY the sales section — plus Admin
    // for admins. Admins wanting production/fab sign in via the other cards
    // (or the sidebar keeps them one sign-in away).
    return (
      <nav className="flex flex-col">
        <Section label="International Sales" items={intlSalesItems} path={path} />
        {(isAdmin || salesDuty === "SALES_ADMIN") && <Section label="Admin" items={admin} path={path} />}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col">
      <Section label="Overview" items={overview} path={path} />
      {isProd && <Section label="Production" items={production} path={path} />}
      {isProd && <Section label="Lookups &amp; Reports" items={reports} path={path} />}
      {isFab  && <Section label="Fabrication" items={fabrication} path={path} />}
      {/* Shop Floor -> Chromia. Admins only: the CHROMIA role gets the whole-nav
          takeover above, and no other role may open the module (middleware). */}
      {isAdmin && <Section label="Chromia" items={chromiaItems} path={path} />}
      {/* Shop Floor -> Sampling. Admins only, for the same reason as Chromia
          above: the SAMPLING role gets the whole-nav takeover, and the only
          other login middleware admits to these pages is an admin. */}
      {isAdmin && <Section label="Sampling" items={samplingItems} path={path} />}
      {inventory && <Section label="Inventory" items={[{ href: "/inventory", icon: I.box, label: "Finished Goods" }]} path={path} />}
      {consumables && <Section label="Consumables" items={[{ href: "/consumables", icon: I.box, label: "Consumables" }]} path={path} />}
      {intlSales && <Section label="International Sales" items={intlSalesItems} path={path} />}
      <Section label="Admin" items={admin} path={path} />
    </nav>
  );
}
