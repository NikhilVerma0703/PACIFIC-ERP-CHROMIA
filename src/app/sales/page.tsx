import { salesAuth as auth } from "@/lib/sales/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buildSalesDashboardData } from "@/lib/sales/dashboardData";
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

function StatCard({ label, value, color, href }: { label: string; value: number; color: string; href: string }) {
  // Whole card navigates to the matching (pre-filtered) list page.
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-1 border border-slate-100 hover:border-teal-200 hover:shadow-md transition"
    >
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={"text-3xl font-bold " + color}>{value}</p>
    </Link>
  );
}

export default async function SalesDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Build the data in-process. The old HTTP self-fetch used
  // NEXTAUTH_URL || localhost:3000 as its base URL — unset on Vercel, so the
  // fetch never left the lambda and the page always fell back to
  // "Unable to load dashboard data" (/api/sales/dashboard was never hit).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  try {
    data = await buildSalesDashboardData({
      id: session.user.id,
      salesRole: session.user.salesRole,
      name: session.user.name,
      email: session.user.email,
    });
  } catch {
    // degrade to the fallback message below
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
          <StatCard label="Total Orders"    value={data.totalOrders}    color="text-slate-900" href="/sales/orders" />
          <StatCard label="In Production"   value={data.inProduction}   color="text-blue-600"   href="/sales/orders?status=IN_PRODUCTION" />
          <StatCard label="Dispatched"      value={data.dispatched}     color="text-indigo-600" href="/sales/orders?status=DISPATCHED" />
          <StatCard label="Pending Payment" value={data.pendingPayment} color="text-amber-600"  href="/sales/orders?status=PENDING_PAYMENT" />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Proforma Invoices</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total PIs"  value={data.totalPIs}    color="text-slate-900" href="/sales/pi" />
          <StatCard label="Draft"      value={data.draftPIs}    color="text-slate-500" href="/sales/pi?status=DRAFT" />
          <StatCard label="Sent"       value={data.sentPIs}     color="text-cyan-600"  href="/sales/pi?status=SENT" />
          <StatCard label="Accepted"   value={data.acceptedPIs} color="text-green-600" href="/sales/pi?status=ACCEPTED" />
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
                  <tr key={order.id} className="relative border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={"/sales/orders/" + order.id} className="text-teal-700 hover:text-teal-900 hover:underline after:absolute after:inset-0 after:content-['']">
                        {order.orderNumber}
                      </Link>
                    </td>
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
