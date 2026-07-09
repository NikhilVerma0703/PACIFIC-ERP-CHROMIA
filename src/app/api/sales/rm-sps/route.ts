/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/sales/rm-sps
 * Returns the list of SPs (id + name) that the current RM manages,
 * including themselves. Used for the SP filter tabs in RM dashboard.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { NextResponse } from "next/server";
import { getAssignedSps } from "@/lib/sales/rmScope";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uid       = (session.user as any).id       as string;
  const salesRole = (session.user as any).salesRole as string | null;

  if (salesRole !== "REPORTING_MANAGER" && salesRole !== "SALES_ADMIN") {
    return NextResponse.json({ sps: [] });
  }

  const sps = await getAssignedSps(uid, salesRole);
  return NextResponse.json({ sps });
}
