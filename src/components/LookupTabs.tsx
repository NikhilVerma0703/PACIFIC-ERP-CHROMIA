import Link from "next/link";

// The three lookup pages presented as ONE surface.
//
// /batch, /slab and /report each answer "tell me about X" with their own
// search box, and the sidebar listed all three - so the same job took three
// nav rows and there was nothing on any of the pages saying the other two
// existed. The owner asked for pages that repeat to be merged.
//
// The URLs deliberately DO NOT move. Every role cap, bookmark, middleware rule
// and test names these paths, and merging them into one route would mean
// re-teaching all of it for a purely visual gain. The tabs make them read as
// one page; the caps keep working because nothing they point at changed.
//
// WHO SEES THE TABS: the audience of the "Lookups & Reports" nav section -
// admin, and shop-floor incharge / line manager. Every one of them may open
// all three pages, so no tab ever leads a viewer somewhere their cap refuses.
// MAINTENANCE is deliberately outside this: their cap grants /report alone,
// and a tab strip offering /batch would be a promise the middleware breaks.

export function showLookupTabs(role: string, branch: string): boolean {
  if (role === "ADMIN") return true;
  return (role === "INCHARGE" || role === "LINE_MANAGER") && branch === "SHOP_FLOOR";
}

const TABS = [
  { href: "/batch", label: "Batch" },
  { href: "/slab", label: "Slab" },
  { href: "/report", label: "Production Report" },
] as const;

export function LookupTabs({ active }: { active: "/batch" | "/slab" | "/report" }) {
  return (
    <div className="mb-5 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={
            t.href === active
              ? "rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-gray-900 shadow-sm"
              : "rounded-lg px-4 py-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-900"
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
