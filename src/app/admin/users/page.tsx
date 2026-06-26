import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canManageUsers, currentRole, currentUser, creatableRoles, rankOf, ROLE_RANK, STATIONS } from "@/lib/rbac";
import { listUsersRows } from "@/lib/users";
import { UserAdmin } from "./UserAdmin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  if (!(await canManageUsers())) redirect("/");
  const role = await currentRole();
  const myBranch = ((((await currentUser()) as any)?.branch as string | undefined) ?? "SHOP_FLOOR");
  const assignable = rankOf(role) >= ROLE_RANK.ADMIN
    ? (myBranch === "OFFICE" ? ["OFFICE"] : ["SHOP_FLOOR", "FABRICATION"])
    : [myBranch];
  const creatableUnion = [...new Set(assignable.flatMap((b) => creatableRoles(role, b)))];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let rows: { id: string; email: string; name: string | null; role: string; station: string | null; active: boolean; branch: string; createdAt: string; createdByName: string | null }[] = [];
  let migrateNeeded = false;
  try {
    const users = await listUsersRows(assignable);
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
      <UserAdmin users={rows} creatable={creatableUnion} branches={assignable} stations={STATIONS} office={myBranch === "OFFICE"} showGlobal={role === "ADMIN"} myRole={role} myId={String(((await currentUser()) as any)?.id ?? "")} />
    </Shell>
  );
}
