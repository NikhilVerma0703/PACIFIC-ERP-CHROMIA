/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/sales/orders/[id]/invoice-data
 *   → Returns per-order invoice overrides, item weights, marks & nos.
 *
 * POST /api/sales/orders/[id]/invoice-data
 *   Body: { overrides, itemNetWeights, marksNos }
 *   → Saves per-order data into sales_shipment_docs columns.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const rows = await db.$queryRawUnsafe(
    `SELECT marks_nos, item_net_weights, ocean_freight, packing_charges,
            insurance_pct, discount_amount
     FROM sales_shipment_docs WHERE order_id = $1`, id
  ) as any[];

  if (!rows.length) return NextResponse.json({});

  const r = rows[0];
  return NextResponse.json({
    marksNos:       r.marks_nos ?? "",
    itemNetWeights: r.item_net_weights ?? [],
    overrides: {
      oceanFreight:   r.ocean_freight  != null ? String(r.ocean_freight)   : "",
      packingCharges: r.packing_charges != null ? String(r.packing_charges) : "",
      insurancePct:   r.insurance_pct   != null ? String(r.insurance_pct)   : "",
      discountAmount: r.discount_amount  != null ? String(r.discount_amount) : "",
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { overrides = {}, itemNetWeights = [], marksNos = "" } = await req.json();

  const oceanFreight   = overrides.oceanFreight   ? parseFloat(overrides.oceanFreight)   : null;
  const packingCharges = overrides.packingCharges ? parseFloat(overrides.packingCharges) : null;
  const insurancePct   = overrides.insurancePct   ? parseFloat(overrides.insurancePct)   : null;
  const discountAmount = overrides.discountAmount ? parseFloat(overrides.discountAmount) : null;

  // Ensure row exists
  await db.$queryRawUnsafe(
    `INSERT INTO sales_shipment_docs (id, order_id, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, now(), now())
     ON CONFLICT (order_id) DO NOTHING`, id
  );

  await db.$queryRawUnsafe(
    `UPDATE sales_shipment_docs
     SET marks_nos       = $1,
         item_net_weights = $2::jsonb,
         ocean_freight    = $3,
         packing_charges  = $4,
         insurance_pct    = $5,
         discount_amount  = $6,
         updated_at       = now()
     WHERE order_id = $7`,
    marksNos || null,
    JSON.stringify(itemNetWeights),
    oceanFreight, packingCharges, insurancePct, discountAmount,
    id
  );

  return NextResponse.json({ ok: true });
}
