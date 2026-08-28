import { currentUser } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { fabTierOf } from "@/lib/fab/access";
import { NewPoForm } from "./NewPoForm";
import { PoPdfUpload } from "./PoPdfUpload";
import { PoRequirementTable } from "./PoRequirementTable";

// One project and its purchase orders. A project holds several POs; each PO's
// PDF contributes its own piece rows, and each is reconciled against its own
// totals row, so a second PO can never be mistaken for a re-upload of the first.

export default async function FabManagerProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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

  const project = await prisma.fabProject.findUnique({
    where: { id: projectId },
    include: {
      pos: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { requirements: true } } },
      },
    },
  });
  if (!project) redirect("/fab/manager");

  const poRows = await prisma.fabRequirement.groupBy({
    by: ["poId"],
    where: { projectId },
    _sum: { quantity: true },
  });
  const piecesByPo = new Map<string, number>();
  for (const r of poRows) if (r.poId) piecesByPo.set(r.poId, r._sum.quantity ?? 0);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/fab/manager" className="text-slate-400 hover:text-slate-600 text-sm">
          Manager Dashboard
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-2xl font-bold text-slate-900">{project.projectCode}</h1>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
          {project.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Customer", value: project.customerName },
          { label: "Purchase Orders", value: String(project.pos.length) },
          { label: "Pieces Ordered", value: String(project.numberOfPieces) },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-100 p-4">
            <p className="text-xs text-slate-400 mb-1">{s.label}</p>
            <p className="text-lg font-semibold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <NewPoForm projectId={project.id} />

      {project.pos.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          No purchase orders on this project yet.
        </div>
      ) : (
        <div className="space-y-3">
          {project.pos.map((po) => (
            <div key={po.id} className="bg-white rounded-xl border border-slate-100 p-5">
              <div className="flex items-start justify-between gap-4 mb-1">
                <div className="min-w-0">
                  <span className="text-base font-bold text-slate-900">PO {po.poNumber}</span>
                  {po.pdfFileName && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{po.pdfFileName}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {po.pdfImportedAt ? (
                    <>
                      <p className="text-sm font-semibold text-emerald-700">
                        {po._count.requirements} row{po._count.requirements === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {piecesByPo.get(po.id) ?? 0} pieces
                      </p>
                    </>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                      PDF not uploaded
                    </span>
                  )}
                </div>
              </div>

              {po.pdfImportedAt ? (
                <>
                  <p className="text-xs text-slate-400 mt-2">
                    Imported {po.pdfImportedAt.toISOString().slice(0, 10)}. Edit a cell to fix a
                    row, add one at the bottom, or delete a row that should not have come in.
                    Sinks are still assigned by the supervisor.
                  </p>
                  <PoRequirementTable poId={po.id} />
                </>
              ) : (
                <PoPdfUpload poId={po.id} poNumber={po.poNumber} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
