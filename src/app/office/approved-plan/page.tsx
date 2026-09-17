// /office/approved-plan — the approved plan, for the plant's managers.
//
// Asked for on 2026-09-17: "a viewable page for managers to see the approved
// plan". Viewable is the whole specification. There is not one control on this
// page, no form, no action, no mutation — a manager reads what the plant has
// been committed to and nothing here can change it. The board that CAN change
// it is /office/production-planning, behind a different gate.
//
// "APPROVED" MEANS SCHEDULED OR IN_PRODUCTION, because there is no APPROVED
// status to read. commercial_production_status is QUEUED | SCHEDULED |
// IN_PRODUCTION | PRODUCED | CANCELLED; adding a sixth value and an approval
// step was offered and declined as bigger than the ask. So the committed part
// of the queue IS the approved plan, and QUEUED is deliberately withheld: it is
// the part still being argued over, and a floor working to an unsettled running
// order is the failure this page exists to prevent. The rule lives in
// APPROVED_PLAN_STATUSES, next to the gate, not in this query.
//
// IT READS PRISMA DIRECTLY AND ADDS NO API. The board's data comes from
// /api/office/commercial/production-requests, which middleware refuses to
// anyone outside the Commercial module — a LINE_MANAGER is exactly such a
// login. Widening that API to admit the floor would have opened the writes
// alongside the reads. A server component reading the two columns it needs
// opens nothing.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { maySeeApprovedPlan, APPROVED_PLAN_STATUSES } from "@/lib/production-plan/access-rules";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approved production plan" };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const IST = "Asia/Kolkata";
const day = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: IST }).format(d) : "—";

export default async function ApprovedProductionPlanPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!maySeeApprovedPlan(user)) redirect("/no-access?from=/office/approved-plan");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await (prisma as any).commercialProductionRequest.findMany({
    where: { status: { in: [...APPROVED_PLAN_STATUSES] } },
    orderBy: [{ priority: "asc" }, { raisedAt: "asc" }],
    select: {
      id: true, design: true, thickness: true, finish: true, shade: true,
      qtyShort: true, plannedSlabs: true, plannedHours: true, cleaningHours: true,
      status: true, priority: true, plannedBatch: true, scheduledAt: true, startedAt: true,
      order: { select: { number: true, client: { select: { name: true } } } },
    },
  });

  const slabs = rows.reduce((n, r) => n + (num(r.plannedSlabs) ?? num(r.qtyShort) ?? 0), 0);
  const hours = rows.reduce((n, r) => n + (num(r.plannedHours) ?? 0) + (num(r.cleaningHours) ?? 0), 0);
  const running = rows.filter((r) => r.status === "IN_PRODUCTION").length;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Approved production plan</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What the plant has been committed to, in the order it should be made. Scheduled and running work only —
          anything still queued is not settled yet and is not shown here. This page is read-only; the plan is set
          by Commercial on the production planning board.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="py-3"><div className="text-xs text-gray-500">Jobs on the plan</div><div className="text-xl font-semibold text-gray-900">{rows.length}</div></Card>
        <Card className="py-3"><div className="text-xs text-gray-500">Running now</div><div className="text-xl font-semibold text-gray-900">{running}</div></Card>
        <Card className="py-3"><div className="text-xs text-gray-500">Slabs planned</div><div className="text-xl font-semibold text-gray-900">{slabs.toLocaleString("en-IN")}</div></Card>
        <Card className="py-3"><div className="text-xs text-gray-500">Hours planned</div><div className="text-xl font-semibold text-gray-900">{hours ? hours.toFixed(1) : "—"}</div></Card>
      </div>

      {rows.length === 0 ? (
        <Card className="py-10 text-center text-sm text-gray-500">
          Nothing is scheduled yet. Requests appear here once Commercial schedules them — until then they sit in the
          queue, where the running order is still being decided.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Design</th>
                <th className="px-3 py-2 font-medium">Thickness</th>
                <th className="px-3 py-2 font-medium">For</th>
                <th className="px-3 py-2 font-medium text-right">Slabs</th>
                <th className="px-3 py-2 font-medium text-right">Hours</th>
                <th className="px-3 py-2 font-medium">Batch</th>
                <th className="px-3 py-2 font-medium">Scheduled</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => {
                const planned = num(r.plannedSlabs) ?? num(r.qtyShort) ?? 0;
                const h = (num(r.plannedHours) ?? 0) + (num(r.cleaningHours) ?? 0);
                const live = r.status === "IN_PRODUCTION";
                return (
                  <tr key={r.id} className={live ? "bg-brand/5" : undefined}>
                    <td className="px-3 py-2 tabular-nums text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{r.design}</div>
                      {(r.finish || r.shade) && (
                        <div className="text-xs text-gray-500">{[r.finish, r.shade].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.thickness}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.order?.client?.name ?? "—"}
                      {r.order?.number && <div className="text-xs text-gray-500">{r.order.number}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{planned.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{h ? h.toFixed(1) : "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{r.plannedBatch || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{day(r.startedAt ?? r.scheduledAt)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${live ? "bg-brand/10 text-brand" : "bg-gray-100 text-gray-600"}`}>
                        {live ? "Running" : "Scheduled"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  );
}
