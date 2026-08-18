import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { fabSignOut } from "./sign-out-action";

const TYPE_META: Record<string, { label: string; dot: string }> = {
  CUTTING:      { label: "Cutting",      dot: "bg-blue-500"   },
  POLISHING:    { label: "Polishing",    dot: "bg-violet-500" },
  SINK_CUTTING: { label: "Sink Cutting", dot: "bg-orange-500" },
  FABRICATION:  { label: "Fabrication",  dot: "bg-rose-500"   },
  PACKAGING:    { label: "Packaging",    dot: "bg-green-500"  },
};
const MACHINE_URLS: Record<string, string> = {
  CUTTING:      "/fab/cutting",
  POLISHING:    "/fab/polishing",
  SINK_CUTTING: "/fab/sink-cutting",
  FABRICATION:  "/fab/fabrication",
  PACKAGING:    "/fab/packaging",
};

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className="flex-shrink-0">
      <path d={d} />
    </svg>
  );
}

function SidebarSection({ label }: { label: string }) {
  return <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 px-3 mt-5 mb-1.5">{label}</p>;
}

function SLink({ href, icon, label, sub }: { href: string; icon: string; label: string; sub?: boolean }) {
  return (
    <Link href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
        sub ? "text-slate-500 hover:bg-slate-50 hover:text-slate-800 text-[13px]"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}>
      <Icon d={icon} />
      {label}
    </Link>
  );
}

