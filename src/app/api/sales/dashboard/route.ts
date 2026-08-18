import { NextResponse } from "next/server";
import { salesAuth as auth } from "@/lib/sales/session";
import { buildSalesDashboardData } from "@/lib/sales/dashboardData";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = session.user;
  const data = await buildSalesDashboardData({
    id: u.id,
    salesRole: u.salesRole,
    name: u.name,
    email: u.email,
  });
  return NextResponse.json(data);
}
