import { NextRequest, NextResponse } from "next/server";
import { buildReferenceSummary } from "@/lib/robo/referenceData";

// Live aggregation, never cached — the same reason reports/summary is
// force-dynamic: a stale Reference Sheet is how "the numbers changed later"
// happens. Always computed fresh from the current rows.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/robo/reference/summary?design=<Design Name>
 *
 * The preview behind the Downloads "Reference Sheet" section. Matches the design
 * by name only (thickness ignored — see designMatchKey), finds its latest
 * production run and returns the same summary the Excel export writes, so the
 * screen and the file agree. `found:false` means no production exists for that
 * design → the UI shows "No previous production record found".
 */
export async function GET(req: NextRequest) {
  const design = req.nextUrl.searchParams.get("design")?.trim() || "";
  if (!design) return NextResponse.json({ found: false });

  const summary = await buildReferenceSummary(design);
  if (!summary) return NextResponse.json({ found: false });

  return NextResponse.json({ found: true, ...summary });
}
