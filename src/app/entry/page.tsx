import Link from "next/link";
import { entryAccess, MIN_ENTRY_RANK } from "@/lib/stationAccess";
import { canManageRm, currentRole, rankOf } from "@/lib/rbac";
import { STATION_LABEL } from "@/lib/rbac";
import { OFFICE_MODELS, BRANCH_LABEL } from "@/lib/branch";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const ICON = {
  bolt: "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  box: "M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12",
  doc: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
};
function Icon({ d }: { d: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

type Kind = "entry" | "param" | "record" | "guided";
type Item = { href: string; label: string; kind: Kind; model: string };
type Section = { title: string; note?: string; items: Item[] };

const SECTIONS: Section[] = [
  { title: "Press", items: [
    { href: "/entry/slab/Press", label: "Press slab entry", kind: "entry", model: "Press" },
  ]},
  { title: "Oven", items: [
    { href: "/entry/slab/Oven", label: "Oven slab entry", kind: "entry", model: "Oven" },
  ]},
  { title: "Distributor", items: [
    { href: "/entry/slab/Distributor", label: "Distributor slab entry", kind: "entry", model: "Distributor" },
  ]},
  { title: "Kreos", items: [
    { href: "/entry/slab/Kreos", label: "Kreos slab entry", kind: "entry", model: "Kreos" },
  ]},
  { title: "Jot", items: [
    { href: "/entry/slab/Jot", label: "Jot entry", kind: "entry", model: "Jot" },
  ]},
  { title: "Mixer", items: [
    { href: "/entry/mixer", label: "Mixer Cycle", kind: "entry", model: "MixerCycle" },
  ]},
  { title: "Polishing", items: [
    { href: "/entry/slab/PolishEntry", label: "Polish Entry", kind: "entry", model: "PolishEntry" },
    { href: "/entry/slab/PolishQc", label: "Polish QC", kind: "entry", model: "PolishQc" },
  ]},
  { title: "Materials & stock", items: [
    { href: "/entry/record/Silo", label: "Silo filling (dump bag in)", kind: "entry", model: "Silo" },
    { href: "/entry/record/SiloEmptyingLog", label: "Silo emptying (manual)", kind: "entry", model: "SiloEmptyingLog" },
    { href: "/entry/record/DailyResinTank", label: "Daily Resin Tank", kind: "entry", model: "DailyResinTank" },
  ]},
  { title: "Dispatch", items: [
    { href: "/entry/record/ShippingInvoice", label: "Shipping & Invoice", kind: "entry", model: "ShippingInvoice" },
  ]},
  { title: "Reporting", items: [
    { href: "/entry/mis", label: "MIS shift sheet", kind: "entry", model: "Mis" },
  ]},
];

const STYLE: Record<Kind, { icon: string; wrap: string; sub: string }> = {
  entry:  { icon: ICON.bolt,    wrap: "bg-brand text-white",      sub: "smart entry" },
  param:  { icon: ICON.sliders, wrap: "bg-brand/10 text-brand",   sub: "set parameters" },
  record: { icon: ICON.box,     wrap: "bg-gray-100 text-gray-500", sub: "new record" },
  guided: { icon: ICON.doc,     wrap: "bg-gray-100 text-gray-500", sub: "open form" },
};

const RM_STORE_ITEMS: Item[] = [
  { href: "/store/bag", label: "Add bag (direct)", kind: "entry", model: "Rm" },
  { href: "/store/resin", label: "Resin intake (storage)", kind: "entry", model: "ResinStorage" },
  { href: "/store/entry", label: "RM entry (manual)", kind: "entry", model: "UnassignedRm" },
  { href: "/store/upload", label: "RM upload (Excel)", kind: "record", model: "UnassignedRm" },
  { href: "/store/assign", label: "RM assignment (bags)", kind: "guided", model: "Rm" },
];

export default async function EntryIndex() {
  const { models, station, branch } = await entryAccess();
  const rmStore = branch === "SHOP_FLOOR" && (await canManageRm());
  const myRank = rankOf(await currentRole());
  const rankOk = (m: string) => !MIN_ENTRY_RANK[m] || myRank >= MIN_ENTRY_RANK[m];
  const sections = (models === null
    ? SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter((it) => !OFFICE_MODELS.has(it.model) && rankOk(it.model)) }))
    : SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter((it) => models.includes(it.model) && rankOk(it.model)) }))
  ).filter((sec) => sec.items.length > 0);
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Data entry</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">{branch === "OFFICE"
          ? `${BRANCH_LABEL.OFFICE} branch — finance & dispatch forms.`
          : models === null
            ? "Organised by machine. Every form is a smart entry: the previous record prefills, counters advance automatically and your name is stamped from your login — edit only what changed."
            : station
              ? `Your station: ${STATION_LABEL[station] ?? station} — these are your forms.`
              : "No station is assigned to your login yet — ask your incharge to set your machine in Users & Roles."}</p>
      </div>

      <div className="space-y-7">
        {sections.map((sec) => (
          <section key={sec.title}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">{sec.title}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {sec.items.map((it) => {
                const s = STYLE[it.kind];
                return (
                  <Link key={it.href} href={it.href}>
                    <Card hover className="flex items-center gap-3 py-4">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.wrap}`}><Icon d={s.icon} /></div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">{it.label}</div>
                        <div className="text-[11px] text-brand">{s.sub}</div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {rmStore && (
        <section className="mt-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">RM Store</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {RM_STORE_ITEMS.map((it) => {
              const s = STYLE[it.kind];
              return (
                <Link key={it.href} href={it.href}>
                  <Card hover className="flex items-center gap-3 py-4">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.wrap}`}><Icon d={s.icon} /></div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">{it.label}</div>
                      <div className="text-[11px] text-brand">{s.sub}</div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {models === null && <p className="mt-8 text-sm text-gray-500">Every one of the 46 tables is editable under <Link href="/tables" className="font-medium text-brand hover:underline">Tables</Link>.</p>}
    </Shell>
  );
}
