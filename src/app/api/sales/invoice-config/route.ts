/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/sales/invoice-config?type=QUARTZ|GRANITE
 *   → Returns latest saved invoice config for that factory.
 *     If never saved, returns built-in defaults for that factory.
 *
 * POST /api/sales/invoice-config
 *   Body: { type: "QUARTZ"|"GRANITE", config: {...} }
 *   → Saves config as the new default. Next order pre-fills from this.
 *   → Accessible to COMMERCIAL and SALES_ADMIN only.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { QUARTZ_DEFAULTS, GRANITE_DEFAULTS } from "@/lib/sales/invoiceDefaults";
import { NextResponse } from "next/server";

const db = prisma as any;

// ── Defaults ─────────────────────────────────────────────────────────────────
// These are the first-time seeds — once saved they get replaced by user edits.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const type = new URL(req.url).searchParams.get("type") ?? "QUARTZ";
  const col  = type === "GRANITE" ? "invoice_config_granite" : "invoice_config_quartz";

  const rows = await db.$queryRawUnsafe(
    `SELECT ${col} AS config FROM sales_config WHERE id = 'global'`
  ) as any[];

  const saved = rows[0]?.config;
  const defaults = type === "GRANITE" ? GRANITE_DEFAULTS : QUARTZ_DEFAULTS;

  // Merge: saved values override defaults (so new keys added to defaults still appear)
  const config = saved && Object.keys(saved).length > 0
    ? { ...defaults, ...saved }
    : defaults;

  return NextResponse.json({ type, config });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  if (salesRole !== "SALES_ADMIN" && salesRole !== "COMMERCIAL") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { type, config } = await req.json() as { type: string; config: Record<string, any> };
  if (type !== "QUARTZ" && type !== "GRANITE") {
    return NextResponse.json({ error: "type must be QUARTZ or GRANITE" }, { status: 400 });
  }

  const col = type === "GRANITE" ? "invoice_config_granite" : "invoice_config_quartz";

  // Upsert global sales_config row, updating the right column
  await db.$queryRawUnsafe(
    `INSERT INTO sales_config (id, ${col})
     VALUES ('global', $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET ${col} = $1::jsonb`,
    JSON.stringify(config)
  );

  return NextResponse.json({ ok: true, type });
}
