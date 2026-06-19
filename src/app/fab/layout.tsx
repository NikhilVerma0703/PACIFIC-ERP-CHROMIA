"use server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Nav } from "@/components/Nav";
import Link from "next/link";

export default async function FabLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const fabRole = (session.user as any).fabRole;
  if (!fabRole) redirect("/");

  const cookieStore = await cookies();
  const machineType = cookieStore.get("fab_machine_type")?.value ?? null;
  const machineName = cookieStore.get("fab_machine_name")?.value ?? null;
  const isEmployee = fabRole === "FAB_EMPLOYEE";

  const MACHINE_URLS: Record<string, string> = {
    CUTTING: "/fab/cutting", POLISHING: "/fab/polishing",
    SINK_CUTTING: "/fab/sink-cutting", FABRICATION: "/fab/fabrication",
    PACKAGING: "/fab/packaging",
  };
  const machineUrl = machineType ? MACHINE_URLS[machineType] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 min-h-screen bg-white border-r border-gray-100 p-4 flex flex-col gap-2">
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">Fabrication</p>
          </div>
          {isEmployee ? (
            <>
              {machineUrl && (
                <Link
                  href={machineUrl}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3M4 21h16" />
                  </svg>
                  {machineName ?? "My Queue"}
                </Link>
              )}
              <div className="mt-4">
                <form action="/api/fab/session/end" method="POST">
                  <button type="submit"
                    className="w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition">
                    ✕ End Session
                  </button>
                </form>
              </div>
            </>
          ) : (
            <Nav role={(session.user as any).role} fabRole={fabRole} />
          )}
          <div className="mt-auto pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 px-3">{session.user.name ?? session.user.email}</p>
            <p className="text-xs text-gray-300 px-3">{fabRole.replace("FAB_", "")}</p>
          </div>
        </aside>
        {/* Main content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
