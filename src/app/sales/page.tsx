import { salesAuth as auth } from "@/lib/sales/session";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import DashboardHierarchyTree from "./DashboardHierarchyTree";

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT:     "bg-amber-100 text-amber-700",
  PENDING_STOCK_CHECK: "bg-yellow-100 text-yellow-700",
  STOCK_CONFIRMED:     "bg-lime-100 text-lime-700",
  PENDING_PRODUCTION:  "bg-orange-100 text-orange-700",
  IN_PRODUCTION:       "bg-blue-100 text-blue-700",
  PACKING:             "bg-purple-100 text-purple-700",
  DISPATCHED:          "bg-indigo-100 text-indigo-700",
  IN_TRANSIT:          "bg-cyan-100 text-cyan-700",
  PORT_ARRIVED:        "bg-teal-100 text-teal-700",
  DELIVERED:           "bg-green-100 text-green-700",
  CANCELLED:           "bg-red-100 text-red-700",
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-1 border border-slate-100">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={"text-3xl font-bold " + color}>{value}</p>
    </div>
  );
}

export default async function SalesDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const h = await headers();
  const cookie = h.get("cookie") ?? "";
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  let data: any = null;
  try {
    const res = await fetch(`${baseUrl}/api/sales/dashboard`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (res.ok) data = await res.json();
  } catch {
    // dashboard fetch failed silently
  }

  const userName = session.user.name ?? session.user.email ?? "User";

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400 text-sm">Unable to load dashboard data.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome back, {userName}</h1>
        <p className="text-sm text-slate-400 mt-1">Here&apos;s your sales overview</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Orders</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Orders"    value={data.totalOrders}    color="text-slate-900" />
          <StatCard label="In Production"   value={data.inProduction}   color="text-blue-600" />
          <StatCard label="Dispatched"      value={data.dispatched}     color="text-indigo-600" />
          <StatCard label="Pending Payment" value={data.pendingPayment} color="text-amber-600" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Proforma Invoices</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total PIs"  value={data.totalPIs}    color="text-slate-900" />
          <StatCard label="Draft"      value={data.draftPIs}    color="text-slate-500" />
          <StatCard label="Sent"       value={data.sentPIs}     color="text-cyan-600" />
          <StatCard label="Accepted"   value={data.acceptedPIs} color="text-green-600" />
        </div>
      </section>

      {data.recentOrders?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Orders</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Order #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((order: any) => (
                  <tr key={order.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{order.orderNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{order.clientName}</td>
                    <td className="px-4 py-3">
                      <span className={"inline-flex px-2 py-0.5 rounded-full text-xs font-medium " + (STATUS_COLORS[order.status] ?? "bg-slate-100 text-slate-600")}>
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 font-medium">
                      {order.currency} {Number(order.totalAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Hierarchy tree — shown to RM and Admin */}
      {data.hierarchy && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Team Hierarchy</h2>
          <DashboardHierarchyTree hierarchy={data.hierarchy} />
        </section>
      )}
    </div>
  );
}
