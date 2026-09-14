import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser, grantedUser, sessionOnce } from "@/lib/rbac";
import { logout } from "@/app/actions";
import { contextKey, grantedContexts } from "@/lib/roleContext";
import { RoleSwitcher } from "./RoleSwitcher";
import { Nav } from "./Nav";
import { CollapsibleSidebar } from "./CollapsibleSidebar";
import { fabTierOf } from "@/lib/fab/access";
import { hasInventoryAccess } from "@/lib/inventory/access";
import { consumablesTierOf } from "@/lib/consumables/access";
import { salesTierOf } from "@/lib/sales/access";
import { salesDutyFor } from "@/lib/sales/session";
import { MobileNav } from "./MobileNav";
import { STATION_LABEL, rankOf, ROLE_RANK, roleLabelFor } from "@/lib/rbac";
import { BRANCH_LABEL } from "@/lib/branch";
import { signableSides } from "@/lib/costing/verification";
import { canUseSlabIntake } from "@/lib/inventory/intakeAccess";

export async function Shell({ children }: { children: ReactNode }) {
  // sessionOnce = request-cached auth(): Shell's own auth() call plus the one
  // inside currentUser() used to run the jwt-callback User query twice per
  // navigation (measured 2026-08-14). Same session object, one decode+query.
  const session = await sessionOnce();
  // THE ACTIVE ROLE CONTEXT, not the issued one. Everything below reads
  // `user.role` and `user.branch` — the nav sections, the fab/sales/consumables
  // tiers, the branch label, the admin link — so taking the user from
  // currentUser() is what makes a switch change the sidebar and the dashboard.
  // Reading session.user here instead would leave the shell describing the job
  // the person switched OUT of while every gate behind it enforced the one they
  // switched INTO. For the overwhelming majority (no second job) currentUser()
  // returns the identical object, so this is the same value it always was.
  //
  // revoked / deactivated sessions get bounced even though a cookie exists
  const activeUser = await currentUser();
  if (session?.user && !activeUser) redirect("/login");
  const user = activeUser ?? session?.user;
  // What was GRANTED — for the picker's option list only. currentUser() has the
  // active pair overlaid onto role/branch, so it cannot answer "which jobs does
  // this person hold"; grantedUser() is the un-overlaid login.
  const contexts = grantedContexts(await grantedUser());
  const activeContextKey = contextKey(user?.role, (user as { branch?: string | null } | undefined)?.branch);
  const initials = (user?.name || user?.email || "?").slice(0, 2).toUpperCase();
  const branchForNav = ((user as { branch?: string | null } | undefined)?.branch as string | undefined) ?? "SHOP_FLOOR";
  const showAdmin = branchForNav === "OFFICE"
    ? rankOf(user?.role as string | undefined) >= ROLE_RANK.ADMIN
    : rankOf(user?.role as string | undefined) >= ROLE_RANK.INCHARGE;
  const stationLabel = (user as { station?: string | null } | undefined)?.station;
  const branch = ((user as { branch?: string | null } | undefined)?.branch as string | undefined) ?? "SHOP_FLOOR";
  const fabTier = fabTierOf(user) ?? "";
  // THE WHOLE USER, NOT THE ROLE AND THE BRANCH. Finished goods gained a
  // per-login view grant on 2026-09-14 (users.fg_view, carried on the session as
  // `fgView`), and a pair of strings cannot carry it: hasInventoryAccess's older
  // two-argument form answers the pre-grant rule and is @deprecated for exactly
  // this reason, so a viewer passed through it got the module by URL and no
  // sidebar link to it. Same value as before for everybody else — the object
  // form asks the office role+branch rule first and only then the flag.
  //
  // `user` here is already the ACTIVE role context (currentUser), so a login
  // that switched jobs is asked about the job it is standing in, which is the
  // same user every gate behind the link will ask about.
  const inventory = hasInventoryAccess(user);
  const consumables = consumablesTierOf(user) !== null;
  const salesTier = salesTierOf(user);
  const intlSales = salesTier !== null;
  const salesDuty = salesTier
    ? await salesDutyFor(String((user as { id?: string } | undefined)?.id ?? ""), salesTier)
    : "";
  // Whether this login SIGNS batch verifications - the store incharge (STORE
  // role), the named production verifier (WEIGHTS_VERIFIER_EMAILS), and since
  // 2026-08-21 the ADMIN as well. Decided HERE because Nav is a client
  // component and must not read the env var; and on signableSides rather than
  // readableSides, so the row appears for exactly the people who have a button
  // to press on it. None of them had ANY link to /office/batch-verify before
  // this: the page existed, middleware admitted them, and nothing said so.
  const batchVerify = signableSides(
    user?.role as string | undefined,
    user?.email,
    process.env.WEIGHTS_VERIFIER_EMAILS,
  ).length > 0;
  // Whether this login uses the slab intake form — the three named intake
  // people (SLAB_INTAKE_EMAILS) and admins, the batchVerify shape one line up:
  // decided here because Nav is a client component and must not read the env
  // var, and on the same pure rule middleware and the page gate run.
  const slabIntake = canUseSlabIntake(
    user?.role as string | undefined,
    user?.email,
    process.env.SLAB_INTAKE_EMAILS,
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — the logo tile hides it, and brings it back (CollapsibleSidebar) */}
      <CollapsibleSidebar subtitle={BRANCH_LABEL[branch] ?? "Production system"}>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          <Nav showAdmin={showAdmin} branch={branch} role={user?.role as string | undefined ?? ""} fabTier={fabTier} inventory={inventory} consumables={consumables} intlSales={intlSales} salesDuty={salesDuty} batchVerify={batchVerify} slabIntake={slabIntake} />
        </div>
        <div className="mt-3 shrink-0 rounded-xl border border-gray-200 bg-white p-3">
          {/* Two jobs, one login — renders nothing at all for everybody else. */}
          <RoleSwitcher contexts={contexts} activeKey={activeContextKey} />
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{initials}</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium text-gray-900">{user?.name || user?.email}</div>
              {/* roleLabelFor, not the bare ROLE_LABEL table: it is the
                  department-aware one, so a login standing in Fabrication reads
                  "Fabrication Supervisor" here and in the picker above rather
                  than the two disagreeing about the job it is in. */}
              <div className="text-[11px] text-gray-400">{user?.role ? roleLabelFor(user.role, branch) : ""}{stationLabel ? ` · ${STATION_LABEL[stationLabel] ?? stationLabel}` : ""}{` · ${BRANCH_LABEL[branch] ?? branch}`}</div>
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
            <MobileNav contexts={contexts} activeKey={activeContextKey} showAdmin={showAdmin} branch={branch} role={user?.role as string | undefined ?? ""} fabTier={fabTier} inventory={inventory} consumables={consumables} intlSales={intlSales} salesDuty={salesDuty} batchVerify={batchVerify} slabIntake={slabIntake} />
            <span className="text-base font-semibold text-brand">Pacific ERP</span>
          </div>
          <form action={logout}><button className="min-h-[44px] text-sm text-gray-500">Sign out</button></form>
        </header>
        {/* px-4 below sm: px-6 left a 360px phone 312px of content and the MIS
            bar rows overflowed it. shell-main is the hook globals.css uses to keep
            the collapsed-sidebar tile off the heading in narrower windows. */}
        <main className="shell-main mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
