// Automatic production sync (Vercel Cron, every 30 min):
//   1. pulls changed records for every table still sourced from Airtable;
//   2. parity-verifies one quiet table per run;
//   3. auto-cuts-over tables once Airtable is silent 48h, parity matches,
//      and operators are actively entering that data in the ERP.
// Upsert-only — cut-over tables and ERP-native rows are never touched.
import { NextResponse } from "next/server";
import { runAutoSync } from "@/lib/airtableSync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Fail CLOSED: a missing secret means the endpoint is locked, not open.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.AIRTABLE_PAT) return NextResponse.json({ error: "AIRTABLE_PAT not configured" }, { status: 500 });
  const r = await runAutoSync();
  return NextResponse.json({
    ok: true,
    pulled: r.synced.reduce((a, x) => a + x.upserted, 0),
    tables: r.synced.length,
    parityVerified: r.verified,
    autoCutOver: r.cutOver,
    errors: r.synced.filter((x) => x.error).map((x) => `${x.model}: ${x.error}`),
  });
}
