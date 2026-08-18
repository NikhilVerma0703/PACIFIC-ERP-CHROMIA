import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { CutPlanUpload } from "../CutPlanUpload";
import { ExcelToCsvExport } from "../ExcelToCsvExport";
import { SlabAllocationView } from "../SlabAllocationView";
import { fabTierOf } from "@/lib/fab/access";

export default async function FabProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tier = fabTierOf(session.user);
  if (!tier) redirect("/");

  const project = await prisma.fabProject.findUnique({
    where: { id },
    include: {
      drawings: {
        orderBy: { drawingNumber: "asc" },
        include: {
          defaultSlab: true,
          requirements: {
            orderBy: { createdAt: "asc" },
            include: {
              allocations: { include: { slab: true }, take: 1, orderBy: { createdAt: "desc" } },
            },
          },
        },
      },
      _count: { select: { pieces: true } },
    },
  });

  if (!project) redirect("/fab/projects");

  const STATUS_COLOUR: Record<string, string> = {
    PLANNING:               "bg-yellow-100 text-yellow-800",
    ALLOCATED:              "bg-blue-100 text-blue-800",
    RELEASED_TO_PRODUCTION: "bg-green-100 text-green-800",
    COMPLETED:              "bg-gray-100 text-gray-600",
  };

  const totalReqs = project.drawings.reduce((s, d) => s + d.requirements.length, 0);
  const allocatedReqs = project.drawings.reduce(
    (s, d) => s + d.requirements.filter((r) => r.allocations[0]?.slabId || d.defaultSlabId).length,
    0
  );

  const isSupervisor = tier === "SUPERVISOR";

  const canApproveSlab =
    tier === "SUPERVISOR" || tier === "MANAGER" || tier === "ADMIN";

  const canUploadPlan =
    tier === "MANAGER" || tier === "ADMIN";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/fab/projects" className="text-gray-400 hover:text-gray-600 text-sm">
          Back to Projects
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{project.projectCode}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[project.status] ?? "bg-gray-100 text-gray-600"}`}>
          {project.status.replace(/_/g, " ")}
        </span>
        <div className="ml-auto">
          <Link
            href={`/fab/projects/${id}/operators`}
            className="inline-flex items-center gap-1.5 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            👥 View Operators
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Customer",     value: project.customerName },
          { label: "Drawings",     value: project.drawings.length },
          { label: "Requirements", value: `${allocatedReqs} / ${totalReqs} allocated` },
          { label: "Pieces",       value: project._count.pieces },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">{s.label}</p>
            <p className="text-lg font-semibold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Manager tools: CLO export + cut plan upload */}
      {canUploadPlan && (
        <div className="mb-6 space-y-4">
          <ExcelToCsvExport projectCode={project.projectCode} projectId={id} />
          <CutPlanUpload projectId={id} />
        </div>
      )}

      {/* Slab allocation — supervisor sees ONLY this; manager sees it + drawing table below */}
      <div className="mb-6">
        <SlabAllocationView projectId={id} canApprove={canApproveSlab} />
      </div>

      {/* Requirements by drawing — hidden for supervisors */}
      {!isSupervisor && (
        <div className="space-y-4">
          {project.drawings.map((drawing) => (
            <div key={drawing.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="font-medium text-gray-800">Drawing {drawing.drawingNumber}</span>
                {drawing.defaultSlab && (
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                    Default slab: {drawing.defaultSlab.slabCode}
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-5 py-2">Piece</th>
                    <th className="text-left px-5 py-2">Size</th>
                    <th className="text-center px-5 py-2">Qty</th>
                    <th className="text-center px-5 py-2">Sink</th>
                    <th className="text-center px-5 py-2">Polish</th>
                    <th className="text-left px-5 py-2">Slab</th>
                    <th className="text-center px-5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {drawing.requirements.map((req) => {
                    const slab = req.allocations[0]?.slab ?? drawing.defaultSlab;
                    return (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-5 py-2 text-gray-700">{req.pieceLabel ?? req.description ?? "—"}</td>
                        <td className="px-5 py-2 text-gray-500">
                          {req.length && req.width ? `${req.length} x ${req.width}` : "—"}
                        </td>
                        <td className="px-5 py-2 text-center">{req.quantity}</td>
                        <td className="px-5 py-2 text-center">
                          {req.sinkRequired
                            ? <span className="text-orange-600 font-medium">Yes</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-2 text-center">
                          {req.polishRequired
                            ? <span className="text-blue-600 font-medium">Yes</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-2 text-gray-500">
                          {slab?.slabCode ?? <span className="text-red-400">Not assigned</span>}
                        </td>
                        <td className="px-5 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            req.status === "ALLOCATED"
                              ? "bg-green-100 text-green-700"
                              : req.status === "RELEASED"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {req.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
