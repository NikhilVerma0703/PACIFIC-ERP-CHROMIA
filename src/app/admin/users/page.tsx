import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canManageUsers, currentRole, currentUser, creatableRoles, rankOf, ROLE_RANK, STATIONS, type RoleName } from "@/lib/rbac";
import { listUsersRows, type UserRow } from "@/lib/users";
import { salesTierOf } from "@/lib/sales/access";
import { salesDutyFor } from "@/lib/sales/session";
import { UserAdmin } from "./UserAdmin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  if (!(await canManageUsers())) redirect("/");
  const role = await currentRole();
  const myBranch = ((((await currentUser()) as any)?.branch as string | undefined) ?? "SHOP_FLOOR");

  // ── International Sales context ───────────────────────────────────────────
  // Sales-branch sessions (incl. admins signed in via the sales card) manage
  // INTERNATIONAL_SALES logins only: duty roles instead of factory roles. Only
  // the duties lib/sales treats as management (SALES_ADMIN, REPORTING_MANAGER)
  // — or a platform admin — may open this page in sales context.
  if (myBranch === "INTERNATIONAL_SALES") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const me = (await currentUser()) as any;
    const tier = salesTierOf(me);
    const duty = tier ? await salesDutyFor(String(me?.id ?? ""), tier) : "";
    if (!(tier === "ADMIN" || duty === "SALES_ADMIN")) redirect("/sales"); // Users & roles: Sales Admin only (user directive)
    const salesCreatable = tier === "ADMIN"
      ? ["SALES_ADMIN", "REPORTING_MANAGER", "COMMERCIAL", "ACCOUNTS", "SALESPERSON"]
      : ["COMMERCIAL", "ACCOUNTS", "SALESPERSON"];
    let salesRows: (Omit<UserRow, "createdAt"> & { createdAt: string })[] = [];
    try {
      salesRows = (await listUsersRows(["INTERNATIONAL_SALES"])).map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
    } catch { /* branch/sales columns not migrated — empty list, the form still works */ }
    return (
      <Shell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Users &amp; roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            International Sales — create logins for the sales department. The role is the sales duty
            (Salesperson, Commercial, Accounts{tier === "ADMIN" ? ", Reporting Manager, Sales Admin" : ""});
            Commercial and Accounts can be scoped to one factory. This list shows International Sales users only.
          </p>
        </div>
        <UserAdmin users={salesRows} creatable={[]} branches={["INTERNATIONAL_SALES"]} stations={[]} sales salesCreatable={salesCreatable} showGlobal={role === "ADMIN"} myRole={role} myId={String(me?.id ?? "")} />
      </Shell>
    );
  }

  const assignable = rankOf(role) >= ROLE_RANK.ADMIN
    ? (myBranch === "OFFICE" ? ["OFFICE"] : ["SHOP_FLOOR", "FABRICATION"])
    : [myBranch];
  // What may be SEEN is not what may be CREATED. CHROMIA is a retired
  // department — no new login may be put there — but any that the old
  // integration created must stay visible here, or there is no way to
  // deactivate or reset one. Drop this once
  // scripts/0045-migrate-chromia-branch-users.sql has emptied the branch.
  const visible = assignable.includes("SHOP_FLOOR") ? [...assignable, "CHROMIA"] : assignable;
  const creatableUnion = [...new Set(assignable.flatMap((b) => creatableRoles(role, b)))];
  // Per-branch breakdown so the client can filter the Role dropdown to match
  // whichever Department is currently selected (e.g. Fabrication only offers
  // its 3 roles, not the Shop Floor superset) — see UserAdmin.tsx.
  const creatableByBranch: Record<string, RoleName[]> = Object.fromEntries(assignable.map((b) => [b, creatableRoles(role, b)]));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let rows: { id: string; email: string; name: string | null; role: string; station: string | null; active: boolean; branch: string; createdAt: string; createdByName: string | null }[] = [];
  let migrateNeeded = false;
  try {
    const users = await listUsersRows(visible);
    rows = users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
  } catch {
    migrateNeeded = true;
  }

  if (migrateNeeded) {
    return (
      <Shell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Users &amp; roles</h1>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-medium">Database migration required.</p>
          <p className="mt-1">Run <code className="rounded bg-white px-1.5 py-0.5">npx prisma db push</code> in the ERP folder to add the new role/station fields and regenerate the client, then reload this page.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Users &amp; roles</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {myBranch === "OFFICE"
            ? "Office branch — Admin creates Finance and Accounts logins (flat roles: they see everything except Lab)."
            : "Create logins for roles below yours, assign operators to a machine, deactivate accounts, and reset passwords. Admins can create line managers, incharges and operators; line managers create incharges and operators; incharges create operators."}
        </p>
      </div>
      <UserAdmin users={rows} creatable={creatableUnion} creatableByBranch={creatableByBranch} branches={assignable} stations={STATIONS} office={myBranch === "OFFICE"} showGlobal={role === "ADMIN"} myRole={role} myId={String(((await currentUser()) as any)?.id ?? "")} />
    </Shell>
  );
}
