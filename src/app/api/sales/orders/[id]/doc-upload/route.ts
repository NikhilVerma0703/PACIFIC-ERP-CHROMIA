/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/sales/orders/[id]/doc-upload
 *   → { hasPackingList, hasMeasurementList, hasInvoice, photoCount }
 *
 * PATCH /api/sales/orders/[id]/doc-upload
 *   Body: one of:
 *     { type: "packingList"|"measurementList"|"blDoc"|"fumigationCert"|"bankDetails", data: string|null }
 *     { type: "photoAppend", data: { url: string, filename: string, caption?: string } }
 *     { type: "photoRemove", data: number }   ← index to remove
 *     { type: "photoReorder", data: Photo[] } ← full new order
 *
 * Uses raw SQL throughout — columns were added via migrations, not all in Prisma schema.
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

  const [rows, piRows]: [any[], any[]] = await Promise.all([
    db.$queryRaw`
      SELECT
        COALESCE((packing_list_upload IS NOT NULL AND packing_list_upload != ''), false)        AS "hasPackingList",
        COALESCE((measurement_list_upload IS NOT NULL AND measurement_list_upload != ''), false) AS "hasMeasurementList",
        COALESCE(jsonb_array_length(stuffing_photos::jsonb), 0)                                 AS "photoCount"
      FROM sales_shipment_docs
      WHERE order_id = ${id}
    `,
    db.$queryRaw`
      SELECT EXISTS(
        SELECT 1 FROM proforma_invoices
        WHERE order_id = ${id} AND status = 'ACCEPTED'
      ) AS "hasInvoice"
    `,
  ]);

  const hasPackingList     = rows.length > 0   ? !!rows[0].hasPackingList     : false;
  const hasMeasurementList = rows.length > 0   ? !!rows[0].hasMeasurementList : false;
  const photoCount         = rows.length > 0   ? Number(rows[0].photoCount)   : 0;
  const hasInvoice         = piRows.length > 0 ? !!piRows[0].hasInvoice       : false;

  return NextResponse.json({ hasPackingList, hasMeasurementList, hasInvoice, photoCount });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { type: string; data: any };
  const { type, data } = body;

  const validTypes = [
    "packingList", "measurementList",
    "blDoc", "fumigationCert", "bankDetails",
    "photoAppend", "photoRemove", "photoReorder",
  ];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  // Ensure a sales_shipment_docs row exists for this order
  await db.$executeRaw`
    INSERT INTO sales_shipment_docs (id, order_id, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${id}, now(), now())
    ON CONFLICT (order_id) DO NOTHING
  `;

  // ── Single-column document uploads ─────────────────────────────────────────
  const colMap: Record<string, string> = {
    packingList:     "packing_list_upload",
    measurementList: "measurement_list_upload",
    blDoc:           "bl_doc_url",
    fumigationCert:  "fumigation_cert_url",
    bankDetails:     "bank_details_url",
  };
  if (colMap[type]) {
    const col = colMap[type];
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs SET ${col} = $1, updated_at = now() WHERE order_id = $2`,
      data ?? null, id
    );

    // After uploading a shipping doc, check if auto-send trigger conditions are met
    if (["blDoc", "fumigationCert", "bankDetails"].includes(type) && data) {
      try {
        const { sendShippingDocsEmail } = await import("@/lib/sales/sendShippingDocsEmail");
        const check = await db.$queryRawUnsafe(
          `SELECT bl_no, bl_doc_url, fumigation_cert_url, bank_details_url, shipping_docs_mail_sent_at
           FROM sales_shipment_docs WHERE order_id = $1`, id
        ) as any[];
        const d = check[0];
        if (
          d?.bl_no &&
          d?.bl_doc_url?.startsWith("data:") &&
          d?.fumigation_cert_url?.startsWith("data:") &&
          d?.bank_details_url?.startsWith("data:") &&
          !d?.shipping_docs_mail_sent_at
        ) {
          sendShippingDocsEmail(id).catch(() => {});
        }
      } catch { /* non-blocking */ }
    }
    return NextResponse.json({ ok: true });
  }

  // ── Stuffing photos (JSONB array operations) ────────────────────────────────
  if (type === "photoAppend") {
    // data = { url: string, filename: string, caption?: string }
    const photo = { url: data.url, filename: data.filename, ...(data.caption ? { caption: data.caption } : {}) };
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs
       SET stuffing_photos = COALESCE(stuffing_photos, '[]'::jsonb) || $1::jsonb,
           updated_at = now()
       WHERE order_id = $2`,
      JSON.stringify([photo]), id
    );
    // Return current photo array so client stays in sync
    const rows = await db.$queryRawUnsafe(
      `SELECT stuffing_photos FROM sales_shipment_docs WHERE order_id = $1`, id
    ) as any[];
    return NextResponse.json({ ok: true, photos: rows[0]?.stuffing_photos ?? [] });
  }

  if (type === "photoRemove") {
    // data = index (number) to remove
    const idx = Number(data);
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs
       SET stuffing_photos = (
         SELECT jsonb_agg(el) FROM jsonb_array_elements(stuffing_photos) WITH ORDINALITY arr(el, pos)
         WHERE pos - 1 != $1
       ),
       updated_at = now()
       WHERE order_id = $2`,
      idx, id
    );
    const rows = await db.$queryRawUnsafe(
      `SELECT stuffing_photos FROM sales_shipment_docs WHERE order_id = $1`, id
    ) as any[];
    return NextResponse.json({ ok: true, photos: rows[0]?.stuffing_photos ?? [] });
  }

  if (type === "photoReorder") {
    // data = full reordered Photo[] array
    await db.$queryRawUnsafe(
      `UPDATE sales_shipment_docs SET stuffing_photos = $1::jsonb, updated_at = now() WHERE order_id = $2`,
      JSON.stringify(data), id
    );
    return NextResponse.json({ ok: true, photos: data });
  }

  return NextResponse.json({ error: "Unhandled type" }, { status: 400 });
}
