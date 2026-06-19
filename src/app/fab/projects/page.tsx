import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function FabProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const fabRole = (session.user as any).fabRole;
  if (!fabRole) redirect("/");

  const projects = await prisma.fabProject.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { pieces: true, requirements: true } } },
  });

  const STATUS_COLOUR: Record<string, string> = {
    PLANNING: "bg-yellow-100 text-yellow-800",
    ALLOCATED: "bg-blue-100 text-blue-800",
    RELEASED_TO_PRODUCTION: "bg-green-100 text-green-800",
    COMPLETED: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        {(fabRole === "FAB_ADMIN" || fabRole === "FAB_MANAGER") && (
          <Link href="/fab/projects/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            + New Project
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No projects yet. Create one to get started.</div>
      ) : (
        <div className="grid gap-4">
          {projects.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between hover:shadow-sm transition">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-semibold text-gray-900">{p.projectCode}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[p.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {p.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-sm text-gray-500">{p.customerName}</p>
                <p className="text-xs text-gray-400 mt-1">{p._count.requirements} requirements · {p._count.pieces} pieces</p>
              </div>
              <Link href={`/fab/projects/${p.id}`} className="text-blue-600 text-sm font-medium hover:underline">
                Open →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
