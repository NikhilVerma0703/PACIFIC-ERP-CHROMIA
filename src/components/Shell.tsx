import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser, sessionOnce } from "@/lib/rbac";
import { logout } from "@/app/actions";
import { Nav } from "./Nav";
import { CollapsibleSidebar } from "./CollapsibleSidebar";
import { fabTierOf } from "@/lib/fab/access";
import { hasInventoryAccess } from "@/lib/inventory/access";
import { consumablesTierOf } from "@/lib/consumables/access";
import { salesTierOf } from "@/lib/sales/access";
import { salesDutyFor } from "@/lib/sales/session";
import { MobileNav } from "./MobileNav";
import { ROLE_LABEL, STATION_LABEL, rankOf, ROLE_RANK } from "@/lib/rbac";
import { BRANCH_LABEL } from "@/lib/branch";
import { signableSides } from "@/lib/costing/verification";

export async function Shell({ children }: { children: ReactNode }) {
  // sessionOnce = request-cached auth(): Shell's own auth() call plus the one
  // inside currentUser() used to run the jwt-callback User query twice per
  // navigation (measured 2026-08-14). Same session object, one decode+query.
  const session = await sessionOnce();
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
  const consumables = consumablesTierOf(user) !== null;
  const salesTier = salesTierOf(user);
  const intlSales = salesTier !== null;
  const salesDuty = salesTier
    ? await salesDutyFor(String((user as { id?: string } | undefined)?.id ?? ""), salesTier)
    : "";
  // Whether this login SIGNS batch verifications — the store incharge (STORE
  // role) and the named production verifier (WEIGHTS_VERIFIER_EMAILS). Decided
  // HERE because Nav is a client component and must not read the env var; and
  // on signableSides rather than readableSides so admins — who read the verify
  // screen but sign nothing — do not grow a nav entry for it. Neither user had
  // ANY link to /office/batch-verify before this; the page existed, middleware
  // admitted them, and nothing on screen said so.
  const batchVerify = signableSides(
    user?.role as string | undefined,
    user?.email,
    process.env.WEIGHTS_VERIFIER_EMAILS,
  ).length > 0;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — the logo tile hides it, and brings it back (CollapsibleSidebar) */}
      <CollapsibleSidebar subtitle={BRANCH_LABEL[branch] ?? "Production system"}>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          <Nav showAdmin={showAdmin} branch={branch} role={user?.role as string | undefined ?? ""} fabTier={fabTier} inventory={inventory} consumables={consumables} intlSales={intlSales} salesDuty={salesDuty} batchVerify={batchVerify} />
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
      </CollapsibleSidebar>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        {/* print:hidden explicitly — in print the page width can compute below md,
            which put this bar (hamburger, Sign out) at the top of printed reports */}
        <header className="flex items-center justify-between gap-3 border-b border-gray-200/70 bg-white/70 px-5 py-2 backdrop-blur md:hidden print:hidden">
          <div className="flex items-center gap-3">
            <MobileNav showAdmin={showAdmin} branch={branch} role={user?.role as string | undefined ?? ""} fabTier={fabTier} inventory={inventory} consumables={consumables} intlSales={intlSales} salesDuty={salesDuty} batchVerify={batchVerify} />
            <span className="text-base font-semibold text-brand">Pacific ERP</span>
          </div>
          <form action={logout}><button className="min-h-[44px] text-sm text-gray-500">Sign out</button></form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