export default async function FabLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const mainRole  = (session.user as any).role   as string | null;
  const fabBranch = (session.user as any).branch as string | null;

  // Admins use the main ERP Shell; only Fabrication-department staff use this layout.
  if (mainRole === "ADMIN") return <Shell>{children}</Shell>;
  if (fabBranch !== "FABRICATION") redirect("/");

  const cookieStore = await cookies();
  const machineType = cookieStore.get("fab_machine_type")?.value ?? null;
  const machineName = cookieStore.get("fab_machine_name")?.value ?? null;
  const isEmployee  = mainRole === "OPERATOR";
  const isManager   = mainRole === "LINE_MANAGER";
  const isSupervisor= mainRole === "INCHARGE";
  const machineUrl  = machineType ? MACHINE_URLS[machineType] : null;
  const typeMeta    = machineType ? TYPE_META[machineType]    : null;
  const roleLabel   = isManager ? "Manager" : isSupervisor ? "Supervisor" : "Employee";

  const SIGN_OUT_PATH = "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9";

  return (
    <div className="flex min-h-screen bg-slate-50">
      {isEmployee ? (
        /* EMPLOYEE: dark sidebar. One operator login covers every station, so all
           five queues are listed. The machine session is optional — when one is
           open its station is highlighted and it is what stamps machineId onto
           the work; without one the queues still work. */
        <aside className="w-60 min-h-screen bg-slate-900 flex flex-col p-4">
          <div className="mb-6 p-3 bg-slate-800 rounded-xl border border-slate-700">
            <div className="flex items-center gap-2.5">
              {typeMeta && <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${typeMeta.dot}`} />}
              <div>
                <p className="text-sm font-semibold text-white leading-tight">{machineName ?? "All stations"}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {typeMeta ? `${typeMeta.label} Active` : "No machine selected"}
                </p>
              </div>
            </div>
          </div>

          <nav className="flex flex-col gap-1 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 px-3 mb-1.5">Queues</p>
            {Object.entries(MACHINE_URLS).map(([type, url]) => {
              const meta      = TYPE_META[type] ?? { label: type, dot: "bg-slate-500" };
              const isCurrent = url === machineUrl;
              return (
                <Link key={type} href={url}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                    isCurrent ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                  {meta.label}
                </Link>
              );
            })}
            <Link href="/fab/session"
              className="mt-2 flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:text-white hover:bg-white/5 transition">
              <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              {machineName ? "Switch Machine" : "Select Machine"}
            </Link>
          </nav>

          <div className="space-y-1 pt-4 border-t border-slate-800">
            {machineName && (
              <form action="/api/fab/session/end" method="POST">
                <button type="submit" className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-amber-400 hover:bg-amber-500/10 transition">
                  <Icon d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
                  End Session
                </button>
              </form>
            )}
            <form action={fabSignOut}>
              <button type="submit" className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 transition">
                <Icon d={SIGN_OUT_PATH} />
                Sign Out
              </button>
            </form>
            <p className="text-xs text-slate-600 px-3 pt-1 truncate">{session.user.name ?? session.user.email}</p>
          </div>
        </aside>
      ) : (
        /* MANAGER / SUPERVISOR: white sidebar */
        <aside className="w-60 h-screen sticky top-0 bg-white border-r border-slate-100 flex flex-col p-4">
          <div className="px-3 mb-5">
            <p className="text-xs font-bold text-slate-900 tracking-tight">Pacific Fabrication</p>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{session.user.name} {roleLabel}</p>
          </div>

          <nav className="flex-1 overflow-y-auto">
            <SidebarSection label="Cutting" />
            <SLink href="/fab/supervisor/samples"
              icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              label="Samples" />

            <p className="text-[10px] font-semibold text-slate-400 px-3 mt-4 mb-1">Projects</p>
            {/* Was labelled "Planning Board". /fab/supervisor carried two tabs,
                Planning and Cut Queue; the Planning tab (the requirement-first
                PlanningBoard) was retired 2026-08 and the page is the cut queue now,
                so the label follows it. The link itself is not dead and stays -- the
                manager gets it too, since they are the ones asked whether a slab
                reached the cutter. Planning proper is the next entry down. */}
            {(isSupervisor || isManager) && (
              <SLink href="/fab/supervisor"
                icon="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
                label="Cut Queue" />
            )}
            {/* The board of the new PO flow, and there is only one of it now.
                It is the slab-first replacement for the Planning Board's
                requirement-first table, and it carries the sink decision the
                flat PO sheet no longer holds — worked slab by slab: pick the
                slab, add its pieces, mark their sinks, send it to cutting.
                /fab/supervisor/sinks was the second entry here and is now a
                redirect to this one, so old bookmarks still land somewhere. */}
            {(isSupervisor || isManager) && (
              <SLink href="/fab/supervisor/slabs"
                icon="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4"
                label="Slab & Sink Assignment" />
            )}
            {isManager && (
              <SLink href="/fab/manager"
                icon="M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z"
                label="Manager Dashboard" />
            )}
            {isManager && (
              <SLink href="/fab/projects"
                icon="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
                label="Manager View" />
            )}

            <SidebarSection label="Queues" />
            <SLink href="/fab/cutting"      icon="M6 3a3 3 0 110 6 3 3 0 010-6zm12 12a3 3 0 110 6 3 3 0 010-6zM5.2 5.2l13.6 13.6" label="Cutting" />
            <SLink href="/fab/polishing"    icon="M12 2a10 10 0 100 20 10 10 0 000-20z" label="Polishing" />
            <SLink href="/fab/sink-cutting" icon="M5 9V5h14v4M2 9h20v2a5 5 0 01-5 5H7a5 5 0 01-5-5V9z" label="Sink Cutting" />
            <SLink href="/fab/fabrication"  icon="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" label="Fabrication" />
            <SLink href="/fab/packaging"    icon="M21 16V8l-9-5-9 5v8l9 5 9-5z" label="Packaging" />
          </nav>

          <div className="pt-3 mt-3 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 px-3 mb-2 truncate">{session.user.name ?? session.user.email}</p>
            <form action="/api/auth/signout" method="POST">
              <button type="submit"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-50 hover:bg-red-50 hover:text-red-600 border border-slate-200 hover:border-red-200 transition">
                <Icon d={SIGN_OUT_PATH} />
                Sign Out
              </button>
            </form>
          </div>
        </aside>
      )}

      <main className="flex-1 p-6 min-h-screen">{children}</main>
    </div>
  );
}
