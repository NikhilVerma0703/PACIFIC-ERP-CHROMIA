import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function FabProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const fabRole = (session.user as any).fabRole;
  const mainRole = (session.user as any).role;
  if (!fabRole && mainRole !== "ADMIN") redirect("/");

  const { view = "production" } = await searchParams;

  const projects = await prisma.fabProject.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { pieces: true, requirements: true } },
      pieces: { select: { status: true }, take: 1000 },
    },
  });

  const STATUS_BORDER: Record<string, string> = {
    PLANNING:               "border-l-amber-400",
    ALLOCATED:              "border-l-blue-400",
    RELEASED_TO_PRODUCTION: "border-l-emerald-500",
    COMPLETED:              "border-l-slate-300",
  };

  const STATUS_BADGE: Record<string, string> = {
    PLANNING:               "bg-amber-100 text-amber-700",
    ALLOCATED:              "bg-blue-100 text-blue-700",
    RELEASED_TO_PRODUCTION: "bg-emerald-100 text-emerald-700",
    COMPLETED:              "bg-slate-100 text-slate-500",
  };

  // Filter by view
  const visibleProjects = view === "planning"
    ? projects.filter(p => p.status === "PLANNING" || p.status === "ALLOCATED")
    : view === "production"
    ? projects.filter(p => p.status === "RELEASED_TO_PRODUCTION" || p.status === "COMPLETED")
    : projects;

  const total       = projects.length;
  const inPlanning  = projects.filter(p => p.status === "PLANNING" || p.status === "ALLOCATED").length;
  const inProd      = projects.filter(p => p.status === "RELEASED_TO_PRODUCTION").length;
  const completed   = projects.filter(p => p.status === "COMPLETED").length;

  const tabs = [
    { id: "production", label: "Production",  count: inProd + completed },
    { id: "planning",   label: "Planning",    count: inPlanning          },
    { id: "all",        label: "All",         count: total               },
  ];

  const canCreate = fabRole === "FAB_ADMIN" || fabRole === "FAB_MANAGER" || mainRole === "ADMIN";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-400 mt-0.5">{total} total · {inProd} in production</p>
        </div>
        {canCreate && (
          <Link
            href="/fab/projects/new"
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 transition"
          >
            + New Project
          </Link>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <Link
            key={t.id}
            href={`/fab/projects?view=${t.id}`}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              view === t.id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${
              view === t.id ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-500"
            }`}>
              {t.count}
            </span>
          </Link>
        ))}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total",        value: total,      cls: "bg-white border-slate-100"         },
          { label: "Planning",     value: inPlanning, cls: "bg-amber-50 border-amber-100"      },
          { label: "In Production",value: inProd,     cls: "bg-emerald-50 border-emerald-100"  },
          { label: "Completed",    value: completed,  cls: "bg-slate-50 border-slate-100"      },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.cls}`}>
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Project cards */}
      {visibleProjects.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          No {view === "planning" ? "projects awaiting planning" : view === "production" ? "active production projects" : "projects"} yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleProjects.map((p) => {
            const packaged  = p.pieces.filter(x => x.status === "PACKAGED").length;
            const totalPcs  = p._count.pieces;
            const pct       = totalPcs > 0 ? Math.round((packaged  / totalPcs) * 100) : 0;
            const cutCount  = p.pieces.filter(x => x.status !== "PENDING").length;
            const cutPct    = totalPcs > 0 ? Math.round((cutCount  / totalPcs) * 100) : 0;

            return (
              <div
                key={p.id}
                className={`bg-white rounded-xl border border-slate-100 border-l-4 ${STATUS_BORDER[p.status] ?? "border-l-slate-200"} p-5 hover:shadow-sm transition`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-lg font-bold text-slate-900">{p.projectCode}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {p.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 mb-3">{p.customerName}</p>

                    {totalPcs > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                          <span>Cut <strong className="text-blue-600">{cutPct}%</strong></span>
                          <span>Packaged <strong className="text-emerald-600">{pct}%</strong></span>
                          <span>{packaged}/{totalPcs} pieces</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden relative">
                          <div className="absolute inset-y-0 left-0 bg-blue-200 rounded-full transition-all" style={{ width: `${cutPct}%` }}></div>
                          <div className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    )}

                    {totalPcs === 0 && (
                      <p className="text-xs text-slate-400">{p._count.requirements} requirements · awaiting release</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {(p.status === "PLANNING" || p.status === "ALLOCATED") && (
                      <Link
                        href="/fab/supervisor"
                        className="text-xs font-medium text-amber-600 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg px-3 py-1.5 transition text-center"
                      >
                        Plan →
                      </Link>
                    )}
                    <Link
                      href={`/fab/projects/${p.id}`}
                      className="text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 transition text-center"
                    >
                      Open →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
