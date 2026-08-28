import { currentUser } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { fabTierOf } from "@/lib/fab/access";
import { NewProjectForm } from "./NewProjectForm";

// The manager dashboard. Three things happen on this surface and nothing else:
// create a project, create a PO under it, upload that PO's PDF. Slabs, sinks
// and wastage are the supervisor's board (/fab/supervisor) and are not here.
//
// The older /fab/projects screen — the Drawing Summary Excel intake — is left
// exactly as it was and still works; retiring it is a separate change.

export default async function FabManagerPage() {
  // currentUser(), NOT auth(): fabTierOf answers from role + branch, so it has
  // to be asked about the ACTIVE pair. A login holding two jobs that has
  // switched into its Fabrication one carries SHOP_FLOOR in the raw session and
  // would be turned away here by the gate that admitted it a moment earlier.
  // It also revalidates the session, which auth() alone did not.
  const user = await currentUser();
  if (!user) redirect("/login");
  const tier = fabTierOf(user);
  if (!tier) redirect("/");
  // Manager-only surface. Anyone else in fabrication lands on the project list,
  // which every tier can read — /fab/supervisor is a client board that would
  // just fail to load for an operator.
  if (tier !== "MANAGER" && tier !== "ADMIN") redirect("/fab/projects");

  const projects = await prisma.fabProject.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { pos: true, requirements: true } } },
  });

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Manager Dashboard</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          {projects.length} project{projects.length === 1 ? "" : "s"} · create a project, add its purchase orders, upload each PO&apos;s PDF
        </p>
      </div>

      <NewProjectForm />

      {projects.length === 0 ? (
        <div className="text-center py-20 text-slate-400">No projects yet.</div>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/fab/manager/${p.id}`}
              className="bg-white rounded-xl border border-slate-100 p-5 hover:shadow-sm transition block"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-lg font-bold text-slate-900">{p.projectCode}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                      {p.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{p.customerName}</p>
                  {p.remarks && <p className="text-xs text-slate-400 mt-1 truncate">{p.remarks}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-slate-700">
                    {p._count.pos} PO{p._count.pos === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{p._count.requirements} requirement rows</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
