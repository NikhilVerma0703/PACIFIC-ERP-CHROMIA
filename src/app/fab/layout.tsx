import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";

export default async function FabLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const fabRole = (session.user as any).fabRole;
  if (!fabRole) redirect("/");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 min-h-screen bg-white border-r border-gray-100 p-4 flex flex-col gap-2">
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">Fabrication</p>
          </div>
          <Nav role={(session.user as any).role} fabRole={fabRole} />
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
