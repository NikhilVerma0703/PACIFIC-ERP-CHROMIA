import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { currentBranchName } from "@/lib/branch";

export const dynamic = "force-dynamic";

const ICON = {
  overview: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  live: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  batch: "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  tables: "M4 5h16v14H4zM4 10h16M10 5v14",
  report: "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
};

const CARDS = [
  { href: "/", label: "Overview", desc: "Production summary — batches, slabs, discrepancies", icon: ICON.overview },
  { href: "/live", label: "Live Status", desc: "Machines, silos, running mixer cycle, RM stock", icon: ICON.live },
  { href: "/batch", label: "Batch Lookup", desc: "Full trace of any batch — slabs, designs, cycles", icon: ICON.batch },
  { href: "/tables", label: "Tables", desc: "Browse production tables (view only)", icon: ICON.tables },
  { href: "/report", label: "Production Report", desc: "Generate the report for any batch", icon: ICON.report },
];

export default async function OfficeShopFloor() {
  if ((await currentBranchName()) !== "OFFICE") redirect("/");
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Shop Floor</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">Production data, viewable from the Office branch. All of it is read-only — rectification happens on the shop floor.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href}>
            <Card hover className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={c.icon} /></svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{c.label}</div>
                <div className="truncate text-xs text-gray-500">{c.desc}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
