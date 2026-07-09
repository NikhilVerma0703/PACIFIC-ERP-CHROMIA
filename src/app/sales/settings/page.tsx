import { salesAuth as auth } from "@/lib/sales/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import RMAssignmentClient, { SpRow, ManagerRow, AssignmentRow } from "./RMAssignmentClient";
import CompanyConfigClient from "./CompanyConfigClient";
import SmtpSettingsClient from "./SmtpSettingsClient";
import HierarchyTreeClient, { HierarchyManager, UnassignedSP } from "./HierarchyTreeClient";
import MailSubjectsClient from "./MailSubjectsClient";
import MailBodiesClient from "./MailBodiesClient";
import DangerZoneClient from "./DangerZoneClient";
import FactoryAccessClient, { FactoryUser } from "./FactoryAccessClient";
import { getMailSubjects, DEFAULT_SUBJECTS, MAIL_SUBJECT_KEYS } from "@/lib/sales/mailSubjects";
import type { MailSubjectKey } from "@/lib/sales/mailSubjects";
import { getMailBodies, DEFAULT_BODIES, MAIL_BODY_KEYS } from "@/lib/sales/mailBodies";
import type { MailBodyKey } from "@/lib/sales/mailBodies";

export default async function SalesSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const salesRole = (session.user as any).salesRole as string | null;
  const sysRole   = (session.user as any).role      as string | null;
  const isAdmin   = salesRole === "SALES_ADMIN" || sysRole === "ADMIN";
  const isSpOrRM  = salesRole === "SALESPERSON" || salesRole === "REPORTING_MANAGER";

  if (!salesRole && sysRole !== "ADMIN") redirect("/sales");

  const db = prisma as any;

  // Mail subjects (admin only — fetched regardless of isAdmin, empty for non-admin)
  const customSubjects = isAdmin ? await getMailSubjects() : {};
  const initialSubjects = Object.fromEntries(
    MAIL_SUBJECT_KEYS.map(k => [k, customSubjects[k as MailSubjectKey] ?? DEFAULT_SUBJECTS[k as MailSubjectKey]])
  ) as Record<MailSubjectKey, string>;

  const customBodies = (isAdmin || isSpOrRM) ? await getMailBodies() : {};
  const initialBodies = Object.fromEntries(
    MAIL_BODY_KEYS.map(k => [k, customBodies[k as MailBodyKey] ?? DEFAULT_BODIES[k as MailBodyKey]])
  ) as Record<MailBodyKey, string>;

  const [spsRaw, managersRaw, assignmentsRaw, config, clientsRaw, factoryUsersRaw] = isAdmin
    ? await Promise.all([
        db.$queryRawUnsafe(
          `SELECT id, name, email, sales_role AS "salesRole" FROM users WHERE sales_role = 'SALESPERSON' ORDER BY name ASC`
        ).catch(() => [] as SpRow[]),
        // Use raw SQL so Prisma doesn't validate the enum (REPORTING_MANAGER may not be in DB yet)
        db.$queryRawUnsafe(
          `SELECT id, name, email, role, sales_role AS "salesRole" FROM users
           WHERE role = 'ADMIN' OR sales_role IN ('SALES_ADMIN','REPORTING_MANAGER')
           ORDER BY name ASC`
        ).catch(() => [] as ManagerRow[]),
        db.salesManagerAssignment.findMany({
          where: { isActive: true },
          include: { manager: { select: { id: true, name: true, email: true } } },
        }),
        db.salesConfig.findUnique({ where: { id: "global" } }).catch(() => null),
        // Clients with their SP (via orders — distinct SP-client pairs)
        db.salesClient.findMany({
          select: {
            id: true, name: true, country: true, email: true,
            orders: { select: { spId: true }, take: 1, orderBy: { createdAt: "asc" } },
          },
          orderBy: { name: "asc" },
        }),
        // Commercial + Accounts users for factory scoping
        db.$queryRawUnsafe(
          `SELECT id, name, email, sales_role AS "salesRole", sales_factory AS "salesFactory"
           FROM users WHERE sales_role IN ('COMMERCIAL','ACCOUNTS') ORDER BY name ASC`
        ).catch(() => [] as FactoryUser[]),
      ])
    : [[], [], [], null, [], []];

  const sps: SpRow[]                 = spsRaw as SpRow[];
  const managers: ManagerRow[]       = managersRaw as ManagerRow[];
  const assignments: AssignmentRow[] = assignmentsRaw as AssignmentRow[];
  const factoryUsers: FactoryUser[]  = factoryUsersRaw as FactoryUser[];

  // ── Build hierarchy tree ──────────────────────────────────────────────────
  // Map: spId → [clients]
  const spClientMap = new Map<string, { id: string; name: string; country: string; email: string | null }[]>();
  for (const sp of sps) {
    spClientMap.set(sp.id, []);
  }
  for (const client of (clientsRaw as any[])) {
    const spId = client.orders?.[0]?.spId;
    if (spId && spClientMap.has(spId)) {
      spClientMap.get(spId)!.push({
        id: client.id, name: client.name, country: client.country, email: client.email,
      });
    }
  }

  // Map: managerId → [spIds]
  const mgrSpMap = new Map<string, string[]>();
  for (const a of assignments) {
    const list = mgrSpMap.get(a.managerId) ?? [];
    list.push(a.spId);
    mgrSpMap.set(a.managerId, list);
  }

  const assignedSpIds = new Set(assignments.map((a: any) => a.spId));

  const hierarchyManagers: HierarchyManager[] = managers.map(mgr => ({
    id: mgr.id,
    name: mgr.name,
    email: mgr.email,
    role: mgr.role,
    salesRole: mgr.salesRole,
    sps: (mgrSpMap.get(mgr.id) ?? []).map(spId => {
      const sp = sps.find(s => s.id === spId);
      return {
        id: spId,
        name: sp?.name ?? null,
        email: sp?.email ?? null,
        clients: spClientMap.get(spId) ?? [],
      };
    }),
  })).filter(mgr => mgr.sps.length > 0 || managers.some(m => m.id === mgr.id));

  const unassignedSPs: UnassignedSP[] = sps
    .filter(sp => !assignedSpIds.has(sp.id))
    .map(sp => ({
      id: sp.id,
      name: sp.name,
      email: sp.email,
      clients: spClientMap.get(sp.id) ?? [],
    }));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Your email configuration and admin options</p>
      </div>

      {/* My Email SMTP - visible to all sales users */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-slate-800">My Email Settings (SMTP)</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            All outgoing emails (PI, BL docs, reminders) are sent from your mailbox. Configure your SMTP credentials here.
          </p>
        </div>
        <SmtpSettingsClient />
      </div>

      {/* Mail Body Templates — visible to SP and RM (for their own PI emails) */}
      {isSpOrRM && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">Email Body Templates</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Customize the body of emails sent when you share a PI or follow up with a client.
            </p>
          </div>
          <MailBodiesClient initial={initialBodies} />
        </div>
      )}

      {isAdmin && (
        <>
          {/* Company Config */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-800">Company &amp; Bank Details</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                These values appear on every generated PDF.
              </p>
            </div>
            <CompanyConfigClient initial={{
              companyName:    config?.companyName    ?? "",
              companyAddress: config?.companyAddress ?? "",
              iecCode:        config?.iecCode        ?? "",
              gstNo:          config?.gstNo          ?? "",
              panNo:          config?.panNo          ?? "",
              bankName:       config?.bankName       ?? "",
              bankBranch:     config?.bankBranch     ?? "",
              accountNo:      config?.accountNo      ?? "",
              ifscCode:       config?.ifscCode       ?? "",
              swiftCode:      config?.swiftCode      ?? "",
              adCode:         config?.adCode         ?? "",
              ccEmails:       config?.ccEmails       ?? [],
            }} />
          </div>

          {/* RM Assignments */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-800">RM Assignments</h2>
              <p className="text-xs text-slate-400 mt-0.5">Assign a Reporting Manager to each Salesperson</p>
            </div>
            <RMAssignmentClient sps={sps} managers={managers} assignments={assignments} />
          </div>

          {/* Factory Access — Commercial & Accounts scoping */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-800">Factory Access</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Set which factory (Quartz / Granite / Both) each Commercial and Accounts user can see.
                SP and RM always see both — they use the tab filter instead.
              </p>
            </div>
            <FactoryAccessClient users={factoryUsers} />
          </div>

          {/* Mail Subject Templates */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-800">Email Subject Templates</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Customize subject lines for automated emails sent by the system.
              </p>
            </div>
            <MailSubjectsClient initial={initialSubjects} />
          </div>

          {/* Mail Body Templates */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-800">Email Body Templates</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Edit the full HTML body of each automated email. Click a variable tag to insert it at the cursor.
              </p>
            </div>
            <MailBodiesClient initial={initialBodies} />
          </div>

          {/* Hierarchy Tree View */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-800">Team Hierarchy</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Visual tree of Manager → Salesperson → Customers. Click any row to expand.
              </p>
            </div>
            <HierarchyTreeClient
              managers={hierarchyManagers}
              unassigned={unassignedSPs}
            />
          </div>

          {/* Danger Zone */}
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-red-700">Danger Zone</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Irreversible actions. Users and config settings are preserved.
                         </p>
            </div>
            <DangerZoneClient />
          </div>
        </>
      )}
    </div>
  );
}
