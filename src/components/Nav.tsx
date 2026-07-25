"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  overview:    "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  batch:       "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  tables:      "M4 5h16v14H4zM4 10h16M10 5v14",
  report:      "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  mis:         "M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5M12 16h.01",
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

// Maintenance Manager is capped: Overview + the Downtime report only.
const MAINTENANCE_TABS = [
  { href: "/",    label: "Overview", icon: I.overview },
  { href: "/mis", label: "Downtime", icon: I.mis      },
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
function NavLink({ href, icon, label, path, office }: {
  href: string; icon: string; label: string; path: string; office?: boolean;
}) {
  const active = office && href === "/office"
    ? SHOP_PATHS.some(p => (p === "/" ? path === "/" : path.startsWith(p)))
    : href === "/" || href === "/sales" ? path === href : path.startsWith(href);
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

/* Section — a labelled, non-collapsible group of links (same look as the app tabs) */
function Section({ label, items, path }: { label: string; items: { href: string; icon: string; label: string }[]; path: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{label}</p>
      <div className="flex flex-col gap-0.5">
        {items.map(t => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} />)}
      </div>
    </div>
  );
}

/* Main Nav export — flat, access-filtered sections (no dropdowns) */
export function Nav({
  showAdmin = false, branch = "SHOP_FLOOR", role = "", fabTier = "", inventory = false, consumables = false, intlSales = false, salesDuty = "",
}: {
  showAdmin?: boolean; branch?: string; role?: string; fabTier?: string; inventory?: boolean; consumables?: boolean; intlSales?: boolean; salesDuty?: string;
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

  if (role === "STORE")
    return <nav className="flex flex-col gap-1">{STORE_TABS.map(t => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} />)}</nav>;
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
    return <nav className="flex flex-col gap-1">{MAINTENANCE_TABS.map(t => <NavLink key={t.href} href={t.href} icon={t.icon} label={t.label} path={path} />)}</nav>;
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
      <nav className="flex flex-col gap-1">
        <NavLink href="/office" icon={I.factory} label="Shop Floor" path={path} office />
        <NavLink href="/entry"  icon={I.entry}   label="Data Entry" path={path} />
        {inventory && <NavLink href="/inventory" icon={I.box} label="Finished Goods" path={path} />}
        {showAdmin && <NavLink href="/admin/users" icon={I.users} label="Users & Roles" path={path} />}
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
    { href: "/batch",  icon: I.batch,  label: "Batch Lookup" },
    { href: "/slab",   icon: I.batch,  label: "Slab Lookup" },
    { href: "/report", icon: I.report, label: "Production Report" },
    { href: "/mis",    icon: I.mis,    label: "Downtime" },
  ];
  const fabrication = [
    ...(mgmt ? [{ href: "/fab/projects", icon: I.manager, label: "Manager View" }] : []),
    ...(supPlus ? [{ href: "/fab/supervisor", icon: I.planning, label: "Supervisor Board" }] : []),
    { href: "/fab/cutting",      icon: I.scissors,    label: "Cutting" },
    { href: "/fab/polishing",    icon: I.polishing,   label: "Polishing" },
    { href: "/fab/sink-cutting", icon: I.sink,        label: "Sink Cutting" },
    { href: "/fab/fabrication",  icon: I.fabrication, label: "Fabrication" },
    { href: "/fab/packaging",    icon: I.packaging,   label: "Packaging" },
    { href: "/cutting",          icon: I.samples,     label: "Samples" },
  ];
  const admin = [
    ...(showAdmin ? [{ href: "/admin/users", icon: I.users, label: "Users & Roles" }] : []),
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
      {inventory && <Section label="Inventory" items={[{ href: "/inventory", icon: I.box, label: "Finished Goods" }]} path={path} />}
      {consumables && <Section label="Consumables" items={[{ href: "/consumables", icon: I.box, label: "Consumables" }]} path={path} />}
      {intlSales && <Section label="International Sales" items={intlSalesItems} path={path} />}
      <Section label="Admin" items={admin} path={path} />
    </nav>
  );
}
