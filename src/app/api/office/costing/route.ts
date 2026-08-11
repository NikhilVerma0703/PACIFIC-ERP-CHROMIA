// The costing dashboard's read surface. ADMIN ONLY - middleware gates the
// path and the handler re-checks, because a route is not a page.
//
// Nothing here writes. A costing is computed from mixer records x the rate
// card on every request, so a corrected mixer row or a backdated rate
// re-costs the batch on the next load. There is no snapshot to go stale.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/rbac";
import { buildCostingReport, listBatches } from "@/lib/costing/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return json({ error: "Admins only." }, 403);
  const url = new URL(req.url);

  const batch = (url.searchParams.get("batch") ?? "").trim();
  if (batch) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(batch)) return json({ error: "Bad batch key." }, 400);
    const report = await buildCostingReport(batch);
    if (!report) return json({ error: `No mixer records for batch '${batch}'.` }, 404);
    return json(report);
  }

  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 60, 7), 365);
  return json({ batches: await listBatches(days), days });
}
