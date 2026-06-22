"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  overview: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  batch: "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  tables: "M4 5h16v14H4zM4 10h16M10 5v14",
  report: "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  entry: "M12 5v14M5 12h14",
  live: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  box: "M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12",
  factory: "M2 20h20M4 20V8l5 4V8l5 4V4l6 4v12",
  mis: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5M12 16h.01",
};

// Production paths grouped under the single "Shop Floor" tab in the Office branch.
const SHOP_PATHS = ["/", "/live", "/batch", "/slab", "/tables", "/report", "/office", "/silo", "/resin", "/store"];

// Store Incharge is capped: Live Status (stock) + the two RM Store actions only.
const STORE_TABS = [
  { href: "/live", label: "Live Status", icon: I.live },
  { href: "/store/bag", label: "Add Bag", icon: I.entry },
  { href: "/store/entry", label: "RM Entry", icon: I.entry },
  { href: "/store/resin", label: "Resin Intake", icon: I.live },
  { href: "/store/upload", label: "RM Upload", icon: I.box },
  { href: "/store/assign", label: "RM Assignment", icon: I.tables },
];

const TABS = [
  { href: "/", label: "Overview", icon: I.overview },
  { href: "/live", label: "Live Status", icon: I.live },
  { href: "/batch", label: "Batch Lookup", icon: I.batch },
  { href: "/slab", label: "Slab Lookup", icon: I.batch },
  { href: "/tables", label: "Tables", icon: I.tables },
  { href: "/report", label: "Production Report", icon: I.report },
  { href: "/mis", label: "Downtime", icon: I.mis },
  { href: "/entry", label: "Data Entry", icon: I.entry },
];

export function Nav({ showAdmin = false, branch = "SHOP_FLOOR", role = "" }: { showAdmin?: boolean; branch?: string; role?: string }) {
  const path = usePathname();
  const office = branch === "OFFICE";
  const base = office
    ? [
        { href: "/office", label: "Shop Floor", icon: I.factory },
        { href: "/entry", label: "Data Entry", icon: I.entry },
      ]
    : TABS;
  const tabs = role === "STORE"
    ? STORE_TABS
    : role === "OPERATOR"
      ? [
          { href: "/entry", label: "Data Entry", icon: I.entry },
          { href: "/live", label: "Live Status", icon: I.live },
          { href: "/tables", label: "My Tables", icon: I.tables },
        ]
      : [
          ...base,
          ...(showAdmin ? [{ href: "/admin/users", label: "Users & Roles", icon: I.users }] : []),
          ...(role === "ADMIN" ? [{ href: "/admin/migration", label: "Airtable Sync", icon: I.box }] : []),
        ];
  return (
    <nav className="flex flex-col gap-1">
      {tabs.map((t) => {
        const active = office && t.href === "/office"
          ? SHOP_PATHS.some((p) => (p === "/" ? path === "/" : path.startsWith(p)))
          : t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand text-white shadow-sm" : "text-gray-600 hover:bg-white hover:text-brand"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
