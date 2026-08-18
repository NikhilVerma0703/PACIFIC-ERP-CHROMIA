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

  // Everything below is wrapped, because an uncaught throw here answers 500
  // with an EMPTY BODY. The browser then fails parsing nothing and shows
  // "Unexpected end of JSON input", which names neither the route nor the
  // cause — that is exactly how a dropped table went undiagnosed while the
  // screen appeared to have a front-end fault. A route that can fail owes the
  // reader a sentence saying so.
  try {
    const batch = (url.searchParams.get("batch") ?? "").trim();
    if (batch) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(batch)) return json({ error: "Bad batch key." }, 400);
      const report = await buildCostingReport(batch);
      if (!report) return json({ error: `No mixer records for batch '${batch}'.` }, 404);
      return json(report);
    }

    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 60, 7), 365);
    return json({ batches: await listBatches(days), days });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Logged in full for the platform, and returned in full to the browser:
    // the only readers are admins behind the gate above, and "something went
    // wrong" gives whoever is standing at the screen nothing to report.
    console.error("[costing]", url.search, err);
    return json({ error: `Costing failed: ${message}` }, 500);
  }
}
