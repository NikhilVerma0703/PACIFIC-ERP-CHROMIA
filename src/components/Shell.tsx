import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { currentUser } from "@/lib/rbac";
import { logout } from "@/app/actions";
import { Nav } from "./Nav";
import { fabTierOf } from "@/lib/fab/access";
import { hasInventoryAccess } from "@/lib/inventory/access";
import { MobileNav } from "./MobileNav";
import { ROLE_LABEL, STATION_LABEL, rankOf, ROLE_RANK } from "@/lib/rbac";
import { BRANCH_LABEL } from "@/lib/branch";

export async function Shell({ children }: { children: ReactNode }) {
  const session = await auth();
  // revoked / deactivated sessions get bounced even though a cookie exists
  if (session?.user && !(await currentUser())) redirect("/login");
  const user = session?.user;
  const initials = (user?.name || user?.email || "?").slice(0, 2).toUpperCase();
  const branchForNav = ((user as { branch?: string | null } | undefined)?.branch as string | undefined) ?? "SHOP_FLOOR";
  const showAdmin = branchForNav === "OFFICE"
    ? rankOf(user?.role as string | undefined) >= ROLE_RANK.ADMIN
    : rankOf(user?.role as string | undefined) >= ROLE_RANK.INCHARGE;
  const stationLabel = (user as { station?: string | null } | undefined)?.station;
  const branch = ((user as { branch?: string | null } | undefined)?.branch as string | undefined) ?? "SHOP_FLOOR";
  const fabTier = fabTierOf(user) ?? "";
  const inventory = hasInventoryAccess(String(user?.role ?? ""), branch);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-gray-200/70 bg-white/70 px-4 py-5 backdrop-blur md:flex">
        <div className="mb-6 flex shrink-0 items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pacific-dark shadow-sm"><img src="/logo-white.png" alt="Pacific Surfaces" className="h-5 w-5 object-contain" /></div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gray-900">Pacific ERP</div>
            <div className="text-[11px] text-gray-400">{BRANCH_LABEL[branch] ?? "Production system"}</div>
          </div>
        </div>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          <Nav showAdmin={showAdmin} branch={branch} role={user?.role as string | undefined ?? ""} fabTier={fabTier} inventory={inventory} />
        </div>
        <div className="mt-3 shrink-0 rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{initials}</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium text-gray-900">{user?.name || user?.email}</div>
              <div className="text-[11px] text-gray-400">{user?.role ? (ROLE_LABEL[user.role] ?? user.role) : ""}{stationLabel ? ` · ${STATION_LABEL[stationLabel] ?? stationLabel}` : ""}{` · ${BRANCH_LABEL[branch] ?? branch}`}</div>
            </div>
          </div>
          <form action={logout} className="mt-2.5">
            <button className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Sign out</button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between gap-3 border-b border-gray-200/70 bg-white/70 px-5 py-2 backdrop-blur md:hidden">
          <div className="flex items-center gap-3">
            <MobileNav showAdmin={showAdmin} branch={branch} role={user?.role as string | undefined ?? ""} fabTier={fabTier} inventory={inventory} />
            <span className="text-base font-semibold text-brand">Pacific ERP</span>
          </div>
          <form action={logout}><button className="min-h-[44px] text-sm text-gray-500">Sign out</button></form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
